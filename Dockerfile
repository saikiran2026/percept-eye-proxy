# Use the official Node.js 18 LTS image
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Install system dependencies for better security and performance
RUN apk add --no-cache \
    dumb-init \
    && addgroup -g 1001 -S nodejs \
    && adduser -S proxy -u 1001

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production && npm cache clean --force

# Copy application code
COPY --chown=proxy:nodejs . .

# Create logs directory
RUN mkdir -p logs && chown -R proxy:nodejs logs

# Switch to non-root user
USER proxy

# Expose ports for HTTP and gRPC
EXPOSE 8080 9090

# Set environment to production
ENV NODE_ENV=production

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:8080/health', (res) => { \
    if (res.statusCode === 200) process.exit(0); else process.exit(1); \
  }).on('error', () => process.exit(1));"

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Start the application
CMD ["node", "src/server.js"] 