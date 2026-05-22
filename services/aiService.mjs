
import OpenAI from 'openai';
import dotenv from 'dotenv';
import logger from '../utils/logger.mjs';

dotenv.config();

let openai = null;
let openAIAvailable = true;

const getOpenAI = () => {
  if (openai) return openai;
  if (!openAIAvailable) return null;

  const rawKey = process.env.OPENAI_API_KEY || '';
  const key = rawKey.trim().replace(/^["']|["']$/g, '');
  
  if (!key || key === 'your_openai_api_key_here' || key.length < 20) {
    logger.error('CRITICAL: OpenAI API key is missing or invalid in .env file!');
    logger.error('AI Classification will be disabled. System will fallback to keyword matching.');
    openAIAvailable = false;
    return null;
  }
  
  const maskedKey = `${key.substring(0, 7)}...${key.substring(key.length - 4)}`;
  logger.info(`OpenAI Client initialized safely. Masked key: ${maskedKey}`);

  openai = new OpenAI({ apiKey: key });
  return openai;
};

const POSITIVE_KEYWORDS = [
  'great', 'good', 'nice', 'awesome', 'excellent', 'super', 'mass', 'thalaiva', 'vera level', 'superb', 
  'keep it up', 'thanks', 'thank you', 'love', 'wow', 'amazing', 'nandri', 'arumai', 'gethu', 'vazhthukal', 
  'massu', 'fire', 'lit', 'best', 'proud', 'heart', 'king', 'legend', 'congrats', 'brilliant',
  'nanba', 'nanbi', 'thala', 'thalapathy', 'vjs', 'sk', 'super star', 'alaithu', 'nalla', 'nalladhu',
  'dhool', 'kalakureenga', 'semma', 'massiva', 'waiting', 'luv', 'marana mass', 'attagasam',
  'gud', 'superr', 'op', 'overpowered', 'king', 'thalaivar', 'leader', 'master', 'beast', 'vaathi',
  'makkal selvan', 'thala', 'ajith', 'vijay', 'surya', 'u1', 'anirudh', 'arr', 'bgm', 'massss',
  'lovely', 'beautiful', 'wonderful', 'congratulations', 'congrats', 'bravo', 'perfect', '10/10'
];

const TOXIC_KEYWORDS = [
  'bad', 'useless', 'trash', 'shut up', 'idiot', 'stupid', 'fuck', 'shit', 'garbage', 'waste', 'fool', 
  'worst', 'poda', 'moodu', 'wasteu', 'kevalam', 'mokka', 'irritating', 'hate', 'die', 'fake',
  'mental', 'lossu', 'pavalam', 'loosu', 'dummy', 'waste', 'kena', 'komali', 'karumam', 'cheii',
  'worst video', 'dislike', 'unsubscribed', 'unsub', 'scam', 'fraud', 'copy', 'dei', 'da', 'punda', 'omala',
  'mayiru', 'gotha', 'go*tha', 'otha', 'thevidiya', 'baadu', 'sunni', 'poolu', 'koothi', 'omala', 'ommala',
  'sunniya', 'punda', 'mande', 'vetti', 'waste', 'fucker', 'asshole', 'bitch', 'scammer', 'clickbait'
];

export const classifyComment = async (text) => {
  const client = getOpenAI();
  const lowerText = text.toLowerCase().trim();
  
  // ── Step 1: Lightweight Keyword Pre-Check ──────────────────────────────────
  let keywordDetected = false;
  let detectedSentiment = null;
  let detectedWords = [];

  const escapeRegExp = (string) => string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const positiveMatches = POSITIVE_KEYWORDS.filter(word => {
    const regex = new RegExp(`\\b${escapeRegExp(word)}\\b`, 'i');
    return regex.test(lowerText);
  });
  const toxicMatches = TOXIC_KEYWORDS.filter(word => {
    const regex = new RegExp(`\\b${escapeRegExp(word)}\\b`, 'i');
    return regex.test(lowerText);
  });

  if (positiveMatches.length > 0 && toxicMatches.length === 0) {
    detectedSentiment = 'positive';
    keywordDetected = true;
    detectedWords = positiveMatches.map(w => ({ word: w, category: 'appreciation' }));
  } else if (toxicMatches.length > 0) {
    detectedSentiment = 'toxic';
    keywordDetected = true;
    detectedWords = toxicMatches.map(w => ({ word: w, category: 'insult' }));
  }

  // ── Step 1.5: Fast-Pass for Short Clear Comments ──────────────────────────
  // Bypass AI for very short comments with clear sentiment to save cost/time
  if (keywordDetected && lowerText.length < 25) {
    return {
      sentiment: detectedSentiment,
      toxicityScore: detectedSentiment === 'toxic' ? 0.8 : 0,
      confidence: 0.95,
      language: 'English', // Assumption for fast-pass
      detectedWords
    };
  }

  // ── Step 2: AI Classification ──────────────────────────────────────────────
  if (!client) {
    // Only log warning if openAIAvailable is still true (meaning it just failed to init)
    if (openAIAvailable) {
      logger.warn('OpenAI API Key missing, using keyword fallback.');
    }
    return {
      sentiment: detectedSentiment || 'moderate',
      toxicityScore: detectedSentiment === 'toxic' ? 0.8 : 0,
      confidence: keywordDetected ? 0.9 : 0.5,
      language: 'unknown',
      detectedWords
    };
  }

  try {
    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are a high-accuracy YouTube moderation AI. Classify comments into: [positive, neutral, moderate, toxic].
          
          Classification Rules:
          - positive: Appreciation, praise, excitement, thanks, or support. 
            IMPORTANT: Short comments like "good", "nice", "wow", "great" are ALWAYS POSITIVE, never neutral.
          - toxic: Abusive, hate speech, threats, heavy swearing, or clear insults.
          - moderate: Sarcasm, borderline toxicity, passive-aggressive remarks, or slightly disrespectful but not fully toxic.
          - neutral: Purely factual information, robotic questions, or data with NO emotion whatsoever.
          
          Confidence Scoring:
          - Return a float between 0 and 1. 
          - High confidence (0.9+) for clear cases.
          - Lower confidence for ambiguous or very short text without clear markers.

          Categorization:
          - Extract words/phrases into detectedWords with categories: [appreciation, praise, insult, threat, sarcasm, info, question].

          Languages Supported: English, Tamil, Tanglish (Tamil in English script).`
        },
        {
          role: "user",
          content: text
        }
      ],
      response_format: { type: "json_object" }
    });

    const result = JSON.parse(response.choices[0].message.content);
    
    let finalSentiment = result.sentiment || 'moderate';
    let finalConfidence = result.confidence || 0.5;
    let finalWords = result.detectedWords || [];

    // ── Step 3: Logic Refinement / Overrides ────────────────────────────────
    // If text is very short and we found positive keywords, enforce POSITIVE
    if (lowerText.length < 20 && positiveMatches.length > 0 && (finalSentiment === 'moderate' || finalSentiment === 'neutral')) {
      finalSentiment = 'positive';
      finalConfidence = Math.max(finalConfidence, 0.9);
      // Merge detected words
      const existingWords = new Set(finalWords.map(w => w.word.toLowerCase()));
      positiveMatches.forEach(w => {
        if (!existingWords.has(w)) {
          finalWords.push({ word: w, category: 'appreciation' });
        }
      });
    }

    return {
      sentiment: finalSentiment,
      toxicityScore: result.toxicityScore || (finalSentiment === 'toxic' ? 0.8 : (finalSentiment === 'moderate' ? 0.4 : 0)),
      confidence: finalConfidence,
      language: result.detectedLanguage || 'English',
      detectedWords: finalWords
    };
  } catch (error) {
    if (error.status === 401 || (error.message && error.message.includes('Incorrect API key'))) {
      if (openAIAvailable) {
        logger.error('CRITICAL: OpenAI API returned 401 Unauthorized.');
        logger.error('Your API key is invalid, deleted, or missing credits (Project Key).');
        logger.error('Disabling AI queries to prevent crash loops and spam. Fix your .env and restart.');
        openAIAvailable = false;
      }
    } else {
      logger.error('AI Classification error:', error.message || error);
    }
    
    return {
      sentiment: detectedSentiment || 'moderate',
      toxicityScore: detectedSentiment === 'toxic' ? 0.8 : 0,
      confidence: keywordDetected ? 0.9 : 0.5,
      language: 'unknown',
      detectedWords
    };
  }
};
