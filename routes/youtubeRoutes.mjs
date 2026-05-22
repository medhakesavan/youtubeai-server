import express from 'express';
import { initiateAuth, handleCallback, getChannels, deleteChannel, getVideos } from '../controllers/youtubeController.mjs';
import { authMiddleware } from '../middleware/auth.mjs';

const router = express.Router();

router.get('/auth', initiateAuth);
router.get('/callback', handleCallback);
router.get('/channels', authMiddleware, getChannels);
router.delete('/channels/:channelId', authMiddleware, deleteChannel);
router.get('/videos', authMiddleware, getVideos);

export default router;
