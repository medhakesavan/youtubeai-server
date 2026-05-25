import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from './utils/logger.mjs';
import { Server } from 'socket.io';
import http from 'http';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcryptjs';
import User from './models/User.mjs';
import routes from './routes/index.mjs';
import jwt from 'jsonwebtoken';

// ── Global Error Handlers ──────────────────────────────────────────────────────
process.on('uncaughtException', (err) => {
  logger.error({ error: err.message, stack: err.stack, worker: "global-uncaught-exception" });
});

process.on('unhandledRejection', (reason) => {
  logger.error({ error: reason?.message || reason, stack: reason?.stack, worker: "global-unhandled-rejection" });
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '.env') });

// ── Validate Environment ───────────────────────────────────────────────────────
const REQUIRED_ENV = ['MONGODB_URI', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'REDIRECT_URI'];
const missingEnv = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missingEnv.length > 0) {
  logger.error(`❌ CRITICAL STARTUP ERROR: Missing environment variables: ${missingEnv.join(', ')}`);
}

const PORT = process.env.PORT || 5000;
const app = express();
const server = http.createServer(app);

const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:5174',
  'https://youtubeai-client.vercel.app',
  'https://youtube-peach-alpha.vercel.app',
  'https://youtubeclients.vercel.app',
  'https://youtubeclients-git-main-medhakesavans-projects.vercel.app',
  ...(process.env.EXTRA_ORIGINS ? process.env.EXTRA_ORIGINS.split(',') : []),
];

const io = new Server(server, {
  cors: { origin: allowedOrigins, credentials: true }
});

const JWT_SECRET = process.env.JWT_SECRET || 'stable_dev_secret_2026';

io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error('Authentication error'));
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    socket.user = decoded;
    next();
  } catch (err) {
    next(new Error('Authentication error'));
  }
});

app.set('io', io);

// ── Middleware ─────────────────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json());
app.use(cookieParser());

import { initCommentJob } from './jobs/commentJob.mjs';

// ── Routes ─────────────────────────────────────────────────────────────────────
app.use('/api', routes);
app.get('/auth', (_req, res) => res.redirect('/api/youtube/auth'));
app.get('/', (_req, res) => res.send('AI YouTube Moderator API is running.'));

// ── Startup Sequence ───────────────────────────────────────────────────────────
async function startServer() {
  try {
    if (process.env.MONGODB_URI) {
      logger.info('⏳ Connecting to MongoDB...');
      await mongoose.connect(process.env.MONGODB_URI);
      logger.info('✅ MongoDB Connected Successfully');
    } else {
      logger.warn('⚠️ MONGODB_URI not found in environment');
    }

    // Forced Admin Reset (Development Only)
    const adminEmail = 'admin@youtubeai.test';
    await User.deleteMany({ email: adminEmail }); // Delete old record
    const hashedPassword = await bcrypt.hash('Admin@123', 10);
    await User.create({ 
      name: 'System Admin', 
      email: adminEmail, 
      password: hashedPassword 
    });
    logger.info('🚀 ADMIN ACCOUNT RESET: admin@youtubeai.test / Admin@123');

    // Start Listening
    server.listen(PORT, '0.0.0.0', () => {
      logger.info(`🚀 Server running on port ${PORT}`);
      logger.info(`🔗 API Base: http://localhost:${PORT}/api`);
      
      // Initialize Background Jobs
      initCommentJob(io);
    });

  } catch (err) {
    logger.error('❌ Critical Startup Error:', { message: err.message, stack: err.stack });
    process.exit(1);
  }
}

startServer();
