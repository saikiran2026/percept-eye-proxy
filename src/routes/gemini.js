const express = require('express');
const Joi = require('joi');
const { authenticateUser } = require('../middleware/auth');
const { checkUserLimits, estimateTokenUsage } = require('../middleware/rateLimiter');
const geminiService = require('../services/gemini');
const supabaseService = require('../services/supabase');
const logger = require('../utils/logger');

const router = express.Router();

// Validation schemas
const generateContentSchema = Joi.object({
  contents: Joi.array().items(
    Joi.object({
      parts: Joi.array().items(
        Joi.object({
          text: Joi.string(),
          inlineData: Joi.object({
            mimeType: Joi.string().required(),
            data: Joi.string().required()
          })
        }).or('text', 'inlineData')
      ).required(),
      role: Joi.string().valid('user', 'model')
    })
  ).required(),
  generationConfig: Joi.object({
    temperature: Joi.number().min(0).max(2),
    topK: Joi.number().min(1),
    topP: Joi.number().min(0).max(1),
    maxOutputTokens: Joi.number().min(1).max(8192),
    stopSequences: Joi.array().items(Joi.string()),
    candidateCount: Joi.number().valid(1),
    presencePenalty: Joi.number().min(-2).max(2),
    frequencyPenalty: Joi.number().min(-2).max(2)
  }),
  safetySettings: Joi.array().items(
    Joi.object({
      category: Joi.string().required(),
      threshold: Joi.string().required()
    })
  ),
  systemInstruction: Joi.object({
    parts: Joi.array().items(
      Joi.object({
        text: Joi.string().required()
      })
    ).required()
  })
});

const countTokensSchema = Joi.object({
  contents: Joi.array().items(
    Joi.object({
      parts: Joi.array().items(
        Joi.object({
          text: Joi.string(),
          inlineData: Joi.object({
            mimeType: Joi.string().required(),
            data: Joi.string().required()
          })
        }).or('text', 'inlineData')
      ).required(),
      role: Joi.string().valid('user', 'model')
    })
  )
});

// Model validation
const validateModel = (req, res, next) => {
  const { model } = req.params;
  
  const allowedModels = [
    // Latest generation models (recommended)
    'gemini-2.5-pro',
    'gemini-2.5-pro-latest',
    'gemini-2.0-flash-exp',
    // Current generation models
    'gemini-1.5-pro',
    'gemini-1.5-pro-latest',
    'gemini-1.5-flash',
    'gemini-1.5-flash-latest',
    'gemini-1.5-flash-8b',
    'gemini-1.5-flash-8b-latest',
    // Embedding models
    'gemini-embedding-001',
    'text-embedding-004',
    'text-multilingual-embedding-002',
    // Legacy models (deprecated but still supported)
    'gemini-pro',
    'gemini-pro-vision'
  ];
  
  if (!allowedModels.includes(model)) {
    return res.status(400).json({
      error: 'Invalid model',
      message: `Model '${model}' is not supported. Allowed models: ${allowedModels.join(', ')}`
    });
  }
  
  next();
};

// Request validation middleware
const validateRequest = (schema) => {
  return (req, res, next) => {
    const { error } = schema.validate(req.body);
    if (error) {
      logger.warn('Request validation failed', {
        userId: req.user?.id,
        error: error.details[0].message,
        body: req.body
      });
      
      return res.status(400).json({
        error: 'Validation error',
        message: error.details[0].message,
        details: error.details
      });
    }
    next();
  };
};

/**
 * Generate content using Gemini API
 * POST /api/gemini/:model/generateContent
 */
router.post('/:model/generateContent', 
  authenticateUser,
  validateModel,
  validateRequest(generateContentSchema),
  checkUserLimits,
  estimateTokenUsage,
  async (req, res) => {
    try {
      const { model } = req.params;
      const userId = req.user.id;
      
      logger.info('Generate content request', {
        userId,
        model,
        estimatedTokens: req.estimatedTokens
      });

      const response = await geminiService.generateContent(model, req.body, userId);
      
      // Set response headers
      res.set({
        'Content-Type': 'application/json',
        'X-User-ID': userId,
        'X-Model': model,
        'X-Request-ID': req.id || 'unknown'
      });

      res.status(response.status).json(response.data);
    } catch (error) {
      logger.error('Generate content error', {
        userId: req.user?.id,
        model: req.params.model,
        error: error.message
      });

      res.status(error.status || 500).json({
        error: error.code || 'INTERNAL_ERROR',
        message: error.message || 'An unexpected error occurred'
      });
    }
  }
);

/**
 * Stream generate content using Gemini API
 * POST /api/gemini/:model/streamGenerateContent
 */
