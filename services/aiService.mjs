import OpenAI from 'openai';
import dotenv from 'dotenv';
import logger from '../log.mjs';

dotenv.config();

let openai = null;

const getOpenAI = () => {
  if (openai) return openai;
  const key = process.env.OPENAI_API_KEY;
  if (!key || key === 'your_openai_api_key_here') {
    return null;
  }
  openai = new OpenAI({ apiKey: key });
  return openai;
};

export const classifyComment = async (text) => {
  const client = getOpenAI();
  if (!client) {
    logger.warn('OpenAI API Key missing or invalid, skipping classification.');
    return { sentiment: 'neutral', toxicityScore: 0, confidence: 0 };
  }

  try {
    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "You are an AI moderator. Classify the following YouTube comment. Provide: 1) Sentiment (positive, neutral, toxic), 2) Toxicity score (0-1), 3) Confidence (0-1). Return JSON only."
        },
        {
          role: "user",
          content: text
        }
      ],
      response_format: { type: "json_object" }
    });

    const result = JSON.parse(response.choices[0].message.content);
    return {
      sentiment: result.sentiment || 'neutral',
      toxicityScore: result.toxicityScore || 0,
      confidence: result.confidence || 0
    };
  } catch (error) {
    logger.error('AI Classification error:', error);
    return { sentiment: 'neutral', toxicityScore: 0, confidence: 0 };
  }
};
