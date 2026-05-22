import { google } from 'googleapis';
import logger from '../utils/logger.mjs';

export const getYouTubeAuth = () => {
  const redirectUri = process.env.REDIRECT_URI?.trim();
  
  if (!redirectUri) {
    const error = 'CRITICAL: REDIRECT_URI is not defined in environment variables!';
    logger.error(error);
    throw new Error(error);
  }
  
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    redirectUri
  );
};

export const getYouTubeClient = (tokens, onTokensRefreshed) => {
  const auth = getYouTubeAuth();
  auth.setCredentials(tokens);
  
  if (onTokensRefreshed) {
    auth.on('tokens', (newTokens) => {
      onTokensRefreshed(newTokens);
    });
  }
  
  return google.youtube({ version: 'v3', auth });
};

export const getYouTubeClientWithApiKey = (apiKey) => {
  return google.youtube({ version: 'v3', auth: apiKey });
};

export const fetchLatestComments = async (youtube, channelId, maxResults = 50, videoId = null) => {
  try {
    const params = {
      part: 'snippet',
      maxResults,
      order: 'time'
    };

    if (videoId) {
      params.videoId = videoId;
    } else {
      params.allThreadsRelatedToChannelId = channelId;
    }

    const res = await youtube.commentThreads.list(params);

    return (res.data.items || []).map(item => ({
      youtubeId: item.snippet.topLevelComment.id,
      videoId: item.snippet.videoId,
      text: item.snippet.topLevelComment.snippet.textDisplay,
      author: item.snippet.topLevelComment.snippet.authorDisplayName,
      authorProfileImageUrl: item.snippet.topLevelComment.snippet.authorProfileImageUrl,
      publishedAt: item.snippet.topLevelComment.snippet.publishedAt,
    }));
  } catch (error) {
    logger.error('Error fetching comments:', error);
    return [];
  }
};

export const deleteCommentFromYouTube = async (youtube, commentId, retries = 3) => {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      // Ensure commentId is valid
      if (!commentId || typeof commentId !== 'string') {
        logger.error(`Invalid commentId provided to delete: ${commentId}`);
        return { success: false, reason: 'Invalid commentId format' };
      }

      logger.info(`Sending YouTube API request: setModerationStatus(rejected) for comment ID: ${commentId}`);
      
      const response = await youtube.comments.setModerationStatus({ 
        id: [commentId], // Passing as array as some library versions expect this for batch operations
        moderationStatus: 'rejected'
      });
      
      logger.info(`YouTube API response success. Status: ${response.status}. Successfully deleted (rejected) comment: ${commentId}`);
      return { success: true };
    } catch (error) {
      const errorMsg = error.response?.data?.error?.message || error.message;
      const reason = error.response?.data?.error?.errors?.[0]?.reason || 'unknown';
      const status = error.response?.status || 500;
      
      // Retry on 5xx server errors or 429 rate limits
      if ((status >= 500 || status === 429) && attempt < retries) {
        logger.warn(`YouTube Delete Error [ID: ${commentId}]: ${errorMsg}. Retrying (Attempt ${attempt}/${retries})...`);
        await new Promise(resolve => setTimeout(resolve, attempt * 1000)); // Exponential-ish backoff
        continue;
      }
      
      logger.error(`YouTube Delete Error [ID: ${commentId}]: ${errorMsg} (Reason: ${reason})`);
      return { success: false, reason: errorMsg || reason };
    }
  }
};

export const likeComment = async (youtube, commentId, retries = 3) => {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      if (!commentId) return { success: false, reason: 'null/empty commentId', status: 'failed' };
      
      // EXPERIMENTAL: Using setModerationStatus('published') as a 'Force-Publish' trigger.
      // While the official API doesn't have a 'like' method, some channel owners report 
      // that re-publishing an already published comment can trigger engagement sync.
      logger.info(`Sending YouTube API request: setRating(like) for comment ID: ${commentId}`);
      
      const response = await youtube.comments.setRating({
        id: commentId,
        rating: 'like'
      });
      
      logger.info(`YouTube setRating(like) success for: ${commentId} (Status: ${response.status})`);
      return { success: true, status: 'success' };
    } catch (error) {
      const errorMsg = error.response?.data?.error?.message || error.message;
      const reason = error.response?.data?.error?.errors?.[0]?.reason || 'unknown';
      const status = error.response?.status || 500;
      
      if ((status >= 500 || status === 429) && attempt < retries) {
        logger.warn(`YouTube Like Error [ID: ${commentId}]: ${errorMsg}. Retrying...`);
        await new Promise(resolve => setTimeout(resolve, attempt * 1000));
        continue;
      }
      
      logger.error(`YouTube Like Error [ID: ${commentId}]: ${errorMsg} (Reason: ${reason})`);
      return { success: false, reason: errorMsg || reason, status: 'failed' };
    }
  }
};

export const hideComment = async (youtube, commentId) => {
  try {
    await youtube.comments.setModerationStatus({
      id: commentId,
      moderationStatus: 'heldForReview'
    });
    logger.info(`Hid comment: ${commentId}`);
    return { success: true };
  } catch (error) {
    const errorMsg = error.response?.data?.error?.message || error.message;
    logger.error(`Hide error [ID: ${commentId}]: ${errorMsg}`);
    return { success: false, reason: errorMsg };
  }
};

export const replyToComment = async (youtube, parentId, text) => {
  try {
    await youtube.comments.insert({
      part: 'snippet',
      resource: {
        snippet: {
          parentId,
          textOriginal: text
        }
      }
    });
    logger.info(`Replied to comment: ${parentId}`);
    return { success: true };
  } catch (error) {
    const errorMsg = error.response?.data?.error?.message || error.message;
    logger.error(`Reply error [Parent: ${parentId}]: ${errorMsg}`);
    return { success: false, reason: errorMsg };
  }
};

export const fetchVideos = async (youtube, channelId) => {
  try {
    const channelRes = await youtube.channels.list({
      part: 'contentDetails',
      id: channelId
    });

    const uploadsPlaylistId = channelRes.data.items[0]?.contentDetails?.relatedPlaylists?.uploads;
    if (!uploadsPlaylistId) return [];

    const playlistRes = await youtube.playlistItems.list({
      part: 'snippet,contentDetails',
      playlistId: uploadsPlaylistId,
      maxResults: 50
    });

    return (playlistRes.data.items || []).map(item => ({
      videoId: item.contentDetails.videoId,
      title: item.snippet.title,
      description: item.snippet.description,
      thumbnail: item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url,
      publishedAt: item.snippet.publishedAt
    }));
  } catch (error) {
    logger.error('Error fetching videos:', error);
    return [];
  }
};
