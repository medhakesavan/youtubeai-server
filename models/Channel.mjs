import mongoose from 'mongoose';

const channelSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  channelId: { type: String, required: true },
  title: String,
  customUrl: String,
  thumbnailUrl: String,
  accessToken: String,
  refreshToken: String,
  expiryDate: Number,
  apiKey: String,
  uploadsPlaylistId: String,
  settings: {
    autoLikePositive: { type: Boolean, default: true },
    autoReplyPositive: { type: Boolean, default: false },
    autoReplyMessage: { type: String, default: 'Thanks for the great comment!' },
    confidenceThreshold: { type: Number, default: 0.85 },
    toxicThreshold: { type: Number, default: 0.7 },
  },
  lastSyncedAt: Date,
}, { timestamps: true });

channelSchema.index({ userId: 1, channelId: 1 }, { unique: true });

export default mongoose.model('Channel', channelSchema);
