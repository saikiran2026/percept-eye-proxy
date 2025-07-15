const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const { v4: uuidv4 } = require('uuid');

const config = require('./config/config');
const logger = require('./utils/logger');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const { globalRateLimit, speedLimiter } = require('./middleware/rateLimiter');

// Import routes
const geminiRoutes = require('./routes/gemini');

const app = express();

// Trust proxy (important for Cloud Run)
app.set('trust proxy', 1);

// Request ID middleware
app.use((req, res, next) => {
  req.id = uuidv4();
  res.set('X-Request-ID', req.id);
  next();
});

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https://generativelanguage.googleapis.com"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false
}));

// CORS configuration
app.use(cors(config.cors));

// Compression middleware
app.use(compression());

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Logging middleware
app.use(morgan(config.logging.format, { stream: logger.stream }));

// Rate limiting middleware
app.use(globalRateLimit);
app.use(speedLimiter);

// Request logging middleware
app.use((req, res, next) => {
  logger.info('Incoming request', {
    method: req.method,
    url: req.url,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    requestId: req.id
  });
  next();
});

// Health check endpoint (before authentication)
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'gemini-proxy',
    version: '1.0.0',
    environment: config.nodeEnv
  });
});

// API documentation endpoint
app.get('/api/docs', (req, res) => {
  res.json({
    service: 'PerceptEye Gemini Proxy',
    version: '1.0.0',
    description: 'Proxy server for Google Generative AI APIs with authentication and rate limiting',
    endpoints: {
      'POST /api/gemini/:model/generateContent': 'Generate content using specified model',
      'POST /api/gemini/:model/streamGenerateContent': 'Stream generate content using specified model',
      'POST /api/gemini/:model/countTokens': 'Count tokens for specified model',
      'POST /api/gemini/:model/embeddings': 'Generate embeddings using embedding models',
      'GET /api/gemini/models': 'List available models',
      'GET /api/gemini/usage': 'Get user usage statistics',
      'GET /api/gemini/health': 'Health check for Gemini service',
      'GET /health': 'Service health check',
      'GET /api/docs': 'API documentation'
    },
    authentication: {
      type: 'Bearer Token',
      description: 'Supabase JWT token required in Authorization header'
    },
    models: [
      'gemini-2.5-pro',
      'gemini-2.5-pro-latest',
      'gemini-2.0-flash-exp',
      'gemini-1.5-pro',
      'gemini-1.5-pro-latest',
      'gemini-1.5-flash',
      'gemini-1.5-flash-latest',
      'gemini-1.5-flash-8b',
      'gemini-1.5-flash-8b-latest',
      'gemini-embedding-001',
      'text-embedding-004',
      'text-multilingual-embedding-002',
      'gemini-pro',
      'gemini-pro-vision'
    ],
    rateLimit: {
      global: '1000 requests per 15 minutes per IP',
      user: 'Based on subscription tier (free: 100/hour, pro: 1000/hour, premium: 5000/hour, enterprise: 10000/hour)',
      tokens: 'Based on user limits (default: 10000 tokens/day)',
      cost: 'Based on user limits (default: $50/day)'
    }
  });
});

// Routes
app.use('/api/gemini', geminiRoutes);

// 404 handler
app.use('*', notFoundHandler);

// Global error handler
app.use(errorHandler);

// Graceful shutdown handling
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  server.close(() => {
    logger.info('Process terminated');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  server.close(() => {
    logger.info('Process terminated');
    process.exit(0);
  });
});

// Unhandled promise rejection handler
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Promise Rejection', {
    reason: reason.toString(),
    stack: reason.stack
  });
  // Don't exit the process in production
  if (config.nodeEnv !== 'production') {
    process.exit(1);
  }
});

// Uncaught exception handler
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception', {
    error: error.message,
    stack: error.stack
  });
  // Exit the process on uncaught exceptions
  process.exit(1);
});

// Start server
const server = app.listen(config.port, () => {
  logger.info('Server started', {
    port: config.port,
    environment: config.nodeEnv,
    timestamp: new Date().toISOString()
  });
});

module.exports = app; 