const axios = require('axios');
const config = require('../config/config');
const logger = require('../utils/logger');
const supabaseService = require('./supabase');

class GeminiService {
  constructor() {
    this.baseUrl = config.gemini.baseUrl;
    this.apiKey = config.gemini.apiKey;
  }

  /**
   * Calculate cost based on token usage and model
   */
  calculateCost(inputTokens, outputTokens, modelName) {
    const pricing = config.pricing[modelName] || config.pricing['gemini-pro'];
    
    const inputCost = inputTokens / pricing.inputTokensPerDollar;
    const outputCost = outputTokens / pricing.outputTokensPerDollar;
    
    return inputCost + outputCost;
  }

  /**
   * Extract token count from Gemini response
   */
  extractTokenUsage(response) {
    try {
      const usageMetadata = response.data?.usageMetadata;
      if (usageMetadata) {
        return {
          promptTokenCount: usageMetadata.promptTokenCount || 0,
          candidatesTokenCount: usageMetadata.candidatesTokenCount || 0,
          totalTokenCount: usageMetadata.totalTokenCount || 0
        };
      }

      // Fallback: estimate from response content
      let outputTokens = 0;
      if (response.data?.candidates) {
        for (const candidate of response.data.candidates) {
          if (candidate.content && candidate.content.parts) {
            for (const part of candidate.content.parts) {
              if (part.text) {
                outputTokens += Math.ceil(part.text.length / 4);
              }
            }
          }
        }
      }

      return {
        promptTokenCount: 0, // Will be estimated from request
        candidatesTokenCount: outputTokens,
        totalTokenCount: outputTokens
      };
    } catch (error) {
      logger.error('Error extracting token usage', { error: error.message });
      return {
        promptTokenCount: 0,
        candidatesTokenCount: 0,
        totalTokenCount: 0
      };
    }
  }

  /**
   * Record usage in database
   */
  async recordUsage(userId, tokenUsage, modelName, requestType, cost) {
    try {
      await supabaseService.recordUsage(
        userId,
        tokenUsage.totalTokenCount,
        cost,
        modelName,
        requestType
      );
    } catch (error) {
      logger.error('Failed to record usage in database', {
        userId,
        tokenUsage,
        modelName,
        cost,
        error: error.message
      });
      // Don't throw here as this shouldn't break the main request
    }
  }

