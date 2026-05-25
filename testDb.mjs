import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from './models/User.mjs';

dotenv.config();

async function test() {
  console.log('Connecting to:', process.env.MONGODB_URI);
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected');
    const users = await User.find({});
    console.log('Users found:', users.length);
    users.forEach(u => console.log(` - ${u.email}: ${u.password}`));
    process.exit(0);
  } catch (err) {
    console.error('❌ Error:', err);
    process.exit(1);
  }
}

test();
