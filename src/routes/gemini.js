const express = require('express');
const { authenticateUser } = require('../middleware/auth');
const { globalRateLimit } = require('../middleware/rateLimiter');
const config = require('../config/config');
const logger = require('../utils/logger');

const router = express.Router();

// Completely transparent proxy - forwards everything exactly as-is to Google
router.use('*', authenticateUser, globalRateLimit, async (req, res) => {
  try {
    const userId = req.user.id;
    const path = req.originalUrl.replace('/api/gemini', ''); // Remove our prefix, keep everything else
    
    // Build Google API URL - completely transparent
    const separator = path.includes('?') ? '&' : '?';
    const googleUrl = `https://generativelanguage.googleapis.com${path}${separator}key=${config.gemini.apiKey}`;
    
    logger.info('Proxying request', {
      userId,
      method: req.method,
      originalPath: req.originalUrl,
      googlePath: path,
      googleUrl: googleUrl.replace(config.gemini.apiKey, 'HIDDEN')
    });

    // Forward ALL headers except host and authorization
    const forwardHeaders = { ...req.headers };
    delete forwardHeaders.host;
    delete forwardHeaders.authorization;
    
    // Forward request to Google exactly as received
    const response = await fetch(googleUrl, {
      method: req.method,
      headers: {
        ...forwardHeaders,
        'User-Agent': 'PerceptEye-Proxy/1.0.0'
      },
      body: req.method !== 'GET' && req.method !== 'HEAD' ? JSON.stringify(req.body) : undefined
    });

    const contentType = response.headers.get('content-type');
    const data = contentType?.includes('application/json') ? await response.json() : await response.text();
    
    // Forward response headers and status exactly
    response.headers.forEach((value, key) => {
      if (key !== 'content-encoding' && key !== 'transfer-encoding') {
        res.set(key, value);
      }
    });
    
    res.status(response.status);
    res.set({
      'X-User-ID': userId,
      'X-Request-ID': req.id || 'unknown'
    });
    
    if (contentType?.includes('application/json')) {
      res.json(data);
    } else {
      res.send(data);
    }

  } catch (error) {
    logger.error('Proxy error', {
      userId: req.user?.id,
      error: error.message,
      originalUrl: req.originalUrl
    });

    res.status(500).json({
      error: 'PROXY_ERROR',
      message: 'Failed to proxy request to Google API'
    });
  }
});

module.exports = router; 