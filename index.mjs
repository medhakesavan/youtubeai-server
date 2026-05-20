import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import cron from 'node-cron';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from './log.mjs';
import { Server } from 'socket.io';
import http from 'http';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

// ── Global Error Handlers (PREVENT CRASH) ──────────────────────────────────────
process.on('uncaughtException', (err) => {
  logger.error({
    error: err.message,
    stack: err.stack,
    worker: "global-uncaught-exception"
  });
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error({
    error: reason?.message || reason,
    stack: reason?.stack,
    worker: "global-unhandled-rejection"
  });
});

import { getYouTubeClient, getYouTubeAuth, getYouTubeClientWithApiKey, fetchLatestComments, likeComment, deleteCommentFromYouTube, hideComment, replyToComment, fetchVideos } from './services/youtubeService.mjs';
import { classifyComment } from './services/aiService.mjs';
import Comment from './models/Comment.mjs';
import Channel from './models/Channel.mjs';
import User from './models/User.mjs';
import { authMiddleware } from './middleware/auth.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '.env') });

// ── Validate required env vars at startup ─────────────────────────────────────
const REQUIRED_ENV = ['MONGODB_URI', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'REDIRECT_URI'];
const missingEnv = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missingEnv.length > 0) {
  logger.error(`CRITICAL: Missing env vars: ${missingEnv.join(', ')}`);
  // Not exiting immediately so we can show a friendly message if needed, 
  // but most routes will fail.
}

const FRONTEND_URL = process.env.FRONTEND_URL || 'https://youtubeclients.vercel.app';
const PORT = process.env.PORT || 5000;

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: [
      'https://youtubeclients.vercel.app',
      'http://localhost:5174',
      'https://youtube-peach-alpha.vercel.app',
      ...(process.env.EXTRA_ORIGINS ? process.env.EXTRA_ORIGINS.split(',') : []),
    ],
    credentials: true,
  }
});

io.on('connection', (socket) => {
  logger.info(`New client connected: ${socket.id}`);
  socket.on('disconnect', () => logger.info('Client disconnected'));
});

app.set('io', io);

// ── Middleware ─────────────────────────────────────────────────────────────────
app.use(helmet());
app.use(
  cors({
    origin: [
      'https://youtubeclients.vercel.app',
      'http://localhost:5174',
      'https://youtube-peach-alpha.vercel.app',
      ...(process.env.EXTRA_ORIGINS ? process.env.EXTRA_ORIGINS.split(',') : []),
    ],
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());

// ── MongoDB ────────────────────────────────────────────────────────────────────
if (process.env.MONGODB_URI) {
  mongoose
    .connect(process.env.MONGODB_URI)
    .then(async () => {
      logger.info('MongoDB Connected Successfully');
      try {
        const db = mongoose.connection.db;
        const commentIndexes = await db.collection('comments').indexes();
        if (commentIndexes.some(idx => idx.name === 'youtubeId_1')) {
          await db.collection('comments').dropIndex('youtubeId_1');
          logger.info('Dropped old single-field unique index: comments.youtubeId_1');
        }
        const channelIndexes = await db.collection('channels').indexes();
        if (channelIndexes.some(idx => idx.name === 'channelId_1')) {
          await db.collection('channels').dropIndex('channelId_1');
          logger.info('Dropped old single-field unique index: channels.channelId_1');
        }
      } catch (err) {
        logger.warn('Index migration check warning (expected if collection is empty):', err.message);
      }
    })
    .catch((err) => {
      logger.error('MongoDB Connection Error:', err);
    });
} else {
  logger.error('MONGODB_URI is missing. Database features will not work.');
}

// ── Routes ─────────────────────────────────────────────────────────────────────
app.get('/', (_req, res) => res.send('AI YouTube Moderator API is running.'));
app.get('/api/ai/status', (_req, res) => {
  const hasKey = process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'your_openai_api_key_here';
  res.json({ active: !!hasKey, engine: hasKey ? 'GPT-4o-mini' : 'none' });
});

// ── App Authentication ──────────────────────────────────────────────────────────
const JWT_SECRET = process.env.JWT_SECRET || 'supersecret_fallback';

app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Please provide all fields' });
    }

    const exists = await User.findOne({ email });
    if (exists) return res.status(400).json({ error: 'User already exists' });

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({ name, email, password: hashedPassword });
    await user.save();

    res.status(201).json({ success: true, message: 'User registered successfully' });
  } catch (error) {
    logger.error('Registration Error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign({ id: user._id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });

    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });

    res.json({
      success: true,
      user: { id: user._id, name: user.name, email: user.email }
    });
  } catch (error) {
    logger.error('Login Error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/auth/me', async (req, res) => {
  try {
    const token = req.cookies.token;
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(decoded.id).select('-password');
    if (!user) return res.status(404).json({ error: 'User not found' });

    res.json(user);
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ success: true });
});

