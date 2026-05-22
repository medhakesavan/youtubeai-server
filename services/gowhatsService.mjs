import axios from 'axios';
import logger from '../utils/logger.mjs';

/**
 * GoWhats API Service for sending WhatsApp messages
 * 
 * Required Environment Variables:
 * GOWHATS_API_KEY
 * GOWHATS_API_URL
 */

export const sendWhatsAppMessage = async (number, message, retries = 3) => {
  const apiKey = process.env.GOWHATS_API_KEY;
  const apiUrl = process.env.GOWHATS_API_URL;

  if (!apiKey || !apiUrl) {
    logger.error('WhatsApp API Configuration Missing: GOWHATS_API_KEY or GOWHATS_API_URL not set.');
    return { success: false, error: 'API configuration missing' };
  }

  // Normalize number: remove non-digits
  const cleanNumber = number.replace(/\D/g, '');

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      logger.info(`Attempting to send WhatsApp message to ${cleanNumber} (Attempt ${attempt}/${retries})`);
      
      const response = await axios.post(apiUrl, {
        number: cleanNumber,
        message: message
      }, {
        params: {
          access_token: apiKey // Some APIs use query params for tokens
        },
        headers: {
          'Authorization': `Bearer ${apiKey}`, // Others use Bearer tokens
          'Content-Type': 'application/json'
        },
        timeout: 10000 // 10s timeout
      });

      // Handle common success patterns
      if (response.status === 200 || response.data?.status === 'success') {
        logger.info(`WhatsApp message sent successfully to ${cleanNumber}`);
        return { success: true, data: response.data };
      } else {
        throw new Error(response.data?.message || `API returned status: ${response.status}`);
      }
    } catch (error) {
      const errorMsg = error.response?.data?.message || error.message;
      logger.error(`WhatsApp Send Failure to ${cleanNumber}: ${errorMsg}`);

      if (attempt === retries) {
        return { success: false, error: errorMsg };
      }

      // Exponential backoff
      await new Promise(resolve => setTimeout(resolve, attempt * 2000));
    }
  }
};
