const cors = require('cors');

const corsOptions = {
  origin: ['https://api-gateway-eta-navy.vercel.app', 'http://135.181.192.55:3001','http://135.181.192.55:3005'],
  credentials: true, // Allow cookies (e.g., refreshToken)
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['X-Requested-With, Content-Type, Authorization'],
};

module.exports = cors(corsOptions);