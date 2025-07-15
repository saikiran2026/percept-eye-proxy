const redis = require('redis');
const logger = require('../utils/logger');

let client = null;
let isConnected = false;

async function initializeRedis() {
  try {
    const redisHost = process.env.REDIS_HOST;
    const redisPort = process.env.REDIS_PORT || 6379;

    if (!redisHost) {
      logger.info('Redis not configured, using in-memory store');
      return;
    }

    client = redis.createClient({
      host: redisHost,
      port: redisPort,
      retry_strategy: (options) => {
        if (options.error && options.error.code === 'ECONNREFUSED') {
          // End reconnecting on a specific error and flush all commands with a error
          logger.error('Redis server refused the connection');
          return new Error('Redis server connection refused');
        }
        if (options.total_retry_time > 1000 * 60 * 60) {
          // End reconnecting after a specific timeout and flush all commands with a error
          logger.error('Redis retry time exhausted');
          return new Error('Redis retry time exhausted');
        }
        if (options.attempt > 10) {
          // End reconnecting with built in error
          logger.error('Redis retry attempts exhausted');
          return undefined;
        }
        // Reconnect after
        return Math.min(options.attempt * 100, 3000);
      }
    });

    client.on('connect', () => {
      logger.info('Redis client connected');
      isConnected = true;
    });

    client.on('ready', () => {
      logger.info('Redis client ready');
      isConnected = true;
    });

    client.on('error', (err) => {
      logger.error('Redis client error', { error: err.message });
      isConnected = false;
    });

    client.on('end', () => {
      logger.info('Redis client disconnected');
      isConnected = false;
    });

    client.on('reconnecting', () => {
      logger.info('Redis client reconnecting');
      isConnected = false;
    });

    // Connect to Redis
    await client.connect();
    
  } catch (error) {
    logger.error('Failed to initialize Redis', { error: error.message });
    client = null;
    isConnected = false;
  }
}

async function getClient() {
  return client;
}

function isRedisConnected() {
  return isConnected && client && client.isOpen;
}

async function set(key, value, ttl = null) {
  if (!isRedisConnected()) {
    logger.debug('Redis not available, skipping set operation');
    return false;
  }

  try {
    if (ttl) {
      await client.setEx(key, ttl, value);
    } else {
      await client.set(key, value);
    }
    return true;
  } catch (error) {
    logger.error('Redis set error', { error: error.message, key });
    return false;
  }
}

async function get(key) {
  if (!isRedisConnected()) {
    logger.debug('Redis not available, skipping get operation');
    return null;
  }

  try {
    return await client.get(key);
  } catch (error) {
    logger.error('Redis get error', { error: error.message, key });
    return null;
  }
}

async function incr(key) {
  if (!isRedisConnected()) {
    logger.debug('Redis not available, skipping incr operation');
    return null;
  }

  try {
    return await client.incr(key);
  } catch (error) {
    logger.error('Redis incr error', { error: error.message, key });
    return null;
  }
}

async function expire(key, ttl) {
  if (!isRedisConnected()) {
    logger.debug('Redis not available, skipping expire operation');
    return false;
  }

  try {
    await client.expire(key, ttl);
    return true;
  } catch (error) {
    logger.error('Redis expire error', { error: error.message, key });
    return false;
  }
}

async function del(key) {
  if (!isRedisConnected()) {
    logger.debug('Redis not available, skipping del operation');
    return false;
  }

  try {
    await client.del(key);
    return true;
  } catch (error) {
    logger.error('Redis del error', { error: error.message, key });
    return false;
  }
}

// Initialize Redis connection on module load
initializeRedis().catch(error => {
  logger.error('Redis initialization failed', { error: error.message });
});

module.exports = {
  getClient,
  isRedisConnected,
  set,
  get,
  incr,
  expire,
  del,
  initializeRedis
}; 