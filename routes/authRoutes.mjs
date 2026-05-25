import express from 'express';
import { register, login, getMe, logout, sso } from '../controllers/authController.mjs';

const router = express.Router();

router.post('/register', register);
router.post('/login', login);
router.get('/me', getMe);
router.post('/logout', logout);
router.post('/sso', sso);

export default router;
