import Lead from '../models/Lead.mjs';
import logger from '../utils/logger.mjs';

/**
 * Detect Indian phone numbers using regex
 * Patterns:
 * 9876543210
 * +91 9876543210
 * 98765 43210
 */
export const detectWhatsAppNumber = (text) => {
  // Regex for Indian numbers
  // Matches: 
  // 1. Optional +91 or 91 prefix
  // 2. Optional space or hyphen
  // 3. 10 digits total, potentially split by space or hyphen
  const indianNumberRegex = /(?:\+91|91)?[-\s]?[6-9]\d{4}[-\s]?\d{5}\b/g;
  
  const matches = text.match(indianNumberRegex);
  if (!matches) return null;

  // Take the first valid match and normalize it
  const rawNumber = matches[0];
  const digitsOnly = rawNumber.replace(/\D/g, '');
  
  // Normalize to 10 digits or 12 digits (91XXXXXXXXXX)
  let normalized = digitsOnly;
  if (digitsOnly.length === 10) {
    normalized = '91' + digitsOnly;
  } else if (digitsOnly.length === 12 && digitsOnly.startsWith('91')) {
    normalized = digitsOnly;
  } else if (digitsOnly.length > 10) {
    // Handle cases where more than 10 digits are picked up but might be valid if trimmed
    normalized = digitsOnly.slice(-10);
    normalized = '91' + normalized;
  } else {
    // Invalid length
    return null;
  }

  return normalized;
};

/**
 * Check if a lead with same number was recently created (duplicate protection)
 */
export const isDuplicateLead = async (number, userId) => {
  // Consider duplicate if same number exists for this user in last 24 hours
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const existing = await Lead.findOne({
    userId,
    whatsappNumber: number,
    createdAt: { $gte: oneDayAgo }
  });
  return !!existing;
};

/**
 * Create a new lead
 */
export const createLead = async (leadData) => {
  try {
    const isDuplicate = await isDuplicateLead(leadData.whatsappNumber, leadData.userId);
    
    const lead = new Lead({
      ...leadData,
      status: isDuplicate ? 'duplicate' : 'pending'
    });

    await lead.save();
    return { lead, isDuplicate };
  } catch (error) {
    logger.error(`Error creating lead: ${error.message}`);
    throw error;
  }
};
