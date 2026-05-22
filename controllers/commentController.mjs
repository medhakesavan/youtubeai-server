import Comment from '../models/Comment.mjs';
import Channel from '../models/Channel.mjs';
import { 
  getYouTubeClient, 
  likeComment, 
  deleteCommentFromYouTube, 
  hideComment, 
  replyToComment 
} from '../services/youtubeService.mjs';
import { classifyComment } from '../services/aiService.mjs';
import { processComments } from '../services/commentProcessingService.mjs';

export const getComments = async (req, res) => {
  try {
    const { status, sentiment, autoLiked, videoId, channelId } = req.query;
    const query = { userId: req.user.id };
    
    if (channelId) query.channelId = channelId;
    if (status) query.status = status;
    if (sentiment) query.sentiment = sentiment;
    if (autoLiked !== undefined) query.autoLiked = autoLiked === 'true';
    if (videoId) query.videoId = videoId;

    const comments = await Comment.find(query).sort({ publishedAt: -1 }).limit(100);
    res.json(comments);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const takeAction = async (req, res) => {
  const { id } = req.params;
  const { action, replyText } = req.body;

  try {
    const comment = await Comment.findOne({ _id: id, userId: req.user.id });
    if (!comment) return res.status(404).json({ error: 'Comment not found' });

    const channel = await Channel.findOne({ channelId: comment.channelId, userId: req.user.id });
    if (!channel) return res.status(404).json({ error: 'No channel connected' });

    if (channel.apiKey && action !== 'approve') {
      return res.status(400).json({
        success: false,
        error: 'Action not supported for API key channels.'
      });
    }

    let youtube;
    if (!channel.apiKey) {
      youtube = getYouTubeClient({
        access_token: channel.accessToken,
        refresh_token: channel.refreshToken,
        expiry_date: channel.expiryDate,
      }, async (newTokens) => {
        await Channel.findOneAndUpdate({ channelId: channel.channelId, userId: req.user.id }, {
          accessToken: newTokens.access_token,
          refreshToken: newTokens.refresh_token || channel.refreshToken,
          expiryDate: newTokens.expiry_date
        });
      });
    }

    let success = false;
    let actionError = null;

    switch (action) {
      case 'approve':
        comment.status = 'approved';
        success = true;
        break;
      case 'delete':
        const deleteRes = await deleteCommentFromYouTube(youtube, comment.youtubeId);
        success = deleteRes.success;
        if (success) {
          comment.status = 'deleted';
          comment.deleteFailed = false;
        } else {
          comment.deleteFailed = true;
          actionError = deleteRes.reason;
        }
        break;
      case 'like':
        const likeRes = await likeComment(youtube, comment.youtubeId);
        success = likeRes.success;
        comment.likeStatus = likeRes.status;
        if (success) {
          comment.autoLiked = true;
          comment.status = 'approved';
        } else {
          actionError = likeRes.reason;
        }
        break;
      case 'hide':
        const hideRes = await hideComment(youtube, comment.youtubeId);
        success = hideRes.success;
        if (success) comment.status = 'flagged';
        else actionError = hideRes.reason;
        break;
      case 'reply':
        const replyRes = await replyToComment(youtube, comment.youtubeId, replyText);
        success = replyRes.success;
        if (success) comment.status = 'approved';
        else actionError = replyRes.reason;
        break;
    }

    await comment.save();
    const io = req.app.get('io');
    if (io) io.emit('stats_updated');

    if (!success && action !== 'approve') {
      return res.json({ success: false, error: actionError || 'Operation failed' });
    }
    
    res.json({ success: true, comment });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

export const editComment = async (req, res) => {
  const { id } = req.params;
  const { sentiment, status, note } = req.body;

  try {
    const comment = await Comment.findOne({ _id: id, userId: req.user.id });
    if (!comment) return res.status(404).json({ error: 'Comment not found' });

    if (sentiment) comment.sentiment = sentiment;
    if (status) comment.status = status;
    if (note !== undefined) comment.note = note;
    
    if (status === 'approved') comment.aiActionTaken = true;

    await comment.save();
    const io = req.app.get('io');
    if (io) io.emit('stats_updated');
    
    res.json({ success: true, comment });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const reanalyzeComments = async (req, res) => {
  try {
    const { sentimentFilter } = req.body;
    const comments = await Comment.find({ userId: req.user.id, ...(sentimentFilter && { sentiment: sentimentFilter }) });
    
    const runReanalysis = async () => {
      for (const comment of comments) {
        const aiResult = await classifyComment(comment.text);
        comment.sentiment = aiResult.sentiment;
        await comment.save();
      }
      const io = req.app.get('io');
      if (io) io.emit('stats_updated');
    };

    runReanalysis();
    res.json({ success: true, message: 'Re-analysis started in background' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const manualSync = async (req, res) => {
  try {
    const { videoId } = req.params;
    const { channelId } = req.query;
    const channel = await Channel.findOne({ userId: req.user.id, channelId });
    if (!channel) return res.status(404).json({ error: 'No channel connected' });

    const io = req.app.get('io');
    if (channel.apiKey) {
      await processComments(channel, null, channel.apiKey, io, videoId);
    } else {
      await processComments(channel, {
        access_token: channel.accessToken,
        refresh_token: channel.refreshToken,
        expiry_date: channel.expiryDate,
      }, null, io, videoId);
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
