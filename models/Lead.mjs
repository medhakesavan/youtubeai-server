import mongoose from 'mongoose';

const leadSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  channelId: { type: String, required: true },
  videoId: { type: String, required: true },
  commentId: { type: String, required: true, unique: true },
  authorName: { type: String, required: true },
  originalComment: { type: String, required: true },
  whatsappNumber: { type: String, required: true },
  status: { 
    type: String, 
    enum: ['pending', 'sent', 'failed', 'duplicate'], 
    default: 'pending' 
  },
  isHidden: { type: Boolean, default: false },
  whatsappSent: { type: Boolean, default: false },
  errorLog: { type: String },
  detectedAt: { type: Date, default: Date.now }
}, { timestamps: true });

// Index for duplicate protection and fast lookups
leadSchema.index({ whatsappNumber: 1, createdAt: -1 });

export default mongoose.model('Lead', leadSchema);
