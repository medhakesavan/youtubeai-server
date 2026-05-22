import express from 'express';
import { getAnalytics } from '../controllers/analyticsController.mjs';
import { authMiddleware } from '../middleware/auth.mjs';

const router = express.Router();

router.get('/', authMiddleware, getAnalytics);

export default router;
