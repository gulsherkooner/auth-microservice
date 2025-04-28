const cors = require('cors');

const corsOptions = {
  origin: ['https://api-gateway-sooty-nine.vercel.app', 'http://localhost:3001'],
  credentials: true, // Allow cookies (e.g., refreshToken)
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['X-Requested-With, Content-Type, Authorization'],
};

module.exports = cors(corsOptions);