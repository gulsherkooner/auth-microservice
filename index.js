const express = require('express');
const dotenv = require('dotenv');
const connectToMongo = require('./src/middleware/connectMongo');
const authRoutes = require('./src/routes/auth');
const cors = require('./src/config/cors');

dotenv.config();

const app = express();
const port = process.env.PORT || 3002;

// Increase payload size limit to handle large video uploads
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));

app.use(cors);
app.use(express.json());
app.use(connectToMongo);
app.use('/', authRoutes);

app.listen(port, () => {
  console.log(`Auth Service running on port ${port}`); 
});