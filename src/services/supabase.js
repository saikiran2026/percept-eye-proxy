const { createClient } = require('@supabase/supabase-js');
const config = require('../config/config');
const logger = require('../utils/logger');

// Create Supabase clients
const supabaseClient = createClient(config.supabase.url, config.supabase.anonKey);
const supabaseAdmin = createClient(config.supabase.url, config.supabase.serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

class SupabaseService {
  constructor() {
    this.client = supabaseClient;
    this.admin = supabaseAdmin;
  }

  /**
   * Verify JWT token and get user information
   */
  async verifyToken(token) {
    try {
      logger.debug('Starting token verification', { 
        tokenLength: token.length,
        tokenStart: token.substring(0, 50) + '...',
        supabaseUrl: config.supabase.url,
        environment: process.env.NODE_ENV
      });

      // Try primary method with client auth
      const { data: { user }, error } = await this.client.auth.getUser(token);
      
      if (error) {
        logger.warn('Primary token verification failed, trying admin method', { 
          error: error.message,
          errorCode: error.code,
          errorStatus: error.status,
          supabaseUrl: config.supabase.url
        });
        
        // Fallback: Try with admin client
        try {
          const { data: { user: adminUser }, error: adminError } = await this.admin.auth.getUser(token);
          
          if (adminError) {
            logger.warn('Admin token verification also failed', { 
              error: adminError.message,
              errorCode: adminError.code,
              errorStatus: adminError.status
            });
            return { user: null, error: adminError };
          }
          
          logger.debug('Admin token verification successful', {
            userId: adminUser?.id,
            email: adminUser?.email
          });
          
          return { user: adminUser, error: null };
        } catch (adminErr) {
          logger.error('Admin token verification threw exception', { 
            error: adminErr.message,
            stack: adminErr.stack
          });
          return { user: null, error: adminErr };
        }
      }

      logger.debug('Primary token verification successful', {
        userId: user?.id,
        email: user?.email
      });

      return { user, error: null };
    } catch (error) {
      logger.error('Error verifying token', { 
        error: error.message,
        stack: error.stack,
        supabaseUrl: config.supabase.url,
        environment: process.env.NODE_ENV
      });
      return { user: null, error };
    }
  }

  /**
   * Check user limits and current usage
   */
  async checkUserLimits(userId) {
    try {
      const { data, error } = await this.admin.rpc('check_user_limits', {
        p_user_id: userId
      });

      if (error) {
        logger.error('Error checking user limits', { userId, error: error.message });
        throw new Error('Failed to check user limits');
      }

      return data[0] || {
        within_hourly_limit: false,
        within_daily_token_limit: false,
        within_daily_cost_limit: false,
        requests_last_hour: 0,
        tokens_today: 0,
        cost_today: 0
      };
    } catch (error) {
      logger.error('Error in checkUserLimits', { userId, error: error.message });
      throw error;
    }
  }

  /**
   * Get user usage summary
   */
  async getUserUsageSummary(userId) {
    try {
      const { data, error } = await this.admin.rpc('get_user_usage_summary', {
        p_user_id: userId
      });

      if (error) {
        logger.error('Error getting user usage summary', { userId, error: error.message });
        throw new Error('Failed to get user usage summary');
      }

      return data[0] || {
        total_tokens: 0,
        total_cost: 0,
        requests_today: 0,
        tokens_today: 0,
        cost_today: 0,
        last_request: null
      };
    } catch (error) {
      logger.error('Error in getUserUsageSummary', { userId, error: error.message });
      throw error;
    }
  }

  /**
   * Record API usage
   */
  async recordUsage(userId, tokensUsed, cost, modelName, requestType = 'generate') {
    try {
      const { data, error } = await this.admin
        .from('api_usage')
        .insert({
          user_id: userId,
          tokens_used: tokensUsed,
          cost: cost,
          model_name: modelName,
          request_type: requestType,
          service: 'gemini'
        });

      if (error) {
        logger.error('Error recording usage', { 
          userId, 
          tokensUsed, 
          cost, 
          modelName, 
          error: error.message 
        });
        throw new Error('Failed to record usage');
      }

      logger.info('Usage recorded successfully', {
        userId,
        tokensUsed,
        cost,
        modelName,
        requestType
      });

      return data;
    } catch (error) {
      logger.error('Error in recordUsage', { userId, error: error.message });
      throw error;
    }
  }

  /**
   * Get or create user profile
   */
  async getUserProfile(userId) {
    try {
      let { data: profile, error } = await this.admin
        .from('user_profiles')
        .select('*')
        .eq('user_id', userId)
        .single();

      if (error && error.code === 'PGRST116') {
        // Profile doesn't exist, create it
        const { data: newProfile, error: insertError } = await this.admin
          .from('user_profiles')
          .insert({
            user_id: userId,
            subscription_tier: 'free',
            is_active: true
          })
          .select()
          .single();

        if (insertError) {
          logger.error('Error creating user profile', { userId, error: insertError.message });
          throw new Error('Failed to create user profile');
        }

        profile = newProfile;
        logger.info('Created new user profile', { userId });
      } else if (error) {
        logger.error('Error getting user profile', { userId, error: error.message });
        throw new Error('Failed to get user profile');
      }

      return profile;
    } catch (error) {
      logger.error('Error in getUserProfile', { userId, error: error.message });
      throw error;
    }
  }

  /**
   * Get or create user limits
   */
  async getUserLimits(userId) {
    try {
      let { data: limits, error } = await this.admin
        .from('user_limits')
        .select('*')
        .eq('user_id', userId)
        .single();

      if (error && error.code === 'PGRST116') {
        // Limits don't exist, create them with defaults
        const { data: newLimits, error: insertError } = await this.admin
          .from('user_limits')
          .insert({
            user_id: userId,
            requests_per_hour: config.rateLimit.defaultRequestsPerHour,
            tokens_per_day: config.rateLimit.defaultTokensPerDay,
            max_cost_per_day: config.rateLimit.defaultMaxCostPerDay
          })
          .select()
          .single();

        if (insertError) {
          logger.error('Error creating user limits', { userId, error: insertError.message });
          throw new Error('Failed to create user limits');
        }

        limits = newLimits;
        logger.info('Created new user limits', { userId });
      } else if (error) {
        logger.error('Error getting user limits', { userId, error: error.message });
        throw new Error('Failed to get user limits');
      }

      return limits;
    } catch (error) {
      logger.error('Error in getUserLimits', { userId, error: error.message });
      throw error;
    }
  }
}

module.exports = new SupabaseService(); 