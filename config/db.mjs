import mongoose from 'mongoose';
import logger from '../utils/logger.mjs';

export const connectDB = async () => {
  if (!process.env.MONGODB_URI) {
    logger.error('❌ MONGODB_URI is missing!');
    process.exit(1);
  }

  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI);
    logger.info(`✅ MongoDB Connected: ${conn.connection.host}`);
    
    // Index migration check
    const db = mongoose.connection.db;
    const commentIndexes = await db.collection('comments').indexes();
    if (commentIndexes.some(idx => idx.name === 'youtubeId_1')) {
      await db.collection('comments').dropIndex('youtubeId_1');
      logger.info('Dropped old single-field unique index: comments.youtubeId_1');
    }
    
    const channelIndexes = await db.collection('channels').indexes();
    if (channelIndexes.some(idx => idx.name === 'channelId_1')) {
      await db.collection('channels').dropIndex('channelId_1');
      logger.info('Dropped old single-field unique index: channels.channelId_1');
    }
  } catch (error) {
    logger.error(`❌ MongoDB Connection Error: ${error.message}`);
    process.exit(1);
  }
};
