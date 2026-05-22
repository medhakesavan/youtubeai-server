import express from 'express';
import { getLeads, exportLeads } from '../controllers/leadController.mjs';
import { authMiddleware } from '../middleware/auth.mjs';

const router = express.Router();

router.get('/', authMiddleware, getLeads);
router.get('/export', authMiddleware, exportLeads);

export default router;
