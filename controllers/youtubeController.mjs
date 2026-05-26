import Channel from '../models/Channel.mjs';
import Comment from '../models/Comment.mjs';
import logger from '../utils/logger.mjs';
import jwt from 'jsonwebtoken';
import { 
  getYouTubeAuth, 
  getYouTubeClient, 
  getYouTubeClientWithApiKey, 
  fetchVideos 
} from '../services/youtubeService.mjs';
import { processComments } from '../services/commentProcessingService.mjs';

const JWT_SECRET = process.env.JWT_SECRET || 'supersecret_fallback';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

export const initiateAuth = (_req, res) => {
  try {
    const client = getYouTubeAuth();
    const authUrl = client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: [
        'https://www.googleapis.com/auth/youtube.readonly',
        'https://www.googleapis.com/auth/youtube.force-ssl'
      ],
    });
    res.redirect(authUrl);
  } catch (err) {
    logger.error(`Failed to generate OAuth URL: ${err.message}`);
    res.status(500).json({ error: 'OAuth Configuration Error' });
  }
};

export const handleCallback = async (req, res) => {
  const { code, error: oauthError } = req.query;

  if (oauthError) return res.redirect(`${FRONTEND_URL}/?error=access_denied`);

  const token = req.cookies.token;
  if (!token) return res.redirect(`${FRONTEND_URL}/?error=unauthorized`);

  let userId;
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    userId = decoded.id;
  } catch (err) {
    return res.redirect(`${FRONTEND_URL}/?error=invalid_session`);
  }

  try {
    const client = getYouTubeAuth();
    const { tokens } = await client.getToken(code);
    client.setCredentials(tokens);

    const youtube = getYouTubeClient(tokens);
    const channelRes = await youtube.channels.list({ part: 'snippet,contentDetails', mine: true });
    const items = channelRes.data.items;

    if (!items || items.length === 0) {
      return res.redirect(`${FRONTEND_URL}/?error=no_channel`);
    }

    const channelData = items[0];
    const uploadsPlaylistId = channelData.contentDetails?.relatedPlaylists?.uploads || '';

    const updateData = {
      userId,
      channelId: channelData.id,
      title: channelData.snippet.title,
      thumbnailUrl: channelData.snippet.thumbnails?.default?.url || '',
      accessToken: tokens.access_token,
      uploadsPlaylistId,
    };

    if (tokens.refresh_token) updateData.refreshToken = tokens.refresh_token;
    if (tokens.expiry_date) updateData.expiryDate = tokens.expiry_date;

    const channel = await Channel.findOneAndUpdate(
      { userId, channelId: channelData.id },
      { $set: updateData },
      { upsert: true, new: true }
    );

    // Trigger initial background process
    const io = req.app.get('io');
    processComments(channel, tokens, null, io).catch(err => 
      logger.error('Initial processComments error:', err)
    );

    res.redirect(`${FRONTEND_URL}/?status=success`);
  } catch (error) {
    logger.error('Callback error:', error);
    res.redirect(`${FRONTEND_URL}/?error=auth_failed`);
  }
};

export const getChannels = async (req, res) => {
  try {
    const channels = await Channel.find({ userId: req.user.id }).select('title channelId thumbnailUrl apiKey');
    res.json(channels);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const deleteChannel = async (req, res) => {
  try {
    const { channelId } = req.params;
    const deletedChannel = await Channel.findOneAndDelete({ userId: req.user.id, channelId });
    if (!deletedChannel) {
      return res.status(404).json({ error: 'Channel not found' });
    }
    await Comment.deleteMany({ userId: req.user.id, channelId });
    res.json({ success: true, message: 'Channel disconnected' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to disconnect channel' });
  }
};

export const getVideos = async (req, res) => {
  try {
    const { channelId } = req.query;
    if (!channelId) return res.status(400).json({ error: 'channelId is required' });
    
    const channel = await Channel.findOne({ userId: req.user.id, channelId });
    if (!channel) return res.status(404).json({ error: 'Channel not found' });

    let youtube;
    if (channel.apiKey) {
      youtube = getYouTubeClientWithApiKey(channel.apiKey);
    } else {
      youtube = getYouTubeClient({
        access_token: channel.accessToken,
        refresh_token: channel.refreshToken,
        expiry_date: channel.expiryDate,
      });
    }

    const videos = await fetchVideos(youtube, channel.channelId);
    res.json({ videos });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
