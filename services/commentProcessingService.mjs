import Channel from '../models/Channel.mjs';
import Comment from '../models/Comment.mjs';
import User from '../models/User.mjs';
import Lead from '../models/Lead.mjs';
import logger from '../utils/logger.mjs';
import { 
  getYouTubeClient, 
  getYouTubeClientWithApiKey, 
  fetchLatestComments, 
  likeComment, 
  deleteCommentFromYouTube, 
  hideComment, 
  replyToComment 
} from './youtubeService.mjs';
import { classifyComment } from './aiService.mjs';
import { detectWhatsAppNumber, createLead } from './leadService.mjs';
import { sendWhatsAppMessage } from './gowhatsService.mjs';

export const processComments = async (channel, tokens = null, apiKey = null, io = null, videoId = null) => {
  try {
    let youtube;
    if (apiKey) {
      youtube = getYouTubeClientWithApiKey(apiKey);
    } else {
      youtube = getYouTubeClient(tokens, async (newTokens) => {
        logger.info(`Worker: Tokens refreshed for channel ${channel.channelId}`);
        await Channel.findOneAndUpdate({ channelId: channel.channelId, userId: channel.userId }, {
          accessToken: newTokens.access_token,
          refreshToken: newTokens.refresh_token || channel.refreshToken,
          expiryDate: newTokens.expiry_date
        });
      });
    }

    const comments = await fetchLatestComments(youtube, channel.channelId, 50, videoId);
    if (!comments || comments.length === 0) return;

    const user = await User.findById(channel.userId);
    const userSettings = user?.settings || { autoMod: true, confidenceThreshold: 85 };
    const confidenceThresholdDecimal = (userSettings.confidenceThreshold || 85) / 100;
    
    for (const c of comments) {
      const aiResult = await classifyComment(c.text);
      const isPositive = aiResult.sentiment === 'positive' && aiResult.confidence >= confidenceThresholdDecimal;
      const isToxic = aiResult.sentiment === 'toxic' && aiResult.confidence >= confidenceThresholdDecimal;
      const isMeaningful = c.text.trim().length > 3;

      const existing = await Comment.findOne({ userId: channel.userId, youtubeId: c.youtubeId });
      
      let status = aiResult.sentiment === 'toxic' ? 'flagged' : 'pending';
      let autoLiked = false;
      let deleteFailed = false;
      let deleteErrorReason = null;
      let likeStatus = 'none';
      let likeError = null;

      // Auto-Delete
      if (isToxic && userSettings.autoMod && (!existing || (existing.status !== 'deleted' && !existing.deleteFailed))) {
        if (apiKey) {
          status = 'flagged';
          deleteFailed = true;
          deleteErrorReason = 'Authentication via API Key does not permit write actions (OAuth required)';
        } else {
          const delRes = await deleteCommentFromYouTube(youtube, c.youtubeId);
          if (delRes.success) {
            status = 'deleted';
          } else {
            deleteFailed = true;
            deleteErrorReason = delRes.reason;
            status = 'flagged';
          }
        }
      } 
      // Auto-Like/Reply
      else if (isPositive && isMeaningful && userSettings.autoLike && (!existing || existing.likeStatus === 'none')) {
        if (apiKey) {
          likeStatus = 'not_supported';
          likeError = 'Authentication via API Key does not permit write actions (OAuth required)';
        } else {
          const result = await likeComment(youtube, c.youtubeId);
          likeStatus = result.status;
          likeError = result.reason;
          autoLiked = result.success;
        }
      }

      // Lead Automation
      const whatsappNumber = detectWhatsAppNumber(c.text);
      if (whatsappNumber) {
        const { lead, isDuplicate } = await createLead({
          userId: channel.userId,
          channelId: channel.channelId,
          videoId: c.videoId,
          commentId: c.youtubeId,
          authorName: c.author,
          originalComment: c.text,
          whatsappNumber: whatsappNumber
        });

        if (!isDuplicate && !apiKey) {
          const hideRes = await hideComment(youtube, c.youtubeId);
          if (hideRes.success) {
            lead.isHidden = true;
            status = 'flagged';
            
            const productLink = process.env.PRODUCT_LINK || 'https://techvaseegrah.com';
            const messageTemplate = `Hi 👋 Thanks for your interest.\n\nHere are the details:\n${productLink}\n\nOur team will assist you shortly.`;
            
            const waRes = await sendWhatsAppMessage(whatsappNumber, messageTemplate);
            if (waRes.success) {
              lead.status = 'sent';
              lead.whatsappSent = true;
            } else {
              lead.status = 'failed';
              lead.errorLog = waRes.error;
            }
            await replyToComment(youtube, c.youtubeId, "Thanks! Our team will contact you shortly 😊");
          } else {
            lead.status = 'failed';
            lead.errorLog = `Hide Failed: ${hideRes.reason}`;
          }
        }
        await lead.save();
      }

      // Persistence
      const updatedComment = await Comment.findOneAndUpdate(
        { userId: channel.userId, youtubeId: c.youtubeId },
        {
          ...c,
          userId: channel.userId,
          channelId: channel.channelId,
          sentiment: aiResult.sentiment,
          toxicityScore: aiResult.toxicityScore,
          confidence: aiResult.confidence,
          language: aiResult.language,
          detectedWords: aiResult.detectedWords,
          status: existing && existing.status !== 'pending' && existing.status !== 'flagged' ? existing.status : status,
          autoLiked: (existing && existing.autoLiked) || autoLiked,
          deleteFailed,
          deleteError: deleteErrorReason,
          likeStatus: likeStatus !== 'none' ? likeStatus : (existing ? existing.likeStatus : 'none'),
          likeError: likeError || (existing ? existing.likeError : null),
          aiActionTaken: (existing && existing.aiActionTaken) || status === 'deleted' || autoLiked || deleteFailed
        },
        { upsert: true, returnDocument: 'after' }
      );

      // Socket update
      if (io) {
        const isNew = !existing;
        const actionTaken = (status === 'deleted' && (!existing || existing.status !== 'deleted')) || (autoLiked && (!existing || !existing.autoLiked));
        if (isNew || actionTaken) {
          io.emit('live_activity', {
            ...updatedComment.toObject(),
            id: updatedComment._id,
            type: status === 'deleted' ? 'delete' : (autoLiked ? 'like' : 'new_comment')
          });
          io.emit('new_comment_analyzed', updatedComment);
        }
      }
    }
    if (io) io.emit('stats_updated');
  } catch (error) {
    logger.error('Worker error:', error);
  }
};
