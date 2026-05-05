import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import cron from 'node-cron';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from './log.mjs';
import { getYouTubeClient, getYouTubeAuth, fetchLatestComments } from './services/youtubeService.mjs';
import { classifyComment } from './services/aiService.mjs';
import Comment from './models/Comment.mjs';
import Channel from './models/Channel.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '.env') });

// ── Validate required env vars at startup ─────────────────────────────────────
const REQUIRED_ENV = ['MONGODB_URI', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'REDIRECT_URI'];
const missingEnv = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missingEnv.length > 0) {
  logger.error(`CRITICAL: Missing env vars: ${missingEnv.join(', ')}`);
  process.exit(1);
}

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const PORT = process.env.PORT || 5000;

const app = express();

// ── Middleware ─────────────────────────────────────────────────────────────────
app.use(helmet());
app.use(
  cors({
    origin: [
      'http://localhost:5173',
      'https://youtube-peach-alpha.vercel.app',
      ...(process.env.EXTRA_ORIGINS ? process.env.EXTRA_ORIGINS.split(',') : []),
    ],
    credentials: true,
  })
);
app.use(express.json());

// ── MongoDB ────────────────────────────────────────────────────────────────────
mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => logger.info('MongoDB Connected Successfully'))
  .catch((err) => {
    logger.error('MongoDB Connection Error:', err);
    process.exit(1);
  });

// ── Routes ─────────────────────────────────────────────────────────────────────
app.get('/', (_req, res) => res.send('AI YouTube Moderator API is running.'));

// Kick off OAuth flow — each request gets its own fresh client
app.get('/auth', (_req, res) => {
  const client = getYouTubeAuth();
  const authUrl = client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: ['https://www.googleapis.com/auth/youtube.force-ssl'],
  });
  logger.info(`Sending OAuth request with redirect URI: ${process.env.REDIRECT_URI}`);
  res.redirect(authUrl);
});

app.get('/oauth', (_req, res) => res.redirect('/auth'));

// OAuth callback
app.get('/api/youtube/callback', async (req, res) => {
  const { code, error: oauthError } = req.query;

  if (oauthError) {
    logger.warn(`OAuth denied by user: ${oauthError}`);
    return res.redirect(`${FRONTEND_URL}/?error=access_denied`);
  }

  if (!code) {
    logger.warn('OAuth callback hit with no code');
    return res.redirect(`${FRONTEND_URL}/?error=missing_code`);
  }

  // Each callback gets its own client instance to avoid token collisions
  const client = getYouTubeAuth();

  try {
    logger.info('OAuth callback hit with code: PRESENT');

    const { tokens } = await client.getToken(code);
    client.setCredentials(tokens);

    const youtube = getYouTubeClient(tokens);
    const channelRes = await youtube.channels.list({ part: 'snippet', mine: true });
    const items = channelRes.data.items;

    if (!items || items.length === 0) {
      throw new Error(
        'No YouTube channel found for this Google account. Please create a YouTube channel first.'
      );
    }

    const channelData = items[0];

    await Channel.findOneAndUpdate(
      { channelId: channelData.id },
      {
        channelId: channelData.id,
        title: channelData.snippet.title,
        thumbnailUrl: channelData.snippet.thumbnails?.default?.url || '',
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiryDate: tokens.expiry_date,
      },
      { upsert: true, new: true }
    );

    logger.info(`Channel connected: ${channelData.snippet.title} (${channelData.id})`);

    // Redirect first, then process comments in background
    res.redirect(`${FRONTEND_URL}/?connected=true`);

    // Fire-and-forget with proper error containment
    processComments(channelData.id, tokens).catch((err) =>
      logger.error('Background processComments error:', err)
    );
  } catch (error) {
    logger.error('OAuth Callback Error:', error);
    const reason = encodeURIComponent(error.message || 'unknown_error');
    res.redirect(`${FRONTEND_URL}/?error=auth_failed&reason=${reason}`);
  }
});

