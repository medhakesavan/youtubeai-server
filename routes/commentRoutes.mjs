import express from 'express';
import { getComments, takeAction, editComment, reanalyzeComments, manualSync } from '../controllers/commentController.mjs';
import { authMiddleware } from '../middleware/auth.mjs';

const router = express.Router();

router.get('/', authMiddleware, getComments);
router.post('/:id/action', authMiddleware, takeAction);
router.patch('/:id/edit', authMiddleware, editComment);
router.post('/reanalyze', authMiddleware, reanalyzeComments);
router.get('/analyze/:videoId', authMiddleware, manualSync);

export default router;
