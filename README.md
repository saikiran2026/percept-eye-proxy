# PerceptEye Gemini Proxy

A secure proxy server for Google Generative AI APIs with Supabase authentication, rate limiting, and usage tracking.

## Features

- 🔐 **Supabase Authentication**: JWT-based authentication for secure access
- 🚦 **Rate Limiting**: User-specific rate limits based on subscription tiers
- 📊 **Usage Tracking**: Comprehensive token and cost tracking
- 💰 **Cost Management**: Real-time cost calculation and daily limits
- 🔒 **Security**: Helmet.js security headers, CORS configuration
- 📈 **Logging**: Structured logging with Winston
- 🐳 **Containerized**: Docker support for easy deployment
- ☁️ **Cloud Ready**: Optimized for Google Cloud Run deployment

## Architecture

```
[Electron App] → [Proxy Server] → [Google Gemini API]
                      ↓
               [Supabase Database]
```

The proxy server:
1. Authenticates users via Supabase JWT tokens
2. Checks rate limits and usage quotas
3. Forwards requests to Google Gemini API
4. Tracks usage and costs in Supabase
5. Returns responses with usage metadata

## Quick Start

### Prerequisites

- Node.js 18+ 
- Docker (for containerization)
- Google Cloud SDK (for deployment)
- Supabase account and project
- Google Cloud project with Gemini API access

### Local Development

1. **Clone and install dependencies:**
   ```bash
   git clone <repository-url>
   cd percepteye-proxy
   npm install
   ```

2. **Set up environment:**
   ```bash
   cp env.example .env
   # Edit .env with your actual values
   ```

3. **Start development server:**
   ```bash
   npm run dev
   ```

4. **Test the server:**
   ```bash
   curl http://localhost:3000/health
   ```

### Environment Variables

Required environment variables:

```bash
# Server Configuration
PORT=3000
NODE_ENV=development
LOG_LEVEL=info
CORS_ORIGIN=*

# Supabase Configuration
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE=your-service-role-key

# Google Cloud Configuration
GCP_PROJECT_ID=your-gcp-project-id
GCP_REGION=us-central1
SERVICE_NAME=gemini-proxy

# Gemini API Configuration
GEMINI_API_KEY=your-gemini-api-key
```

## API Endpoints

### Authentication

All API endpoints (except `/health` and `/api/docs`) require authentication via Bearer token:

```bash
Authorization: Bearer <supabase-jwt-token>
```

### Available Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Service health check |
| GET | `/api/docs` | API documentation |
| GET | `/api/gemini/models` | List available models |
| GET | `/api/gemini/usage` | Get user usage statistics |
| GET | `/api/gemini/health` | Gemini service health |
| POST | `/api/gemini/:model/generateContent` | Generate content |
| POST | `/api/gemini/:model/streamGenerateContent` | Stream generate content |
| POST | `/api/gemini/:model/countTokens` | Count tokens |

### Supported Models

- `gemini-pro`
- `gemini-pro-vision`
- `gemini-1.5-pro`
- `gemini-1.5-flash`
- `gemini-1.5-flash-8b`

### Example Usage

**Generate Content:**
```bash
curl -X POST "https://your-proxy-url/api/gemini/gemini-pro/generateContent" \
  -H "Authorization: Bearer <your-jwt-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "contents": [{
      "parts": [{
        "text": "Explain quantum computing in simple terms"
      }]
    }]
  }'
```

**Get Usage Statistics:**
```bash
curl -X GET "https://your-proxy-url/api/gemini/usage" \
  -H "Authorization: Bearer <your-jwt-token>"
```

## Database Schema

The proxy uses the following Supabase tables:

### `api_usage`
Tracks API usage per user:
- `user_id`: User identifier
- `tokens_used`: Number of tokens consumed
- `cost`: Cost in USD
- `model_name`: Gemini model used
- `request_type`: Type of request (generate, stream, etc.)
- `timestamp`: Request timestamp

### `user_limits`
Defines user-specific limits:
- `user_id`: User identifier
- `requests_per_hour`: Hourly request limit
- `tokens_per_day`: Daily token limit
- `max_cost_per_day`: Daily cost limit

