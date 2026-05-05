import mongoose from 'mongoose';

const commentSchema = new mongoose.Schema({
  youtubeId: { type: String, required: true, unique: true },
  videoId: { type: String, required: true },
  text: { type: String, required: true },
  author: { type: String, required: true },
  authorProfileImageUrl: String,
  publishedAt: { type: Date, required: true },
  sentiment: { type: String, enum: ['positive', 'neutral', 'toxic'], default: 'neutral' },
  toxicityScore: { type: Number, default: 0 },
  confidence: { type: Number, default: 0 },
  status: { type: String, enum: ['pending', 'approved', 'deleted', 'flagged'], default: 'pending' },
  aiActionTaken: { type: Boolean, default: false },
  moderatedBy: String,
  moderatedAt: Date,
}, { timestamps: true });

export default mongoose.model('Comment', commentSchema);
