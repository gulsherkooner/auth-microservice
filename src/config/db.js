const mongoose = require('mongoose');
const dotenv = require('dotenv');

dotenv.config();

const clientPromise = mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

module.exports = { clientPromise };