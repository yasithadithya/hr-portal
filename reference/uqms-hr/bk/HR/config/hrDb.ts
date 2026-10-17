import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const hrMongoURI = process.env.HR_MONGODB_URI || 'mongodb://localhost:27017/shipping_hr';

// Create a separate connection for the HR Database
const hrDbConnection = mongoose.createConnection(hrMongoURI);

hrDbConnection.on('connected', () => {
  console.log('✅ HR MongoDB connected successfully');
});

hrDbConnection.on('error', (err) => {
  console.error('❌ HR MongoDB connection error:', err);
});

export default hrDbConnection;
