import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from './models/User.mjs';
import bcrypt from 'bcryptjs';

dotenv.config();

async function test() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    const email = 'admin@youtubeai.test';
    const hashedPassword = await bcrypt.hash('Admin@123', 10);
    
    await User.findOneAndUpdate(
      { email },
      { password: hashedPassword },
      { upsert: true, new: true }
    );
    
    console.log('✅ Admin password reset to: Admin@123');
    process.exit(0);
  } catch (err) {
    console.error('❌ Error:', err);
    process.exit(1);
  }
}

test();
