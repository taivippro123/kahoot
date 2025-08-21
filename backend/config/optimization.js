/**
 * 🚀 Socket Realtime Optimization Configuration
 * Cấu hình các tham số tối ưu hóa cho Kahoot Clone
 */

module.exports = {
  // Cache Configuration
  cache: {
    // Thời gian cache tối đa (ms) - 5 phút
    maxAge: 5 * 60 * 1000,
    
    // Số lượng answers tối đa trong cache trước khi force save
    maxAnswersInCache: 100,
    
    // Thời gian auto-save cache (ms) - 30 giây
    autoSaveInterval: 30 * 1000,
    
    // Cleanup cache khi không sử dụng (ms) - 10 phút
    cleanupInterval: 10 * 60 * 1000
  },

  // Database Optimization
  database: {
    // Batch size tối đa cho insert
    maxBatchSize: 50,
    
    // Thời gian timeout cho DB operations (ms)
    queryTimeout: 5000,
    
    // Số lần retry khi DB fail
    maxRetries: 3,
    
    // Delay giữa các retry (ms)
    retryDelay: 1000
  },

  // Socket Configuration
  socket: {
    // Rate limiting cho submit_answer (ms)
    submitAnswerRateLimit: 500,
    
    // Rate limiting cho các events khác (ms)
    defaultRateLimit: 1000,
    
    // Ping timeout (ms)
    pingTimeout: 60000,
    
    // Ping interval (ms)
    pingInterval: 25000,
    
    // Max buffer size (bytes)
    maxHttpBufferSize: 1e6
  },

  // Performance Tuning
  performance: {
    // Số lượng concurrent connections tối đa
    maxConcurrentConnections: 1000,
    
    // Memory limit cho cache (MB)
    maxCacheMemory: 100,
    
    // Thời gian cleanup sessions (ms)
    sessionCleanupInterval: 5 * 60 * 1000,
    
    // Số lượng inactive sessions tối đa
    maxInactiveSessions: 50
  },

  // Feature Flags
  features: {
    // Bật/tắt cache optimization
    enableCache: true,
    
    // Bật/tắt batch DB operations
    enableBatchOperations: true,
    
    // Bật/tắt async DB writes
    enableAsyncWrites: true,
    
    // Bật/tắt realtime optimization
    enableRealtimeOptimization: true,
    
    // Bật/tắt graceful shutdown
    enableGracefulShutdown: true
  },

  // Logging Configuration
  logging: {
    // Log level: 'debug', 'info', 'warn', 'error'
    level: 'info',
    
    // Bật/tắt performance metrics
    enablePerformanceMetrics: true,
    
    // Bật/tắt cache hit/miss logging
    enableCacheLogging: true,
    
    // Bật/tắt DB operation logging
    enableDBLogging: false
  },

  // Monitoring Configuration
  monitoring: {
    // Bật/tắt health check endpoint
    enableHealthCheck: true,
    
    // Bật/tắt performance monitoring
    enablePerformanceMonitoring: true,
    
    // Metrics collection interval (ms)
    metricsInterval: 10 * 1000,
    
    // Alert threshold cho response time (ms)
    responseTimeThreshold: 100
  }
};