  /**
   * Generate content using Gemini API
   */
  async generateContent(modelName, requestBody, userId, requestType = 'generate') {
    try {
      const url = `${this.baseUrl}/v1beta/models/${modelName}:generateContent?key=${this.apiKey}`;
      
      logger.info('Making Gemini API request', {
        modelName,
        userId,
        requestType,
        url: url.replace(this.apiKey, '[REDACTED]')
      });

      const startTime = Date.now();
      
      const response = await axios.post(url, requestBody, {
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'PerceptEye-Proxy/1.0'
        },
        timeout: 60000 // 60 seconds timeout
      });

      const duration = Date.now() - startTime;

      // Extract token usage from response
      const tokenUsage = this.extractTokenUsage(response);
      
      // Calculate cost
      const cost = this.calculateCost(
        tokenUsage.promptTokenCount,
        tokenUsage.candidatesTokenCount,
        modelName
      );

      logger.info('Gemini API request completed', {
        modelName,
        userId,
        duration,
        tokenUsage,
        cost,
        status: response.status
      });

      // Record usage asynchronously
      if (userId) {
        this.recordUsage(userId, tokenUsage, modelName, requestType, cost).catch(error => {
          logger.error('Async usage recording failed', { error: error.message });
        });
      }

      // Add usage metadata to response
      const responseWithUsage = {
        ...response.data,
        usageMetadata: {
          ...response.data.usageMetadata,
          cost: parseFloat(cost.toFixed(6)),
          model: modelName,
          timestamp: new Date().toISOString()
        }
      };

      return {
        data: responseWithUsage,
        status: response.status,
        headers: response.headers
      };

    } catch (error) {
      logger.error('Gemini API request failed', {
        modelName,
        userId,
        error: error.message,
        status: error.response?.status,
        data: error.response?.data
      });

      // Transform Gemini errors to consistent format
      if (error.response) {
        const geminiError = error.response.data;
        throw {
          status: error.response.status,
          message: geminiError.error?.message || 'Gemini API error',
          code: geminiError.error?.code || 'UNKNOWN_ERROR',
          details: geminiError.error?.details || []
        };
      }

      throw {
        status: 500,
        message: 'Failed to connect to Gemini API',
        code: 'CONNECTION_ERROR'
      };
    }
  }

  /**
   * Stream generate content using Gemini API
   */
  async streamGenerateContent(modelName, requestBody, userId, requestType = 'stream') {
    try {
      const url = `${this.baseUrl}/v1beta/models/${modelName}:streamGenerateContent?key=${this.apiKey}`;
      
      logger.info('Making Gemini streaming API request', {
        modelName,
        userId,
        requestType,
        url: url.replace(this.apiKey, '[REDACTED]')
      });

      const response = await axios.post(url, requestBody, {
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'PerceptEye-Proxy/1.0'
        },
        responseType: 'stream',
        timeout: 120000 // 2 minutes timeout for streaming
      });

      logger.info('Gemini streaming API request initiated', {
        modelName,
        userId,
        status: response.status
      });

      return {
        stream: response.data,
        status: response.status,
        headers: response.headers
      };

    } catch (error) {
      logger.error('Gemini streaming API request failed', {
        modelName,
        userId,
        error: error.message,
        status: error.response?.status,
        data: error.response?.data
      });

      if (error.response) {
        const geminiError = error.response.data;
        throw {
          status: error.response.status,
          message: geminiError.error?.message || 'Gemini streaming API error',
          code: geminiError.error?.code || 'UNKNOWN_ERROR',
          details: geminiError.error?.details || []
        };
      }

      throw {
        status: 500,
        message: 'Failed to connect to Gemini streaming API',
        code: 'CONNECTION_ERROR'
      };
    }
  }

  /**
   * Count tokens using Gemini API
   */
  async countTokens(modelName, requestBody, userId) {
    try {
      const url = `${this.baseUrl}/v1beta/models/${modelName}:countTokens?key=${this.apiKey}`;
      
      logger.info('Making Gemini token count request', {
        modelName,
        userId,
        url: url.replace(this.apiKey, '[REDACTED]')
      });

      const response = await axios.post(url, requestBody, {
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'PerceptEye-Proxy/1.0'
        },
        timeout: 30000 // 30 seconds timeout
      });

      logger.info('Gemini token count completed', {
        modelName,
        userId,
        tokenCount: response.data.totalTokens
      });

      return {
        data: response.data,
        status: response.status,
        headers: response.headers
      };

    } catch (error) {
      logger.error('Gemini token count failed', {
        modelName,
        userId,
        error: error.message,
        status: error.response?.status
      });

      if (error.response) {
        const geminiError = error.response.data;
        throw {
          status: error.response.status,
          message: geminiError.error?.message || 'Gemini token count error',
          code: geminiError.error?.code || 'UNKNOWN_ERROR'
        };
      }

      throw {
        status: 500,
        message: 'Failed to connect to Gemini API for token counting',
        code: 'CONNECTION_ERROR'
      };
    }
  }

  /**
   * Generate embeddings using Gemini API
   */
  async generateEmbeddings(modelName, requestBody, userId) {
    try {
      // Different URL structure for embedding models
      let url;
      if (modelName === 'gemini-embedding-001') {
        url = `${this.baseUrl}/v1beta/models/${modelName}:embedContent?key=${this.apiKey}`;
      } else {
        // Legacy embedding models
        url = `${this.baseUrl}/v1/models/${modelName}:embedText?key=${this.apiKey}`;
      }
      
      logger.info('Making Gemini embedding request', {
        modelName,
        userId,
        url: url.replace(this.apiKey, '[REDACTED]')
      });

      const startTime = Date.now();
      
      const response = await axios.post(url, requestBody, {
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'PerceptEye-Proxy/1.0'
        },
        timeout: 30000 // 30 seconds timeout
      });

      const duration = Date.now() - startTime;

      // Calculate cost for embeddings (input tokens only)
      const inputTokens = requestBody.model ? 
        Math.ceil(JSON.stringify(requestBody).length / 4) : // Rough estimate
        0;
      
      const cost = this.calculateCost(inputTokens, 0, modelName);

      logger.info('Gemini embedding request completed', {
        modelName,
        userId,
        duration,
        inputTokens,
        cost,
        status: response.status
      });

      // Record usage asynchronously
      if (userId) {
        this.recordUsage(userId, { totalTokenCount: inputTokens }, modelName, 'embedding', cost).catch(error => {
          logger.error('Async embedding usage recording failed', { error: error.message });
        });
      }

      // Add usage metadata to response
      const responseWithUsage = {
        ...response.data,
        usageMetadata: {
          inputTokens,
          cost: parseFloat(cost.toFixed(6)),
          model: modelName,
          timestamp: new Date().toISOString()
        }
      };

      return {
        data: responseWithUsage,
        status: response.status,
        headers: response.headers
      };

    } catch (error) {
      logger.error('Gemini embedding request failed', {
        modelName,
        userId,
        error: error.message,
        status: error.response?.status,
        data: error.response?.data
      });

      if (error.response) {
        const geminiError = error.response.data;
        throw {
          status: error.response.status,
          message: geminiError.error?.message || 'Gemini embedding API error',
          code: geminiError.error?.code || 'UNKNOWN_ERROR'
        };
      }

      throw {
        status: 500,
        message: 'Failed to connect to Gemini embedding API',
        code: 'CONNECTION_ERROR'
      };
    }
  }

  /**
   * List available models
   */
  async listModels(userId) {
    try {
      const url = `${this.baseUrl}/v1beta/models?key=${this.apiKey}`;
      
      logger.info('Listing Gemini models', {
        userId,
        url: url.replace(this.apiKey, '[REDACTED]')
      });

      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'PerceptEye-Proxy/1.0'
        },
        timeout: 30000
      });

      logger.info('Gemini models listed successfully', {
        userId,
        modelCount: response.data.models?.length || 0
      });

      return {
        data: response.data,
        status: response.status,
        headers: response.headers
      };

    } catch (error) {
      logger.error('Failed to list Gemini models', {
        userId,
        error: error.message,
        status: error.response?.status
      });

      if (error.response) {
        const geminiError = error.response.data;
        throw {
          status: error.response.status,
          message: geminiError.error?.message || 'Failed to list models',
          code: geminiError.error?.code || 'UNKNOWN_ERROR'
        };
      }

      throw {
        status: 500,
        message: 'Failed to connect to Gemini API',
        code: 'CONNECTION_ERROR'
      };
    }
  }
}

module.exports = new GeminiService(); 