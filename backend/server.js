const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const uploadRoutes = require('./routes/upload');
const analyzeRoutes = require('./routes/analyze');
const recoveryRoutes = require('./routes/recovery');
const aiRoutes = require('./routes/ai');
const reportRoutes = require('./routes/report');
const streamRoutes = require('./routes/stream');
const exportRoutes = require('./routes/export');

const app = express();
const PORT = process.env.PORT || 5000;

// Express middlewares
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Ensure required storage directories exist
const directories = [
  path.join(__dirname, 'uploads'),
  path.join(__dirname, 'recovered'),
  path.join(__dirname, 'reports')
];
directories.forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Database connection logic
const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/digital_recovery';

async function connectDB() {
  try {
    await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 2000 });
    console.log(`[MongoDB] Connected to database: ${mongoUri}`);
  } catch (err) {
    console.warn(`[MongoDB] Local connection failed (${err.message}). Using Memory DB fallback for offline mode...`);
    try {
      const { MongoMemoryServer } = require('mongodb-memory-server');
      const mongod = await MongoMemoryServer.create();
      const uri = mongod.getUri();
      await mongoose.connect(uri);
      console.log(`[MongoDB Memory Server] Connected successfully to in-memory database: ${uri}`);
    } catch (memErr) {
      console.error(`[MongoDB] In-memory fallback error: ${memErr.message}`);
    }
  }
}

connectDB();

// API Route Mounts
app.use('/api/upload', uploadRoutes);
app.use('/api/analyze', analyzeRoutes);
app.use('/api/recover', recoveryRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api', reportRoutes);
app.use('/api', streamRoutes);
app.use('/api', exportRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', service: 'Digital Evidence Recovery Backend Pipeline', version: '1.0.0' });
});

// Start HTTP server if not required by test suite
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`=======================================================`);
    console.log(` Digital Evidence Reconstruction Backend Running on Port ${PORT}`);
    console.log(` Health Check: http://localhost:${PORT}/api/health`);
    console.log(`=======================================================`);
  });
}

module.exports = app;
