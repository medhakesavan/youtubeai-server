import { google } from 'googleapis';
import logger from '../log.mjs';

export const getYouTubeAuth = () => {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.REDIRECT_URI || `http://localhost:5000/auth/callback`
  );
};

export const getYouTubeClient = (credentials) => {
  const oauth2Client = getYouTubeAuth();

  if (credentials) {
    oauth2Client.setCredentials(credentials);
  }

  return google.youtube({ version: 'v3', auth: oauth2Client });
};

export const fetchLatestComments = async (youtube, channelId, maxResults = 50) => {
  try {
    const response = await youtube.commentThreads.list({
      part: 'snippet,replies',
      allThreadsRelatedToChannelId: channelId,
      maxResults,
      order: 'time',
      textFormat: 'plainText',
    });

    return response.data.items.map(item => ({
      youtubeId: item.snippet.topLevelComment.id,
      videoId: item.snippet.videoId,
      text: item.snippet.topLevelComment.snippet.textDisplay,
      author: item.snippet.topLevelComment.snippet.authorDisplayName,
      authorProfileImageUrl: item.snippet.topLevelComment.snippet.authorProfileImageUrl,
      publishedAt: item.snippet.topLevelComment.snippet.publishedAt,
    }));
  } catch (error) {
    logger.error('Error fetching YouTube comments:', error);
    throw error;
  }
};

export const likeComment = async (youtube, commentId) => {
  try {
    await youtube.comments.setRating({
      id: commentId,
      rating: 'like',
    });
    logger.info(`Liked comment: ${commentId}`);
  } catch (error) {
    logger.error(`Error liking comment ${commentId}:`, error);
  }
};
