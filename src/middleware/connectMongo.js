const { clientPromise } = require('../config/db');

const connectToMongo = async (req, res, next) => {
  try {
    await clientPromise;
    next();
  } catch (error) {
    console.error('MongoDB connection error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports = connectToMongo;