const express = require('express');
const dotenv = require('dotenv');
const connectToMongo = require('./src/middleware/connectMongo');
const authRoutes = require('./src/routes/auth');
const cors = require('./src/config/cors');

dotenv.config();

const app = express();
const port = process.env.PORT || 3002;

app.use(cors);
app.use(express.json());
app.use(connectToMongo);
app.use('/', authRoutes);

app.listen(port, () => {
  console.log(`Auth Service running on port ${port}`); 
});