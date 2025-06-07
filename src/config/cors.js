const cors = require('cors');

const corsOptions = {
  origin: ['http://api-gateway:3001','http://post-service:3005', "http://localhost:3001", "http://localhost:3005"],
  credentials: true, // Allow cookies (e.g., refreshToken)
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['X-Requested-With, Content-Type, Authorization'],
};

module.exports = cors(corsOptions);