router.post('/:model/streamGenerateContent',
  authenticateUser,
  validateModel,
  validateRequest(generateContentSchema),
  checkUserLimits,
  estimateTokenUsage,
  async (req, res) => {
    try {
      const { model } = req.params;
      const userId = req.user.id;
      
      logger.info('Stream generate content request', {
        userId,
        model,
        estimatedTokens: req.estimatedTokens
      });

      const response = await geminiService.streamGenerateContent(model, req.body, userId);
      
      // Set streaming headers
      res.set({
        'Content-Type': 'application/json',
        'Transfer-Encoding': 'chunked',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-User-ID': userId,
        'X-Model': model,
        'X-Request-ID': req.id || 'unknown'
      });

      res.status(response.status);
      
      // Pipe the stream response
      response.stream.pipe(res);
      
      // Handle stream events
      response.stream.on('end', () => {
        logger.info('Stream completed', { userId, model });
      });
      
      response.stream.on('error', (error) => {
        logger.error('Stream error', { userId, model, error: error.message });
        if (!res.headersSent) {
          res.status(500).json({
            error: 'STREAM_ERROR',
            message: 'Streaming failed'
          });
        }
      });

    } catch (error) {
      logger.error('Stream generate content error', {
        userId: req.user?.id,
        model: req.params.model,
        error: error.message
      });

      if (!res.headersSent) {
        res.status(error.status || 500).json({
          error: error.code || 'INTERNAL_ERROR',
          message: error.message || 'An unexpected error occurred'
        });
      }
    }
  }
);

/**
 * Count tokens using Gemini API
 * POST /api/gemini/:model/countTokens
 */
router.post('/:model/countTokens',
  authenticateUser,
  validateModel,
  validateRequest(countTokensSchema),
  async (req, res) => {
    try {
      const { model } = req.params;
      const userId = req.user.id;
      
      logger.info('Count tokens request', {
        userId,
        model
      });

      const response = await geminiService.countTokens(model, req.body, userId);
      
      res.set({
        'Content-Type': 'application/json',
        'X-User-ID': userId,
        'X-Model': model,
        'X-Request-ID': req.id || 'unknown'
      });

      res.status(response.status).json(response.data);
    } catch (error) {
      logger.error('Count tokens error', {
        userId: req.user?.id,
        model: req.params.model,
        error: error.message
      });

      res.status(error.status || 500).json({
        error: error.code || 'INTERNAL_ERROR',
        message: error.message || 'An unexpected error occurred'
      });
    }
  }
);

/**
 * List available models
 * GET /api/gemini/models
 */
router.get('/models',
  authenticateUser,
  async (req, res) => {
    try {
      const userId = req.user.id;
      
      logger.info('List models request', { userId });

      const response = await geminiService.listModels(userId);
      
      res.set({
        'Content-Type': 'application/json',
        'X-User-ID': userId,
        'X-Request-ID': req.id || 'unknown'
      });

      res.status(response.status).json(response.data);
    } catch (error) {
      logger.error('List models error', {
        userId: req.user?.id,
        error: error.message
      });

      res.status(error.status || 500).json({
        error: error.code || 'INTERNAL_ERROR',
        message: error.message || 'An unexpected error occurred'
      });
    }
  }
);

/**
 * Get user usage statistics
 * GET /api/gemini/usage
 */
router.get('/usage',
  authenticateUser,
  async (req, res) => {
    try {
      const userId = req.user.id;
      
      logger.info('Get usage request', { userId });

      const [summary, limits] = await Promise.all([
        supabaseService.getUserUsageSummary(userId),
        supabaseService.checkUserLimits(userId)
      ]);

      res.json({
        usage: summary,
        limits: limits,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Get usage error', {
        userId: req.user?.id,
        error: error.message
      });

      res.status(500).json({
        error: 'INTERNAL_ERROR',
        message: 'Failed to retrieve usage statistics'
      });
    }
  }
);

/**
 * Generate embeddings using Gemini API
 * POST /api/gemini/:model/embeddings
 */
router.post('/:model/embeddings',
  authenticateUser,
  validateModel,
  async (req, res) => {
    try {
      const { model } = req.params;
      const userId = req.user.id;
      
      // Check if model is an embedding model
      const embeddingModels = [
        'gemini-embedding-001', 
        'text-embedding-004', 
        'text-multilingual-embedding-002'
      ];
      if (!embeddingModels.includes(model)) {
        return res.status(400).json({
          error: 'Invalid model for embeddings',
          message: `Model '${model}' is not an embedding model. Use one of: ${embeddingModels.join(', ')}`
        });
      }
      
      logger.info('Generate embeddings request', {
        userId,
        model
      });

      const response = await geminiService.generateEmbeddings(model, req.body, userId);
      
      res.set({
        'Content-Type': 'application/json',
        'X-User-ID': userId,
        'X-Model': model,
        'X-Request-ID': req.id || 'unknown'
      });

      res.status(response.status).json(response.data);
    } catch (error) {
      logger.error('Generate embeddings error', {
        userId: req.user?.id,
        model: req.params.model,
        error: error.message
      });

      res.status(error.status || 500).json({
        error: error.code || 'INTERNAL_ERROR',
        message: error.message || 'An unexpected error occurred'
      });
    }
  }
);

/**
 * Health check endpoint
 * GET /api/gemini/health
 */
router.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'gemini-proxy',
    version: '1.0.0'
  });
});

module.exports = router; 