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
  'https://youtube-peach-alpha.vercel.app',
  'https://youtubeclients.vercel.app',
  'https://youtubeclients-git-main-medhakesavans-projects.vercel.app',
  ...(process.env.EXTRA_ORIGINS ? process.env.EXTRA_ORIGINS.split(',') : []),
];

const io = new Server(server, {
  cors: { origin: allowedOrigins, credentials: true }
});

app.set('io', io);

// ── Middleware ─────────────────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json());
app.use(cookieParser());

// ── MongoDB ────────────────────────────────────────────────────────────────────
if (process.env.MONGODB_URI) {
  mongoose.connect(process.env.MONGODB_URI)
    .then(() => logger.info('✅ MongoDB Connected Successfully'))
    .catch((err) => logger.error('❌ MongoDB Connection Error:', err.message));
}

// ── Routes ─────────────────────────────────────────────────────────────────────
app.use('/api', routes);

// Legacy/Compatibility Redirects
app.get('/auth', (_req, res) => res.redirect('/api/youtube/auth'));
app.get('/', (_req, res) => res.send('AI YouTube Moderator API is running.'));

// ── Admin Seeder ──────────────────────────────────────────────────────────────
async function seedAdmin() {
  try {
    const adminEmail = 'admin@youtubeai.test';
    const exists = await User.findOne({ email: adminEmail });
    if (!exists) {
      const hashedPassword = await bcrypt.hash('Admin@123', 10);
      await new User({ name: 'System Admin', email: adminEmail, password: hashedPassword }).save();
      logger.info('✅ Admin account seeded: admin@youtubeai.test');
    }
  } catch (err) {
    logger.error('Seeder Error:', err);
  }
}
seedAdmin();

// ── Start Server ──────────────────────────────────────────────────────────────
server.listen(PORT, '0.0.0.0', () => {
  logger.info(`🚀 Server running on port ${PORT}`);
  logger.info(`🔗 API Base: http://localhost:${PORT}/api`);
});
