import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { classifyComment } from './services/aiService.mjs';
import Comment from './models/Comment.mjs';
import logger from './log.mjs';

dotenv.config();

async function run() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/youtube-comments');
  logger.info('Connected to DB. Starting re-analysis of neutral comments...');

  const comments = await Comment.find({ sentiment: 'neutral' });
  logger.info(`Found ${comments.length} neutral comments to re-check and migrate.`);

  let updatedCount = 0;
  for (const comment of comments) {
    const aiResult = await classifyComment(comment.text);
    // Since we completely removed neutral, all of these will be updated
    await Comment.updateOne(
      { _id: comment._id },
      { 
        $set: {
          sentiment: aiResult.sentiment,
          toxicityScore: aiResult.toxicityScore,
          confidence: aiResult.confidence,
          detectedWords: aiResult.detectedWords,
          ...(aiResult.sentiment === 'toxic' && comment.status !== 'deleted' ? { status: 'flagged' } : {})
        }
      }
    );
    updatedCount++;
    logger.info(`Migrated: "${comment.text}" -> ${aiResult.sentiment}`);
  }

  logger.info(`Finished. Updated ${updatedCount} comments.`);
  process.exit(0);
}

run().catch(console.error);