### `user_profiles`
User profile information:
- `user_id`: User identifier
- `subscription_tier`: User's subscription level
- `is_active`: Account status

## Rate Limiting

The proxy implements multiple levels of rate limiting:

1. **Global Rate Limit**: 1000 requests per 15 minutes per IP
2. **User-based Limits**: Based on subscription tier:
   - Free: 100 requests/hour
   - Pro: 1000 requests/hour
   - Premium: 5000 requests/hour
   - Enterprise: 10000 requests/hour
3. **Token Limits**: Daily token consumption limits
4. **Cost Limits**: Daily spending limits

## Deployment

### Using the Deployment Script

1. **Prepare environment:**
   ```bash
   cp env.example .env
   # Edit .env with production values
   ```

2. **Run deployment:**
   ```bash
   ./deploy.sh
   ```

### Manual Deployment to Google Cloud Run

1. **Build and push image:**
   ```bash
   docker build -t gcr.io/PROJECT_ID/gemini-proxy .
   docker push gcr.io/PROJECT_ID/gemini-proxy
   ```

2. **Deploy to Cloud Run:**
   ```bash
   gcloud run deploy gemini-proxy \
     --image gcr.io/PROJECT_ID/gemini-proxy \
     --region us-central1 \
     --allow-unauthenticated \
     --set-env-vars "NODE_ENV=production,..."
   ```

### Using Cloud Build

```bash
gcloud builds submit --config cloudbuild.yaml
```

## Monitoring and Logging

### Health Checks

- Service health: `/health`
- Gemini service health: `/api/gemini/health`

### Logging

The service uses structured logging with different levels:
- `error`: Error conditions
- `warn`: Warning conditions
- `info`: Informational messages
- `debug`: Debug information

Logs are output to console in JSON format for production.

### Metrics

Monitor these key metrics:
- Request rate and latency
- Error rates by endpoint
- Token usage per user
- Cost accumulation
- Rate limit hits

## Security

### Security Headers

The proxy implements security best practices:
- Helmet.js for security headers
- CORS configuration
- Request size limits
- Rate limiting
- Input validation with Joi

### Authentication

- JWT token validation via Supabase
- User session management
- Role-based access control

### Data Protection

- No sensitive data logged
- API keys masked in logs
- Secure environment variable handling

## Integration with Electron App

### Setting up Authentication

In your Electron app, use Supabase client to authenticate:

```javascript
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  'https://bvhsrithcvbzoeogcbyb.supabase.co',
  'your-anon-key'
)

// After user login
const { data: { session } } = await supabase.auth.getSession()
const token = session?.access_token
```

### Making API Calls

Use the JWT token to call the proxy:

```javascript
const response = await fetch('https://your-proxy-url/api/gemini/gemini-pro/generateContent', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    contents: [{
      parts: [{ text: 'Your prompt here' }]
    }]
  })
})
```

## Development

### Project Structure

```
src/
├── config/          # Configuration files
├── middleware/      # Express middleware
├── routes/          # API routes
├── services/        # Business logic services
├── utils/           # Utility functions
└── server.js        # Main server file
```

### Scripts

- `npm start`: Start production server
- `npm run dev`: Start development server with nodemon
- `npm test`: Run tests

### Adding New Features

1. Create middleware in `src/middleware/`
2. Add routes in `src/routes/`
3. Implement business logic in `src/services/`
4. Add tests
5. Update documentation

## Troubleshooting

### Common Issues

1. **Authentication errors**: Check Supabase configuration and JWT token validity
2. **Rate limiting**: Monitor usage and adjust limits in database
3. **API errors**: Check Gemini API key and quota
4. **Connection issues**: Verify network connectivity and firewall rules

### Debug Mode

Set `LOG_LEVEL=debug` for detailed logging:

```bash
LOG_LEVEL=debug npm run dev
```

### Health Checks

Use health endpoints to diagnose issues:
- Service: `GET /health`
- Gemini API: `GET /api/gemini/health`

## Support

For issues and questions:
1. Check the logs for error details
2. Verify environment configuration
3. Test with health endpoints
4. Check Supabase database connectivity

## License

MIT License - see LICENSE file for details. # percept-eye-proxy
