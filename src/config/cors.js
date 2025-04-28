const cors = require('cors');

const corsOptions = {
  origin: 'https://api-gateway-sooty-nine.vercel.app',
  credentials: true, // Allow cookies (e.g., refreshToken)
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};

module.exports = cors(corsOptions);