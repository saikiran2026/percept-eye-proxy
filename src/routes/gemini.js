const express = require('express');
const { authenticateUser } = require('../middleware/auth');
const { globalRateLimit } = require('../middleware/rateLimiter');
const config = require('../config/config');
const logger = require('../utils/logger');
const fetch = require('node-fetch');

const router = express.Router();

// Completely transparent proxy - forwards everything exactly as-is to Google
router.use('*', authenticateUser, globalRateLimit, async (req, res) => {
  const userId = req.user.id;
  // Simply redirect to Google API keeping the path as-is
  const path = req.originalUrl.replace('/api/gemini', '') || '/v1beta/models';
  const separator = path.includes('?') ? '&' : '?';
  const googleUrl = `https://generativelanguage.googleapis.com${path}${separator}key=${config.gemini.apiKey}`;
  
  try {
    
              logger.info('Proxying request', {
      userId,
      method: req.method,
      originalUrl: req.originalUrl,
      originalPath: req.path,
      extractedPath: path,
      query: req.query,
      headers: req.headers,
      googlePath: path,
      fullGoogleUrl: googleUrl,
      googleUrlHidden: googleUrl.replace(config.gemini.apiKey, 'HIDDEN'),
      hasApiKey: !!config.gemini.apiKey,
      apiKeyLength: config.gemini.apiKey ? config.gemini.apiKey.length : 0
    });

    // Forward ALL headers except host and authorization
    const forwardHeaders = { ...req.headers };
    delete forwardHeaders.host;
    delete forwardHeaders.authorization;
    
    // Forward request to Google exactly as received
    logger.info('Making fetch request', {
      url: googleUrl.replace(config.gemini.apiKey, 'HIDDEN'),
      method: req.method,
      headers: { ...forwardHeaders, 'User-Agent': 'curl/8.7.1' },
      hasBody: req.method !== 'GET' && req.method !== 'HEAD'
    });
    
    const response = await fetch(googleUrl, {
      method: req.method,
      headers: {
        ...forwardHeaders,
        'User-Agent': 'curl/8.7.1'
      },
      body: req.method !== 'GET' && req.method !== 'HEAD' ? JSON.stringify(req.body) : undefined,
      timeout: 30000
    });
    
    logger.info('Fetch response received', {
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers.entries())
    });

    logger.info('Google API response received', {
      userId,
      status: response.status,
      statusText: response.statusText,
      contentType: response.headers.get('content-type'),
      contentLength: response.headers.get('content-length')
    });

    const contentType = response.headers.get('content-type');
    let data;
    
    try {
      if (contentType?.includes('application/json')) {
        data = await response.json();
      } else {
        data = await response.text();
        logger.warn('Non-JSON response from Google API', {
          userId,
          status: response.status,
          contentType,
          responseText: data.substring(0, 500) // Log first 500 chars
        });
      }
    } catch (parseError) {
      // Handle JSON parsing errors
      const rawText = await response.text();
      logger.error('Failed to parse Google API response', {
        userId,
        status: response.status,
        statusText: response.statusText,
        contentType,
        parseError: parseError.message,
        rawResponse: rawText.substring(0, 1000), // Log first 1000 chars
        responseHeaders: Object.fromEntries(response.headers.entries())
      });
      
      // Return the parsing error to the client
      return res.status(502).json({
        error: 'PROXY_PARSE_ERROR',
        message: 'Failed to parse response from Google API',
        details: {
          status: response.status,
          statusText: response.statusText,
          contentType,
          parseError: parseError.message
        }
      });
    }
    
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
      errorStack: error.stack,
      originalUrl: req.originalUrl,
      googlePath: path,
      fullGoogleUrl: googleUrl,
      errorType: error.constructor.name,
      errorCode: error.code
    });

    res.status(500).json({
      error: 'PROXY_ERROR',
      message: 'Failed to proxy request to Google API',
      details: {
        errorType: error.constructor.name,
        errorMessage: error.message
      }
    });
  }
});

module.exports = router; 