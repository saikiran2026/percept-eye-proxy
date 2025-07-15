require('dotenv').config();

const config = {
  port: process.env.PORT || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  
  // Supabase Configuration
  supabase: {
    url: process.env.SUPABASE_URL,
    anonKey: process.env.SUPABASE_ANON_KEY,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE
  },
  
  // Google AI Configuration
  gemini: {
    apiKey: process.env.GEMINI_API_KEY,
    baseUrl: 'https://generativelanguage.googleapis.com'
  },
  
  // GCP Configuration
  gcp: {
    projectId: process.env.GCP_PROJECT_ID,
    region: process.env.GCP_REGION,
    serviceName: process.env.SERVICE_NAME,
    vpcConnectorName: process.env.VPC_CONNECTOR_NAME
  },
  
  // Rate Limiting Configuration
  rateLimit: {
    windowMs: 60 * 60 * 1000, // 1 hour
    defaultRequestsPerHour: 100,
    defaultTokensPerDay: 10000,
    defaultMaxCostPerDay: 50.00
  },
  
  // Gemini Pricing (tokens per dollar - latest pricing as of July 2025)
  pricing: {
    // Legacy models (deprecated)
    'gemini-pro': {
      inputTokensPerDollar: 1000000 / 0.50, // $0.50 per 1M tokens
      outputTokensPerDollar: 1000000 / 1.50 // $1.50 per 1M tokens
    },
    'gemini-pro-vision': {
      inputTokensPerDollar: 1000000 / 0.50,
      outputTokensPerDollar: 1000000 / 1.50
    },
    // Current generation models
    'gemini-1.5-pro': {
      inputTokensPerDollar: 1000000 / 3.50, // $3.50 per 1M tokens
      outputTokensPerDollar: 1000000 / 10.50 // $10.50 per 1M tokens
    },
    'gemini-1.5-pro-latest': {
      inputTokensPerDollar: 1000000 / 3.50,
      outputTokensPerDollar: 1000000 / 10.50
    },
    'gemini-1.5-flash': {
      inputTokensPerDollar: 1000000 / 0.075, // $0.075 per 1M tokens
      outputTokensPerDollar: 1000000 / 0.30 // $0.30 per 1M tokens
    },
    'gemini-1.5-flash-latest': {
      inputTokensPerDollar: 1000000 / 0.075,
      outputTokensPerDollar: 1000000 / 0.30
    },
    'gemini-1.5-flash-8b': {
      inputTokensPerDollar: 1000000 / 0.0375, // $0.0375 per 1M tokens
      outputTokensPerDollar: 1000000 / 0.15 // $0.15 per 1M tokens
    },
    'gemini-1.5-flash-8b-latest': {
      inputTokensPerDollar: 1000000 / 0.0375,
      outputTokensPerDollar: 1000000 / 0.15
    },
    // Embedding model (input only)
    'gemini-embedding-001': {
      inputTokensPerDollar: 1000000 / 0.15, // $0.15 per 1M tokens
      outputTokensPerDollar: 0 // No output tokens for embeddings
    },
    // Latest generation models
    'gemini-2.0-flash-exp': {
      inputTokensPerDollar: 1000000 / 0.075, // Assuming similar to 1.5-flash
      outputTokensPerDollar: 1000000 / 0.30
    },
    'gemini-2.5-pro': {
      inputTokensPerDollar: 1000000 / 3.50, // Assuming similar to 1.5-pro
      outputTokensPerDollar: 1000000 / 10.50
    },
    'gemini-2.5-pro-latest': {
      inputTokensPerDollar: 1000000 / 3.50,
      outputTokensPerDollar: 1000000 / 10.50
    }
  },
  
  // CORS Configuration
  cors: {
    origin: process.env.CORS_ORIGIN || '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key']
  },
  
  // Logging Configuration
  logging: {
    level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'debug' : 'info'),
    format: process.env.LOG_FORMAT || 'combined'
  }
};

// Validation
const requiredEnvVars = [
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE',
  'GEMINI_API_KEY'
];

const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
if (missingVars.length > 0) {
  throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
}

module.exports = config; 