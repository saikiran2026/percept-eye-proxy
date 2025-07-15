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
const GrpcProxy = require('./grpc-proxy');

const app = express();
const grpcProxy = new GrpcProxy();

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
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>PerceptEye Gemini Proxy - API Documentation</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            line-height: 1.6;
            color: #333;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            padding: 20px;
        }
        
        .container {
            max-width: 1200px;
            margin: 0 auto;
            background: white;
            border-radius: 12px;
            box-shadow: 0 20px 40px rgba(0,0,0,0.1);
            overflow: hidden;
        }
        
        .header {
            background: linear-gradient(135deg, #2c3e50 0%, #34495e 100%);
            color: white;
            padding: 40px;
            text-align: center;
        }
        
        .header h1 {
            font-size: 2.5rem;
            margin-bottom: 10px;
            font-weight: 700;
        }
        
        .header p {
            font-size: 1.1rem;
            opacity: 0.9;
        }
        
        .content {
            padding: 40px;
        }
        
        .section {
            margin-bottom: 40px;
        }
        
        .section h2 {
            font-size: 1.8rem;
            margin-bottom: 20px;
            color: #2c3e50;
            border-bottom: 3px solid #3498db;
            padding-bottom: 10px;
        }
        
        .endpoint {
            background: #f8f9fa;
            border-left: 4px solid #3498db;
            padding: 20px;
            margin-bottom: 15px;
            border-radius: 6px;
        }
        
        .endpoint h3 {
            font-size: 1.2rem;
            margin-bottom: 8px;
            color: #2c3e50;
        }
        
        .method {
            display: inline-block;
            padding: 4px 12px;
            border-radius: 4px;
            font-weight: bold;
            font-size: 0.85rem;
            margin-right: 10px;
        }
        
        .method.get { background: #27ae60; color: white; }
        .method.post { background: #e74c3c; color: white; }
        
        .model-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 15px;
            margin-top: 15px;
        }
        
        .model-item {
            background: #ecf0f1;
            padding: 15px;
            border-radius: 6px;
            border-left: 4px solid #9b59b6;
        }
        
        .auth-box {
            background: #fff3cd;
            border: 1px solid #ffeaa7;
            border-radius: 6px;
            padding: 20px;
            margin: 20px 0;
        }
        
        .auth-box h3 {
            color: #856404;
            margin-bottom: 10px;
        }
        
        .limits-table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 15px;
        }
        
        .limits-table th,
        .limits-table td {
            padding: 12px;
            text-align: left;
            border-bottom: 1px solid #ddd;
        }
        
        .limits-table th {
            background: #3498db;
            color: white;
        }
        
        .limits-table tr:nth-child(even) {
            background: #f8f9fa;
        }
        
        .status-badge {
            display: inline-block;
            padding: 6px 12px;
            background: #27ae60;
            color: white;
            border-radius: 20px;
            font-size: 0.9rem;
            font-weight: bold;
        }
        
        .footer {
            background: #2c3e50;
            color: white;
            text-align: center;
            padding: 20px;
            font-size: 0.9rem;
        }
        
        .code {
            background: #2c3e50;
            color: #ecf0f1;
            padding: 3px 6px;
            border-radius: 3px;
            font-family: 'Courier New', monospace;
            font-size: 0.9rem;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>PerceptEye Gemini Proxy</h1>
            <p>Secure API Gateway for Google Generative AI Models</p>
            <div style="margin-top: 20px;">
                <span class="status-badge">✓ Service Online</span>
            </div>
        </div>
        
        <div class="content">
            <div class="section">
                <h2>🔐 Authentication</h2>
                <div class="auth-box">
                    <h3>Required: Bearer Token</h3>
                    <p>All API requests require a valid Supabase JWT token in the Authorization header:</p>
                    <p><span class="code">Authorization: Bearer YOUR_JWT_TOKEN</span></p>
                </div>
            </div>
            
            <div class="section">
                <h2>🚀 Transparent Proxy</h2>
                <div class="auth-box">
                    <h3>🎯 Super Simple Integration</h3>
                    <p><strong>Just replace Google's base URL with ours!</strong></p>
                    <div style="margin: 15px 0;">
                        <p><strong>Before:</strong> <span class="code">https://generativelanguage.googleapis.com</span></p>
                        <p><strong>After:</strong> <span class="code">https://gemini-proxy-193126246557.us-central1.run.app/api/gemini</span></p>
                    </div>
                    <p>Everything else stays exactly the same - paths, request bodies, response format!</p>
                </div>
                
                <div class="endpoint">
                    <h3><span class="method get">GET</span> /api/gemini/* (Any Path)</h3>
                    <p><strong>Transparent proxy to Google Gemini API</strong> - forwards all requests exactly as-is</p>
                    <p>Examples:</p>
                    <ul style="margin-top: 10px; margin-left: 20px;">
                        <li><span class="code">/api/gemini/v1beta/models</span></li>
                        <li><span class="code">/api/gemini/v1beta/models/gemini-1.5-flash:generateContent</span></li>
                        <li><span class="code">/api/gemini/v1beta/models/gemini-1.5-flash:streamGenerateContent</span></li>
                        <li><span class="code">/api/gemini/v1beta/models/gemini-1.5-flash:countTokens</span></li>
                        <li><span class="code">/api/gemini/v1beta/models/text-embedding-004:embedContent</span></li>
                    </ul>
                </div>
                
                <div class="endpoint">
                    <h3><span class="method get">GET</span> /health</h3>
                    <p>General service health check</p>
                </div>
            </div>
            
            <div class="section">
                <h2>🤖 Available Models</h2>
                <div class="model-grid">
                    <div class="model-item">
                        <strong>gemini-2.5-pro</strong><br>
                        Latest generation model
                    </div>
                    <div class="model-item">
                        <strong>gemini-2.5-pro-latest</strong><br>
                        Always up-to-date 2.5 Pro
                    </div>
                    <div class="model-item">
                        <strong>gemini-2.0-flash-exp</strong><br>
                        Experimental Flash model
                    </div>
                    <div class="model-item">
                        <strong>gemini-1.5-pro</strong><br>
                        High-quality text generation
                    </div>
                    <div class="model-item">
                        <strong>gemini-1.5-flash</strong><br>
                        Fast text generation
                    </div>
                    <div class="model-item">
                        <strong>gemini-1.5-flash-8b</strong><br>
                        Efficient 8B parameter model
                    </div>
                    <div class="model-item">
                        <strong>gemini-embedding-001</strong><br>
                        Text embeddings
                    </div>
                    <div class="model-item">
                        <strong>text-embedding-004</strong><br>
                        Advanced embeddings
                    </div>
                </div>
            </div>
            
            <div class="section">
                <h2>⚡ Rate Limits</h2>
                <table class="limits-table">
                    <thead>
                        <tr>
                            <th>Subscription Tier</th>
                            <th>Requests/Hour</th>
                            <th>Tokens/Day</th>
                            <th>Cost/Day</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td>Free</td>
                            <td>100</td>
                            <td>10,000</td>
                            <td>$50</td>
                        </tr>
                        <tr>
                            <td>Pro</td>
                            <td>1,000</td>
                            <td>Custom</td>
                            <td>Custom</td>
                        </tr>
                        <tr>
                            <td>Premium</td>
                            <td>5,000</td>
                            <td>Custom</td>
                            <td>Custom</td>
                        </tr>
                        <tr>
                            <td>Enterprise</td>
                            <td>10,000</td>
                            <td>Custom</td>
                            <td>Custom</td>
                        </tr>
                    </tbody>
                </table>
                <p style="margin-top: 15px; font-size: 0.9rem; color: #666;">
                    Global rate limit: 1000 requests per 15 minutes per IP address
                </p>
            </div>
            
            <div class="section">
                <h2>📊 Usage Examples</h2>
                
                <h3 style="color: #2c3e50; margin-bottom: 15px;">🐍 Python Integration</h3>
                <div style="background: #2c3e50; color: #ecf0f1; padding: 20px; border-radius: 6px; overflow-x: auto; margin-bottom: 20px;">
                    <pre style="margin: 0; font-family: 'Courier New', monospace;">import requests

# Just change the base URL!
url = "https://gemini-proxy-193126246557.us-central1.run.app/api/gemini/v1beta/models/gemini-1.5-flash:generateContent"
headers = {
    "Authorization": "Bearer YOUR_SUPABASE_JWT_TOKEN",
    "Content-Type": "application/json"
}
data = {
    "contents": [{"parts": [{"text": "Hello, AI!"}]}]
}

response = requests.post(url, headers=headers, json=data)
print(response.json())</pre>
                </div>

                <h3 style="color: #2c3e50; margin-bottom: 15px;">🌐 cURL Examples</h3>
                <div style="background: #2c3e50; color: #ecf0f1; padding: 20px; border-radius: 6px; overflow-x: auto;">
                    <pre style="margin: 0; font-family: 'Courier New', monospace;"># List models
curl "https://gemini-proxy-193126246557.us-central1.run.app/api/gemini/v1beta/models" \\
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# Generate content
curl "https://gemini-proxy-193126246557.us-central1.run.app/api/gemini/v1beta/models/gemini-1.5-flash:generateContent" \\
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"contents":[{"parts":[{"text":"Write a poem"}]}]}'

# Count tokens
curl "https://gemini-proxy-193126246557.us-central1.run.app/api/gemini/v1beta/models/gemini-1.5-flash:countTokens" \\
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"contents":[{"parts":[{"text":"Count these tokens"}]}]}'</pre>
                </div>
            </div>
        </div>
        
        <div class="footer">
            <p>&copy; 2025 PerceptEye - Gemini Proxy API v1.0.0 | Server Time: ${new Date().toISOString()}</p>
        </div>
    </div>
</body>
</html>`;
  
  res.set('Content-Type', 'text/html');
  res.send(html);
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
  shutdown();
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  shutdown();
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

// Start HTTP server
const server = app.listen(config.port, () => {
  logger.info('HTTP Server started', {
    port: config.port,
    environment: config.nodeEnv,
    timestamp: new Date().toISOString()
  });
});

// Start gRPC server
const grpcPort = process.env.GRPC_PORT || 9090;
grpcProxy.start(grpcPort);

// Graceful shutdown for both servers
const shutdown = async () => {
  logger.info('Shutting down servers...');
  
  // Close HTTP server
  server.close(() => {
    logger.info('HTTP server closed');
  });
  
  // Close gRPC server
  await grpcProxy.stop();
  
  logger.info('All servers shut down');
  process.exit(0);
};

module.exports = app; 