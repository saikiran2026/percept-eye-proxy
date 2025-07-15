const grpc = require('@grpc/grpc-js');
const config = require('./config/config');
const logger = require('./utils/logger');
const supabaseService = require('./services/supabase');

// Simple gRPC-to-REST proxy server
class GrpcProxy {
  constructor() {
    this.server = new grpc.Server();
  }

  // Authentication method
  async authenticateCall(call) {
    try {
      const metadata = call.metadata;
      const authHeaders = metadata.get('authorization');
      
      if (!authHeaders || authHeaders.length === 0) {
        throw new Error('No authorization header');
      }

      const authHeader = authHeaders[0];
      if (!authHeader.startsWith('Bearer ')) {
        throw new Error('Invalid authorization header format');
      }

      const token = authHeader.substring(7);
      const { user, error } = await supabaseService.verifyToken(token);

      if (error || !user) {
        throw new Error('Invalid or expired token');
      }

      return user;
    } catch (error) {
      logger.error('gRPC authentication failed', { error: error.message });
      throw error;
    }
  }

  // Proxy method for any request
  async proxyToGoogle(call, callback) {
    try {
      // Authenticate user
      const user = await this.authenticateCall(call);
      
      logger.info('gRPC request authenticated', {
        userId: user.id,
        email: user.email,
        method: call.getPath()
      });

      // Extract request data
      const request = call.request;
      
      // Determine the Google API endpoint from the gRPC path
      const grpcPath = call.getPath();
      let googleEndpoint = '';
      
      if (grpcPath.includes('GenerateContent')) {
        googleEndpoint = `models/${request.model}:generateContent`;
      } else if (grpcPath.includes('StreamGenerateContent')) {
        googleEndpoint = `models/${request.model}:streamGenerateContent`;
      } else if (grpcPath.includes('CountTokens')) {
        googleEndpoint = `models/${request.model}:countTokens`;
      } else {
        throw new Error(`Unsupported gRPC method: ${grpcPath}`);
      }

      // Convert gRPC request to REST format
      const restPayload = {
        contents: request.contents,
        generationConfig: request.generationConfig,
        safetySettings: request.safetySettings,
        systemInstruction: request.systemInstruction
      };

      // Call Google's REST API
      const googleUrl = `https://generativelanguage.googleapis.com/v1beta/${googleEndpoint}?key=${config.gemini.apiKey}`;
      
      const response = await fetch(googleUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'PerceptEye-gRPC-Proxy/1.0.0'
        },
        body: JSON.stringify(restPayload)
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error?.message || 'Google API request failed');
      }

      // Return the response (gRPC will serialize it)
      callback(null, data);

    } catch (error) {
      logger.error('gRPC proxy error', { 
        error: error.message,
        path: call.getPath()
      });
      
      const grpcError = new Error(error.message);
      grpcError.code = grpc.status.INTERNAL;
      callback(grpcError);
    }
  }

  start(port = 9090) {
    // Create a simple universal service that handles any method
    const serviceDefinition = {
      ProxyRequest: {
        path: '/proxy.GenerativeService/ProxyRequest',
        requestStream: false,
        responseStream: false,
        requestSerialize: (value) => Buffer.from(JSON.stringify(value)),
        requestDeserialize: (buffer) => JSON.parse(buffer.toString()),
        responseSerialize: (value) => Buffer.from(JSON.stringify(value)),
        responseDeserialize: (buffer) => JSON.parse(buffer.toString())
      }
    };

    try {
      this.server.addService(serviceDefinition, {
        ProxyRequest: this.proxyToGoogle.bind(this)
      });

      this.server.bindAsync(
        `0.0.0.0:${port}`,
        grpc.ServerCredentials.createInsecure(),
        (error, boundPort) => {
          if (error) {
            logger.error('Failed to bind gRPC server', { 
              error: error.message,
              port 
            });
            return;
          }
          
          logger.info('gRPC proxy server started', { 
            port: boundPort,
            address: `0.0.0.0:${boundPort}`
          });
          
          this.server.start();
        }
      );
    } catch (error) {
      logger.error('Failed to start gRPC server', { error: error.message });
    }
  }

  stop() {
    return new Promise((resolve) => {
      this.server.tryShutdown((error) => {
        if (error) {
          logger.error('Error shutting down gRPC server', { error: error.message });
        } else {
          logger.info('gRPC server shut down gracefully');
        }
        resolve();
      });
    });
  }
}

module.exports = GrpcProxy; 