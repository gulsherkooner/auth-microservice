const cors = require('cors');

const corsOptions = {
  origin: ['https://api-gateway-eta-navy.vercel.app', 'http://localhost:3001','https://subscribe-microservice.vercel.app'],
  credentials: true, // Allow cookies (e.g., refreshToken)
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['X-Requested-With, Content-Type, Authorization'],
};

module.exports = cors(corsOptions);