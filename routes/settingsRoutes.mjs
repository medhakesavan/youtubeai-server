import express from 'express';
import { getSettings, updateSettings, updateYouTubeSettings } from '../controllers/settingsController.mjs';
import { authMiddleware } from '../middleware/auth.mjs';

const router = express.Router();

router.get('/', authMiddleware, getSettings);
router.post('/', authMiddleware, updateSettings);
router.post('/youtube', authMiddleware, updateYouTubeSettings);

export default router;
