import jwt from 'jsonwebtoken';
import logger from '../utils/logger.mjs';

const JWT_SECRET = process.env.JWT_SECRET || 'stable_dev_secret_2026';

export const authMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1];

  console.log(`🛡️ [Auth Middleware] ${req.method} ${req.path} - Token received: ${token ? 'YES' : 'NO'}`);

  if (!token) {
    return res.status(401).json({ error: 'No token, authorization denied' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    logger.warn(`Invalid token attempt: ${err.message}`);
    res.status(401).json({ error: 'Token is not valid' });
  }
};