// ── API: Channels ──────────────────────────────────────────────────────────────
app.get('/api/youtube/channels', async (_req, res) => {
  try {
    const channels = await Channel.find().select('title channelId thumbnailUrl');
    res.json(channels);
  } catch (error) {
    logger.error('GET /api/youtube/channels error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/youtube/disconnect', async (req, res) => {
  try {
    const { channelId } = req.body;
    if (!channelId) return res.status(400).json({ error: 'channelId is required' });

    const deleted = await Channel.findOneAndDelete({ channelId });
    if (!deleted) return res.status(404).json({ error: 'Channel not found' });

    res.json({ success: true, message: 'Disconnected successfully' });
  } catch (error) {
    logger.error('POST /api/youtube/disconnect error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ── API: Comments ──────────────────────────────────────────────────────────────
app.get('/api/comments', async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ error: 'Database not connected yet.' });
    }

    const { status, sentiment } = req.query;
    const query = {};
    if (status) query.status = status;
    if (sentiment) query.sentiment = sentiment;

    const comments = await Comment.find(query).sort({ publishedAt: -1 }).limit(100);
    res.json(comments);
  } catch (error) {
    logger.error('GET /api/comments error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/comments/:id/action', async (req, res) => {
  try {
    const { action } = req.body;
    if (!['approve', 'delete'].includes(action)) {
      return res.status(400).json({ error: 'Invalid action. Use "approve" or "delete".' });
    }

    const comment = await Comment.findById(req.params.id);
    if (!comment) return res.status(404).json({ error: 'Comment not found' });

    const channel = await Channel.findOne();
    if (!channel) return res.status(404).json({ error: 'No connected channel found' });

    // Use refresh token so expired access tokens are handled automatically
    const youtube = getYouTubeClient({
      access_token: channel.accessToken,
      refresh_token: channel.refreshToken,
      expiry_date: channel.expiryDate,
    });

    if (action === 'approve') {
      comment.status = 'approved';
    } else if (action === 'delete') {
      await youtube.comments.delete({ id: comment.youtubeId });
      comment.status = 'deleted';
    }

    await comment.save();
    res.json(comment);
  } catch (error) {
    logger.error('POST /api/comments/:id/action error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ── Moderation Logic ───────────────────────────────────────────────────────────
async function processComments(channelId, tokens) {
  try {
    const youtube = getYouTubeClient(tokens);
    const comments = await fetchLatestComments(youtube, channelId);

    if (!comments || comments.length === 0) {
      logger.info(`No new comments found for channel: ${channelId}`);
      return;
    }

    let saved = 0;
    for (const c of comments) {
      const exists = await Comment.findOne({ youtubeId: c.youtubeId });
      if (exists) continue;

      const aiResult = await classifyComment(c.text);

      const newComment = new Comment({
        ...c,
        sentiment: aiResult.sentiment,
        toxicityScore: aiResult.toxicityScore,
        confidence: aiResult.confidence,
        status: aiResult.sentiment === 'toxic' ? 'flagged' : 'pending',
      });

      await newComment.save();
      saved++;
    }

    logger.info(`Processed ${comments.length} comments, saved ${saved} new for channel: ${channelId}`);
  } catch (error) {
    logger.error(`processComments error for channel ${channelId}:`, error);
  }
}

// ── Cron: every 5 minutes ──────────────────────────────────────────────────────
cron.schedule('*/5 * * * *', async () => {
  try {
    const channels = await Channel.find();
    if (channels.length === 0) return;

    logger.info(`Cron: checking ${channels.length} channel(s) for new comments`);
    for (const channel of channels) {
      await processComments(channel.channelId, {
        access_token: channel.accessToken,
        refresh_token: channel.refreshToken,
        expiry_date: channel.expiryDate,
      });
    }
  } catch (error) {
    logger.error('Cron job error:', error);
  }
});

// ── Start ──────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
});
