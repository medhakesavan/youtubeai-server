import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  youtubeApiKey: { type: String, default: '' },
  youtubeChannelId: { type: String, default: '' },
  openaiApiKey:   { type: String, default: '' },
  gowhatsApiKey:  { type: String, default: '' },
  gowhatsUrl:     { type: String, default: '' },
  productLink:    { type: String, default: '' },
  settings: {
    autoMod: { type: Boolean, default: true },
    autoLike: { type: Boolean, default: true },
    confidenceThreshold: { type: Number, default: 85 },
    languages: { type: [String], default: ['English', 'Tamil', 'Tanglish'] },
    realTimeAlerts: { type: Boolean, default: true },
  },
  createdAt: { type: Date, default: Date.now }
});

export default mongoose.model('User', userSchema);
