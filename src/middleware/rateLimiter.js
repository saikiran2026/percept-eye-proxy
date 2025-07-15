const rateLimit = require('express-rate-limit');
const slowDown = require('express-slow-down');
const supabaseService = require('../services/supabase');
const logger = require('../utils/logger');
const config = require('../config/config');

/**
 * Custom rate limiter that checks user-specific limits from database
 */
async function checkUserLimits(req, res, next) {
  try {
    // Skip rate limiting if user is not authenticated
    if (!req.user) {
      return next();
    }

    const userId = req.user.id;
    
    // Check current usage against limits
    const limits = await supabaseService.checkUserLimits(userId);
    
    logger.info('Checking user limits', {
      userId,
      limits
    });

    // Check hourly request limit
    if (!limits.within_hourly_limit) {
      logger.warn('User exceeded hourly request limit', {
        userId,
        requestsLastHour: limits.requests_last_hour
      });
      
      return res.status(429).json({
        error: 'Rate limit exceeded',
        message: 'You have exceeded your hourly request limit',
        details: {
          requests_last_hour: limits.requests_last_hour,
          reset_time: new Date(Date.now() + config.rateLimit.windowMs).toISOString()
        }
      });
    }

    // Check daily token limit
    if (!limits.within_daily_token_limit) {
      logger.warn('User exceeded daily token limit', {
        userId,
        tokensToday: limits.tokens_today
      });
      
      return res.status(429).json({
        error: 'Token limit exceeded',
        message: 'You have exceeded your daily token limit',
        details: {
          tokens_today: limits.tokens_today,
          reset_time: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
        }
      });
    }

    // Check daily cost limit
    if (!limits.within_daily_cost_limit) {
      logger.warn('User exceeded daily cost limit', {
        userId,
        costToday: limits.cost_today
      });
      
      return res.status(429).json({
        error: 'Cost limit exceeded',
        message: 'You have exceeded your daily cost limit',
        details: {
          cost_today: parseFloat(limits.cost_today),
          reset_time: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
        }
      });
    }

    // Attach limits info to request for use in proxy
    req.userLimits = limits;
    
    next();
  } catch (error) {
    logger.error('Error checking user limits', {
      userId: req.user?.id,
      error: error.message,
      stack: error.stack
    });
    
    // On error, allow request to proceed but log the issue
    next();
  }
}

/**
 * Global rate limiter for all requests (fallback protection)
 */
const globalRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 1000, // Limit each IP to 1000 requests per windowMs
  message: {
    error: 'Too many requests',
    message: 'Too many requests from this IP, please try again later'
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn('Global rate limit exceeded', {
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });
    
    res.status(429).json({
      error: 'Too many requests',
      message: 'Too many requests from this IP, please try again later'
    });
  }
});

/**
 * Slow down middleware for gradual response delays
 */
const speedLimiter = slowDown({
  windowMs: 15 * 60 * 1000, // 15 minutes
  delayAfter: 100, // Allow 100 requests per window without delay
  delayMs: () => 500, // Add 500ms delay per request after delayAfter
  maxDelayMs: 20000, // Maximum delay of 20 seconds
  validate: { delayMs: false }, // Disable the warning
  // Removed onLimitReached as it's deprecated
});

/**
 * Rate limiter for authenticated users based on subscription tier
 */
const authenticatedUserRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  limit: (req) => {
    const tier = req.userProfile?.subscription_tier || 'free';
    
    switch (tier) {
      case 'pro':
        return 1000;
      case 'premium':
        return 5000;
      case 'enterprise':
        return 10000;
      default:
        return 100; // free tier
    }
  },
  keyGenerator: (req) => {
    // Use user ID for rate limiting instead of IP
    return req.user?.id || req.ip;
  },
  message: (req) => {
    const tier = req.userProfile?.subscription_tier || 'free';
    return {
      error: 'Rate limit exceeded',
      message: `You have exceeded your ${tier} tier rate limit`,
      tier
    };
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res, next, options) => {
    logger.warn('User rate limit exceeded', {
      userId: req.user?.id,
      tier: req.userProfile?.subscription_tier,
      ip: req.ip
    });
    
    res.status(429).json(options.message(req));
  }
});

/**
 * Middleware to estimate and validate token usage before making the request
 */
function estimateTokenUsage(req, res, next) {
  try {
    const body = req.body;
    let estimatedInputTokens = 0;
    
    // Estimate input tokens based on content
    if (body.contents && Array.isArray(body.contents)) {
      for (const content of body.contents) {
        if (content.parts && Array.isArray(content.parts)) {
          for (const part of content.parts) {
            if (part.text) {
              // Rough estimation: 1 token ≈ 4 characters
              estimatedInputTokens += Math.ceil(part.text.length / 4);
            }
            if (part.inlineData) {
              // Images/files add significant tokens
              estimatedInputTokens += 1000; // Conservative estimate
            }
          }
        }
      }
    } else if (body.prompt) {
      estimatedInputTokens = Math.ceil(body.prompt.length / 4);
    }

    // Add context and system message tokens
    estimatedInputTokens += 100; // Buffer for system messages, etc.

    req.estimatedTokens = {
      input: estimatedInputTokens,
      total: estimatedInputTokens * 2 // Estimate output will be similar to input
    };

    logger.info('Token usage estimated', {
      userId: req.user?.id,
      estimatedInputTokens,
      estimatedTotal: req.estimatedTokens.total
    });

    next();
  } catch (error) {
    logger.error('Error estimating token usage', {
      error: error.message,
      userId: req.user?.id
    });
    
    // Continue without estimation
    req.estimatedTokens = { input: 0, total: 0 };
    next();
  }
}

module.exports = {
  checkUserLimits,
  globalRateLimit,
  speedLimiter,
  authenticatedUserRateLimit,
  estimateTokenUsage
}; 