import express from 'express';
import { getSettings, updateSettings, saveCredentials, updateYouTubeSettings } from '../controllers/settingsController.mjs';
import { authMiddleware } from '../middleware/auth.mjs';

const router = express.Router();

router.get('/', authMiddleware, getSettings);
router.post('/', authMiddleware, updateSettings);
router.post('/credentials', authMiddleware, saveCredentials);
router.post('/youtube', authMiddleware, updateYouTubeSettings);

export default router;
