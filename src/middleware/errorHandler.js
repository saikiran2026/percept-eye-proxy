const logger = require('../utils/logger');
const config = require('../config/config');

/**
 * Global error handler middleware
 */
function errorHandler(err, req, res, next) {
  logger.error('Unhandled error', {
    error: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    userId: req.user?.id,
    ip: req.ip,
    userAgent: req.get('User-Agent')
  });

  // Don't leak error details in production
  const isDevelopment = config.nodeEnv === 'development';

  // Default error response
  let statusCode = 500;
  let errorResponse = {
    error: 'Internal Server Error',
    message: 'An unexpected error occurred',
    timestamp: new Date().toISOString()
  };

  // Handle specific error types
  if (err.name === 'ValidationError') {
    statusCode = 400;
    errorResponse = {
      error: 'Validation Error',
      message: err.message,
      details: err.details || []
    };
  } else if (err.name === 'UnauthorizedError' || err.status === 401) {
    statusCode = 401;
    errorResponse = {
      error: 'Unauthorized',
      message: 'Authentication required'
    };
  } else if (err.name === 'ForbiddenError' || err.status === 403) {
    statusCode = 403;
    errorResponse = {
      error: 'Forbidden',
      message: 'Insufficient permissions'
    };
  } else if (err.name === 'NotFoundError' || err.status === 404) {
    statusCode = 404;
    errorResponse = {
      error: 'Not Found',
      message: 'The requested resource was not found'
    };
  } else if (err.name === 'RateLimitError' || err.status === 429) {
    statusCode = 429;
    errorResponse = {
      error: 'Rate Limit Exceeded',
      message: 'Too many requests. Please try again later.',
      retryAfter: err.retryAfter || 3600
    };
  } else if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') {
    statusCode = 503;
    errorResponse = {
      error: 'Service Unavailable',
      message: 'External service is temporarily unavailable'
    };
  } else if (err.code === 'ETIMEDOUT') {
    statusCode = 504;
    errorResponse = {
      error: 'Gateway Timeout',
      message: 'Request timeout'
    };
  }

  // Add development-specific error details
  if (isDevelopment) {
    errorResponse.stack = err.stack;
    errorResponse.details = err.details || {};
  }

  // Add request ID if available
  if (req.id) {
    errorResponse.requestId = req.id;
  }

  res.status(statusCode).json(errorResponse);
}

/**
 * 404 handler for undefined routes
 */
function notFoundHandler(req, res) {
  logger.warn('Route not found', {
    url: req.url,
    method: req.method,
    ip: req.ip,
    userAgent: req.get('User-Agent')
  });

  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.method} ${req.url} not found`,
    timestamp: new Date().toISOString()
  });
}

/**
 * Async error wrapper for route handlers
 */
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * Custom error classes
 */
class AppError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
    this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }
}

class ValidationError extends AppError {
  constructor(message, details = []) {
    super(message, 400);
    this.name = 'ValidationError';
    this.details = details;
  }
}

class AuthenticationError extends AppError {
  constructor(message = 'Authentication required') {
    super(message, 401);
    this.name = 'UnauthorizedError';
  }
}

class AuthorizationError extends AppError {
  constructor(message = 'Insufficient permissions') {
    super(message, 403);
    this.name = 'ForbiddenError';
  }
}

class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(message, 404);
    this.name = 'NotFoundError';
  }
}

class RateLimitError extends AppError {
  constructor(message = 'Rate limit exceeded', retryAfter = 3600) {
    super(message, 429);
    this.name = 'RateLimitError';
    this.retryAfter = retryAfter;
  }
}

class ServiceUnavailableError extends AppError {
  constructor(message = 'Service temporarily unavailable') {
    super(message, 503);
    this.name = 'ServiceUnavailableError';
  }
}

module.exports = {
  errorHandler,
  notFoundHandler,
  asyncHandler,
  AppError,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  RateLimitError,
  ServiceUnavailableError
}; 