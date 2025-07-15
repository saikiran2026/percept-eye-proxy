const supabaseService = require('../services/supabase');
const logger = require('../utils/logger');

/**
 * Authentication middleware to verify Supabase JWT tokens
 */
async function authenticateUser(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      logger.warn('Missing or invalid authorization header', {
        ip: req.ip,
        userAgent: req.get('User-Agent')
      });
      
      return res.status(401).json({
        error: 'Authentication required',
        message: 'Please provide a valid Bearer token'
      });
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    // Verify token with Supabase
    const { user, error } = await supabaseService.verifyToken(token);

    if (error || !user) {
      logger.warn('Token verification failed', {
        error: error?.message,
        ip: req.ip,
        userAgent: req.get('User-Agent')
      });
      
      return res.status(401).json({
        error: 'Invalid or expired token',
        message: 'Please authenticate again'
      });
    }

    // Check if user is active
    const profile = await supabaseService.getUserProfile(user.id);
    
    if (!profile.is_active) {
      logger.warn('Inactive user attempted access', {
        userId: user.id,
        email: user.email
      });
      
      return res.status(403).json({
        error: 'Account inactive',
        message: 'Your account has been deactivated. Please contact support.'
      });
    }

    // Attach user and profile to request object
    req.user = user;
    req.userProfile = profile;
    
    logger.info('User authenticated successfully', {
      userId: user.id,
      email: user.email,
      subscriptionTier: profile.subscription_tier
    });

    next();
  } catch (error) {
    logger.error('Authentication middleware error', {
      error: error.message,
      stack: error.stack,
      ip: req.ip
    });
    
    return res.status(500).json({
      error: 'Authentication service error',
      message: 'Please try again later'
    });
  }
}

/**
 * Optional authentication middleware for endpoints that work with or without auth
 */
async function optionalAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      // No auth provided, continue without user
      return next();
    }

    const token = authHeader.substring(7);
    const { user, error } = await supabaseService.verifyToken(token);

    if (!error && user) {
      const profile = await supabaseService.getUserProfile(user.id);
      if (profile.is_active) {
        req.user = user;
        req.userProfile = profile;
      }
    }

    next();
  } catch (error) {
    logger.error('Optional auth middleware error', {
      error: error.message,
      ip: req.ip
    });
    // Continue without authentication on error
    next();
  }
}

/**
 * Role-based authorization middleware
 */
function requireRole(allowedRoles) {
  return (req, res, next) => {
    if (!req.userProfile) {
      return res.status(401).json({
        error: 'Authentication required',
        message: 'Please authenticate first'
      });
    }

    const userRole = req.userProfile.subscription_tier || 'free';
    
    if (!allowedRoles.includes(userRole)) {
      logger.warn('Insufficient permissions', {
        userId: req.user.id,
        userRole,
        requiredRoles: allowedRoles
      });
      
      return res.status(403).json({
        error: 'Insufficient permissions',
        message: `This endpoint requires one of the following roles: ${allowedRoles.join(', ')}`
      });
    }

    next();
  };
}

module.exports = {
  authenticateUser,
  optionalAuth,
  requireRole
}; 