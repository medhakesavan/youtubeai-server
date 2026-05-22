import cron from 'node-cron';
import Channel from '../models/Channel.mjs';
import { processComments } from '../services/commentProcessingService.mjs';
import logger from '../utils/logger.mjs';

export const initCommentJob = (io) => {
  cron.schedule('*/15 * * * * *', async () => {
    try {
      logger.info('Running scheduled comment analysis...');
      const channels = await Channel.find();
      for (const channel of channels) {
        if (channel.apiKey) {
          await processComments(channel, null, channel.apiKey, io);
        } else {
          await processComments(channel, {
            access_token: channel.accessToken,
            refresh_token: channel.refreshToken,
            expiry_date: channel.expiryDate,
          }, null, io);
        }
      }
    } catch (error) {
      logger.error('Cron error:', error);
    }
  });
  logger.info('Scheduled comment analysis job initialized (Every 15s)');
};
