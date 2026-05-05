import mongoose from 'mongoose';

const channelSchema = new mongoose.Schema({
  channelId: { type: String, required: true, unique: true },
  title: String,
  customUrl: String,
  thumbnailUrl: String,
  accessToken: String,
  refreshToken: String,
  expiryDate: Number,
  settings: {
    autoLikePositive: { type: Boolean, default: true },
    autoReplyPositive: { type: Boolean, default: false },
    autoReplyMessage: { type: String, default: 'Thanks for the great comment!' },
    confidenceThreshold: { type: Number, default: 0.85 },
    toxicThreshold: { type: Number, default: 0.7 },
  },
  lastSyncedAt: Date,
}, { timestamps: true });

export default mongoose.model('Channel', channelSchema);
