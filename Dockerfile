# Use Node.js 23 LTS
FROM node:23-alpine

# Set working directory
WORKDIR /app

# Copy package.json and install dependencies
COPY package*.json ./
RUN npm install

# Copy source code and root files
COPY index.js ./
COPY src/ ./src/
COPY .env ./

# Expose port
EXPOSE 3002

# Start the service
CMD ["node", "index.js"]