// ── Admin Seeder ──────────────────────────────────────────────────────────────
async function seedAdmin() {
  try {
    const adminEmail = 'admin@youtubeai.test';
    const exists = await User.findOne({ email: adminEmail });
    if (!exists) {
      const hashedPassword = await bcrypt.hash('Admin@123', 10);
      await new User({
        name: 'System Admin',
        email: adminEmail,
        password: hashedPassword
      }).save();
      logger.info('✅ Admin account seeded: admin@youtubeai.test');
    }
  } catch (err) {
    logger.error('Seeder Error:', err);
  }
}
seedAdmin();

// Kick off OAuth flow
app.get('/auth', (_req, res) => {
  const client = getYouTubeAuth();
  const authUrl = client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [
      'https://www.googleapis.com/auth/youtube.readonly',
      'https://www.googleapis.com/auth/youtube.force-ssl'
    ],
  });
  logger.info(`Sending OAuth request with redirect URI: ${process.env.REDIRECT_URI}`);
  res.redirect(authUrl);
});

// OAuth callback
app.get('/api/youtube/callback', async (req, res) => {
  const { code, error: oauthError } = req.query;

  if (oauthError) {
    logger.warn(`OAuth denied: ${oauthError}`);
    return res.redirect(`${FRONTEND_URL}/?error=access_denied`);
  }

  const token = req.cookies.token;
  if (!token) {
    logger.warn('OAuth callback failed: Unauthorized (no session cookie)');
    return res.redirect(`${FRONTEND_URL}/?error=unauthorized`);
  }

  let userId;
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    userId = decoded.id;
  } catch (err) {
    logger.warn(`OAuth callback failed: Invalid token - ${err.message}`);
    return res.redirect(`${FRONTEND_URL}/?error=invalid_session`);
  }

  const client = getYouTubeAuth();

  try {
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

    await Channel.findOneAndUpdate(
      { userId, channelId: channelData.id },
      { $set: updateData },
      { upsert: true, returnDocument: 'after' }
    );

    res.redirect(`${FRONTEND_URL}/dashboard?status=success`);
  } catch (error) {
    logger.error('Callback error:', error);
    res.redirect(`${FRONTEND_URL}/?error=auth_failed`);
  }
});

