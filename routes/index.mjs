import express from 'express';
import authRoutes from './authRoutes.mjs';
import youtubeRoutes from './youtubeRoutes.mjs';
import commentRoutes from './commentRoutes.mjs';
import analyticsRoutes from './analyticsRoutes.mjs';
import leadRoutes from './leadRoutes.mjs';
import settingsRoutes from './settingsRoutes.mjs';

const router = express.Router();

router.use('/auth', authRoutes);
router.use('/youtube', youtubeRoutes);
router.use('/comments', commentRoutes);
router.use('/analytics', analyticsRoutes);
router.use('/leads', leadRoutes);
router.use('/settings', settingsRoutes);

export default router;