// ── API: Channels ──────────────────────────────────────────────────────────────
app.get('/api/youtube/channels', authMiddleware, async (req, res) => {
  try {
    const channels = await Channel.find({ userId: req.user.id }).select('title channelId thumbnailUrl apiKey');
    res.json(channels);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/youtube/videos', authMiddleware, async (req, res) => {
  try {
    const { channelId } = req.query;
    const query = { userId: req.user.id };
    if (channelId) query.channelId = channelId;
    const channel = await Channel.findOne(query);

    if (!channel) {
      return res.status(404).json({ error: 'No channel connected' });
    }

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
    logger.error('Error in /api/youtube/videos:', error);
    res.status(500).json({ error: error.message });
  }
});

// ── API: Comments ──────────────────────────────────────────────────────────────
app.get('/api/comments', authMiddleware, async (req, res) => {
  try {
    const { status, sentiment, autoLiked, videoId } = req.query;
    const query = { userId: req.user.id };
    if (status) query.status = status;
    if (sentiment) query.sentiment = sentiment;
    if (autoLiked !== undefined) query.autoLiked = autoLiked === 'true';
    if (videoId) query.videoId = videoId;

    const comments = await Comment.find(query).sort({ publishedAt: -1 }).limit(100);
    res.json(comments);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/comments/:id/action', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const { action, replyText } = req.body;

  try {
    const comment = await Comment.findOne({ _id: id, userId: req.user.id });
    if (!comment) return res.status(404).json({ error: 'Comment not found' });

    const channel = await Channel.findOne({ channelId: comment.channelId, userId: req.user.id });
    if (!channel) return res.status(404).json({ error: 'No channel connected' });

    // Prevent write operations on YouTube API if the channel is API Key based
    if (channel.apiKey && action !== 'approve') {
      return res.status(400).json({
        success: false,
        error: 'This action is not supported for channels connected using a YouTube API key. Please connect using YouTube OAuth to reply, delete, or hide comments.'
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
          comment.deleteError = deleteRes.reason;
          actionError = deleteRes.reason;
        }
        break;
      case 'like':
        const likeRes = await likeComment(youtube, comment.youtubeId);
        success = likeRes.success;
        comment.likeStatus = likeRes.status;
        comment.likeError = likeRes.reason;
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
      return res.json({ success: false, error: actionError || 'YouTube API operation failed' });
    }
    
    res.json({ success: true, comment });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.patch('/api/comments/:id/edit', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const { sentiment, status, note } = req.body;

  try {
    const comment = await Comment.findOne({ _id: id, userId: req.user.id });
    if (!comment) return res.status(404).json({ error: 'Comment not found' });

    if (sentiment) comment.sentiment = sentiment;
    if (status) comment.status = status;
    if (note !== undefined) comment.note = note;
    
    if (status === 'approved') {
       comment.aiActionTaken = true;
    }

    await comment.save();
    
    const io = req.app.get('io');
    if (io) io.emit('stats_updated');
    
    res.json({ success: true, comment });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/comments/:videoId', authMiddleware, async (req, res) => {
  try {
    const { videoId } = req.params;
    const comments = await Comment.find({ videoId, userId: req.user.id }).sort({ publishedAt: -1 });
    res.json(comments);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/youtube/comments/analyze/:videoId', authMiddleware, async (req, res) => {
  try {
    const { videoId } = req.params;
    const { channelId } = req.query;

    const query = { userId: req.user.id };
    if (channelId) query.channelId = channelId;
    const channel = await Channel.findOne(query);
    if (!channel) return res.status(404).json({ error: 'No channel connected' });

    if (channel.apiKey) {
      await processComments(channel, null, channel.apiKey);
    } else {
      await processComments(channel, {
        access_token: channel.accessToken,
        refresh_token: channel.refreshToken,
        expiry_date: channel.expiryDate,
      });
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ── API: Analytics ─────────────────────────────────────────────────────────────
app.get('/api/analytics', authMiddleware, async (req, res) => {
  try {
    const userIdObj = new mongoose.Types.ObjectId(req.user.id);
    const query = { userId: req.user.id };

    const totalComments = await Comment.countDocuments(query);
    const toxicDeleted = await Comment.countDocuments({ ...query, status: 'deleted' });
    const positiveLiked = await Comment.countDocuments({ ...query, autoLiked: true });
    const pendingModeration = await Comment.countDocuments({ ...query, status: { $in: ['pending', 'flagged'] } });

    const sentimentCounts = await Comment.aggregate([
      { $match: { userId: userIdObj } },
      { $group: { _id: '$sentiment', count: { $sum: 1 } } }
    ]);

    const languageCounts = await Comment.aggregate([
      { $match: { userId: userIdObj } },
      { $group: { _id: '$language', count: { $sum: 1 } } }
    ]);

    const wordCategoryCounts = await Comment.aggregate([
      { $match: { userId: userIdObj } },
      { $unwind: '$detectedWords' },
      { $group: { _id: '$detectedWords.category', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 5 }
    ]);

    const recentActivities = await Comment.find(query)
      .sort({ updatedAt: -1 })
      .limit(5);

    const activities = recentActivities.map(c => ({
      ...c.toObject(),
      id: c._id,
      type: c.status === 'deleted' ? 'delete' : (c.autoLiked ? 'like' : 'new_comment')
    }));

    res.json({
      totalComments,
      toxicDeleted,
      positiveLiked,
      pendingModeration,
      categories: sentimentCounts,
      languages: languageCounts,
      topCategories: wordCategoryCounts,
      activities
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/comments/reanalyze', authMiddleware, async (req, res) => {
  try {
    const { sentimentFilter } = req.body;
    const query = { userId: req.user.id };
    if (sentimentFilter) query.sentiment = sentimentFilter;
    const comments = await Comment.find(query);
    
    logger.info(`Starting re-analysis of ${comments.length} comments for user ${req.user.id} (Filter: ${sentimentFilter || 'none'})...`);
    
    const runReanalysis = async () => {
      let updatedCount = 0;
      for (const comment of comments) {
        const oldSentiment = comment.sentiment;
        const aiResult = await classifyComment(comment.text);
        
        comment.sentiment = aiResult.sentiment;
        comment.toxicityScore = aiResult.toxicityScore;
        comment.confidence = aiResult.confidence;
        comment.language = aiResult.language;
        comment.detectedWords = aiResult.detectedWords;
        
        if (oldSentiment !== aiResult.sentiment) {
          const channel = await Channel.findOne({ channelId: comment.channelId, userId: comment.userId });
          if (channel) {
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

            if (aiResult.sentiment === 'positive' && aiResult.confidence > 0.85 && !comment.autoLiked) {
              if (channel.apiKey) {
                logger.warn(`Re-analyze: API key does not support auto-like.`);
              } else {
                const success = await likeComment(youtube, comment.youtubeId);
                if (success) {
                  comment.autoLiked = true;
                  comment.aiActionTaken = true;
                }
              }
            } else if (aiResult.sentiment === 'toxic' && aiResult.confidence > 0.8 && comment.status !== 'deleted' && !comment.deleteFailed) {
              if (channel.apiKey) {
                logger.warn(`Re-analyze: API key does not support auto-delete.`);
                comment.status = 'flagged';
                comment.deleteFailed = true;
                comment.deleteError = 'API Key connection does not support deletion (OAuth required)';
              } else {
                const delRes = await deleteCommentFromYouTube(youtube, comment.youtubeId);
                if (delRes.success) {
                  comment.status = 'deleted';
                  comment.aiActionTaken = true;
                } else {
                  comment.deleteFailed = true;
                  comment.deleteError = delRes.reason;
                  comment.status = 'flagged';
                }
              }
            }
          }
          
          if (aiResult.sentiment === 'moderate' && comment.status === 'pending') {
            comment.status = 'flagged';
          }
          updatedCount++;
        }
        
        await comment.save();
      }
      
      logger.info(`Re-analysis complete. ${updatedCount} comments were updated/reclassified.`);
      const io = req.app.get('io');
      if (io) io.emit('stats_updated');
    };

    runReanalysis();
    res.json({ 
      success: true, 
      message: `Started re-analyzing ${comments.length} comments in the background. ${sentimentFilter ? `Focusing on ${sentimentFilter} comments.` : ''}` 
    });
  } catch (error) {
    logger.error('Re-analysis route error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/comments/batch-like', authMiddleware, async (req, res) => {
  try {
    const comments = await Comment.find({
      userId: req.user.id,
      sentiment: 'positive',
      autoLiked: false,
      likeStatus: { $nin: ['not_supported'] },
      youtubeId: { $exists: true, $ne: null }
    });

    if (comments.length === 0) {
      return res.json({ success: true, message: 'No eligible positive comments found to auto-like.' });
    }

    const channel = await Channel.findOne({ channelId: comments[0].channelId, userId: req.user.id });
    if (!channel) {
      return res.status(404).json({ error: 'No connected channel found.' });
    }

    if (channel.apiKey) {
      return res.status(400).json({
        success: false,
        error: 'Batch auto-like is not supported for channels connected via API Key. Please connect using YouTube OAuth.'
      });
    }

    logger.info(`Starting batch auto-like for ${comments.length} positive comments...`);

    const runBatchLike = async () => {
      let successCount = 0;
      let failCount = 0;

      const youtube = getYouTubeClient({
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

      for (const comment of comments) {
        if (!comment.text || comment.text.trim().length <= 3) continue;

        logger.info(`Batch: Processing like for comment ${comment.youtubeId}`);
        const likeRes = await likeComment(youtube, comment.youtubeId);

        if (likeRes.success) {
          comment.autoLiked = true;
          comment.aiActionTaken = true;
          comment.likeStatus = 'success';
          comment.likeError = null;
          successCount++;
          
          const io = app.get('io');
          if (io) {
            io.emit('live_activity', {
              ...comment.toObject(),
              id: comment._id,
              type: 'like'
            });
          }
        } else {
          comment.likeStatus = likeRes.status;
          comment.likeError = likeRes.reason;
          failCount++;
        }
        await comment.save();
      }

      logger.info(`Batch auto-like complete. Success: ${successCount}, Failed: ${failCount}`);
      const io = app.get('io');
      if (io) io.emit('stats_updated');
    };

    runBatchLike();
    res.json({ success: true, message: `Started batch auto-like processing for ${comments.length} positive comments.` });
  } catch (error) {
    logger.error('Batch like route error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ── API: Tenant Settings ────────────────────────────────────────────────────────
app.get('/api/settings', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const maskedKey = user.youtubeApiKey
      ? `${user.youtubeApiKey.substring(0, 8)}...${user.youtubeApiKey.substring(user.youtubeApiKey.length - 4)}`
      : '';

    res.json({
      settings: user.settings,
      youtubeApiKey: maskedKey,
      youtubeChannelId: user.youtubeChannelId
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/settings', authMiddleware, async (req, res) => {
  try {
    const { settings } = req.body;
    if (!settings) return res.status(400).json({ error: 'Settings payload is required' });

    const user = await User.findByIdAndUpdate(
      req.user.id,
      { $set: { settings } },
      { new: true }
    );

    res.json({ success: true, settings: user.settings });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/settings/youtube', authMiddleware, async (req, res) => {
  try {
    const { apiKey, channelId } = req.body;
    
    if (!channelId) {
      return res.status(400).json({ error: 'Channel ID is required' });
    }

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    let finalApiKey = apiKey;
    
    // If the apiKey provided is masked (contains '...'), and we already have a key saved,
    // we use the existing key. Otherwise if it's empty, we clear it.
    if (apiKey && apiKey.includes('...')) {
      if (user.youtubeApiKey) {
        finalApiKey = user.youtubeApiKey;
      } else {
        return res.status(400).json({ error: 'Invalid API Key provided' });
      }
    }

    if (!finalApiKey) {
      // User wants to disconnect the API key channel
      await Channel.findOneAndDelete({ userId: req.user.id, apiKey: { $exists: true } });
      user.youtubeApiKey = '';
      user.youtubeChannelId = '';
      await user.save();
      return res.json({ success: true, message: 'YouTube connection removed successfully' });
    }

    logger.info(`Validating YouTube API key for channel: ${channelId}`);
    
    let channelData;
    try {
      const youtube = getYouTubeClientWithApiKey(finalApiKey);
      const response = await youtube.channels.list({
        part: 'snippet,contentDetails',
        id: channelId
      });
      if (response.data.items && response.data.items.length > 0) {
        channelData = response.data.items[0];
      } else {
        return res.status(400).json({ error: 'Channel ID not found on YouTube. Please verify and try again.' });
      }
    } catch (err) {
      logger.error('YouTube API validation failed:', err.message);
      return res.status(400).json({ error: `YouTube API Key validation failed: ${err.message}` });
    }

    // Save/update settings on User document
    user.youtubeApiKey = finalApiKey;
    user.youtubeChannelId = channelId;
    await user.save();

    // Upsert the Channel document for this user
    const uploadsPlaylistId = channelData.contentDetails?.relatedPlaylists?.uploads || '';
    
    await Channel.findOneAndUpdate(
      { userId: req.user.id, channelId },
      {
        $set: {
          userId: req.user.id,
          channelId,
          title: channelData.snippet.title,
          thumbnailUrl: channelData.snippet.thumbnails?.default?.url || '',
          customUrl: channelData.snippet.customUrl || '',
          apiKey: finalApiKey,
          uploadsPlaylistId
        }
      },
      { upsert: true, returnDocument: 'after' }
    );

    const maskedKey = `${finalApiKey.substring(0, 8)}...${finalApiKey.substring(finalApiKey.length - 4)}`;
    
    res.json({
      success: true,
      message: 'YouTube API Key and Channel details validated and saved successfully!',
      youtubeApiKey: maskedKey,
      youtubeChannelId: channelId
    });
  } catch (error) {
    logger.error('Error saving YouTube API key settings:', error);
    res.status(500).json({ error: error.message });
  }
});

// ── Background Worker ──────────────────────────────────────────────────────────
async function processComments(channel, tokens = null, apiKey = null) {
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

    logger.info(`Worker: Fetching latest comments for channel ${channel.channelId}...`);
    const comments = await fetchLatestComments(youtube, channel.channelId, 50);
    if (!comments || comments.length === 0) {
      logger.info(`Worker: No new comments found for channel ${channel.channelId}.`);
      return;
    }

    logger.info(`Worker: Analyzing ${comments.length} comments...`);
    const io = app.get('io');
    
    const user = await User.findById(channel.userId);
    const userSettings = user?.settings || { autoMod: true, confidenceThreshold: 85 };
    const confidenceThresholdDecimal = (userSettings.confidenceThreshold || 85) / 100;
    
    for (const c of comments) {
      // 1. Classification
      const aiResult = await classifyComment(c.text);
      
      // 2. Logic & Thresholds
      const isPositive = aiResult.sentiment === 'positive' && aiResult.confidence >= confidenceThresholdDecimal;
      const isToxic = aiResult.sentiment === 'toxic' && aiResult.confidence >= confidenceThresholdDecimal;
      const isMeaningful = c.text.trim().length > 3;

      // 3. Check existing record
      const existing = await Comment.findOne({ userId: channel.userId, youtubeId: c.youtubeId });
      
      let status = aiResult.sentiment === 'toxic' ? 'flagged' : 'pending';
      let autoLiked = false;
      let deleteFailed = false;
      let deleteErrorReason = null;
      let likeStatus = 'none';
      let likeError = null;

      // 4. Action: Auto-Delete (Reject) - Only if autoMod is enabled
      if (isToxic && userSettings.autoMod && (!existing || (existing.status !== 'deleted' && !existing.deleteFailed))) {
        if (apiKey) {
          logger.warn(`Worker: Cannot AUTO-DELETE comment ${c.youtubeId} because channel is connected via API key (OAuth required).`);
          status = 'flagged';
          deleteFailed = true;
          deleteErrorReason = 'Authentication via API Key does not permit write actions (OAuth required)';
        } else {
          logger.info(`Worker: Triggering AUTO-DELETE for toxic comment: ${c.youtubeId}`);
          const delRes = await deleteCommentFromYouTube(youtube, c.youtubeId);
          if (delRes.success) {
            status = 'deleted';
            logger.info(`Worker: Successfully deleted comment: ${c.youtubeId}`);
          } else {
            deleteFailed = true;
            deleteErrorReason = delRes.reason;
            status = 'flagged';
            logger.error(`Worker: Delete failed for ${c.youtubeId}: ${delRes.reason}`);
          }
        }
      } 
      // 5. Action: Auto-Like (Reply Fallback)
      else if (isPositive && isMeaningful && (!existing || existing.likeStatus === 'none')) {
        if (apiKey) {
          logger.warn(`Worker: Cannot AUTO-LIKE comment ${c.youtubeId} because channel is connected via API key (OAuth required).`);
          likeStatus = 'not_supported';
          likeError = 'Authentication via API Key does not permit write actions (OAuth required)';
        } else {
          logger.info(`Worker: Triggering AUTO-REPLY (Like Fallback) for positive comment: ${c.youtubeId}`);
          const result = await likeComment(youtube, c.youtubeId);
          likeStatus = result.status;
          likeError = result.reason;
          autoLiked = result.success;
          if (result.success) {
            logger.info(`Worker: Successfully replied to positive comment: ${c.youtubeId}`);
          } else {
            logger.warn(`Worker: Reply failed for ${c.youtubeId}: ${result.reason}`);
          }
        }
      }

      // 6. Persistence
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
          deleteFailed: deleteFailed,
          deleteError: deleteErrorReason,
          likeStatus: likeStatus !== 'none' ? likeStatus : (existing ? existing.likeStatus : 'none'),
          likeError: likeError || (existing ? existing.likeError : null),
          aiActionTaken: (existing && existing.aiActionTaken) || status === 'deleted' || autoLiked || deleteFailed
        },
        { upsert: true, returnDocument: 'after' }
      );

      // 7. Real-time updates
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
}

cron.schedule('*/15 * * * * *', async () => {
  try {
    const channels = await Channel.find();
    for (const channel of channels) {
      if (channel.apiKey) {
        await processComments(channel, null, channel.apiKey);
      } else {
        await processComments(channel, {
          access_token: channel.accessToken,
          refresh_token: channel.refreshToken,
          expiry_date: channel.expiryDate,
        });
      }
    }
  } catch (error) {
    logger.error('Cron error:', error);
  }
});

server.listen(PORT, () => {
  logger.info(`🚀 Server running on port ${PORT}`);
});
