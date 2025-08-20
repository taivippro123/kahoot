const jwt = require('jsonwebtoken');
const { pool } = require('../db');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

// Middleware xác thực JWT token
const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Token xác thực không được cung cấp'
      });
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      
      // decoded trong auth.js là { id, email }
      const userId = decoded.id; // FIX: trước đây đọc nhầm decoded.userId

      // Kiểm tra user có tồn tại trong database không
      const [users] = await pool.execute(
        'SELECT id, email, display_name, created_at FROM users WHERE id = ?',
        [userId]
      );

      if (users.length === 0) {
        return res.status(401).json({
          success: false,
          message: 'Token không hợp lệ hoặc user không tồn tại'
        });
      }

      req.user = users[0];
      next();
    } catch (jwtError) {
      if (jwtError.name === 'TokenExpiredError') {
        return res.status(401).json({
          success: false,
          message: 'Token đã hết hạn, vui lòng đăng nhập lại'
        });
      }
      
      return res.status(401).json({
        success: false,
        message: 'Token không hợp lệ'
      });
    }
  } catch (error) {
    console.error('Authentication error:', error);
    return res.status(500).json({
      success: false,
      message: 'Lỗi xác thực'
    });
  }
};

// Middleware kiểm tra quyền sở hữu quiz
const checkQuizOwnership = async (req, res, next) => {
  try {
    const quizId = req.params.id;
    const userId = req.user.id;

    if (!quizId) {
      return res.status(400).json({
        success: false,
        message: 'Quiz ID là bắt buộc'
      });
    }

    const [quizzes] = await pool.execute(
      'SELECT id FROM quizzes WHERE id = ? AND owner_id = ?',
      [quizId, userId]
    );

    if (quizzes.length === 0) {
      return res.status(403).json({
        success: false,
        message: 'Bạn không có quyền thực hiện thao tác này với quiz này'
      });
    }

    next();
  } catch (error) {
    console.error('Quiz ownership check error:', error);
    return res.status(500).json({
      success: false,
      message: 'Lỗi kiểm tra quyền sở hữu quiz'
    });
  }
};

// Middleware kiểm tra quyền host của session
const checkSessionHost = async (req, res, next) => {
  try {
    const sessionId = req.params.sessionId;
    const userId = req.user.id;

    if (!sessionId) {
      return res.status(400).json({
        success: false,
        message: 'Session ID là bắt buộc'
      });
    }

    const [sessions] = await pool.execute(
      'SELECT id FROM quiz_sessions WHERE id = ? AND host_id = ?',
      [sessionId, userId]
    );

    if (sessions.length === 0) {
      return res.status(403).json({
        success: false,
        message: 'Bạn không phải là host của session này'
      });
    }

    next();
  } catch (error) {
    console.error('Session host check error:', error);
    return res.status(500).json({
      success: false,
      message: 'Lỗi kiểm tra quyền host session'
    });
  }
};

// Middleware kiểm tra quyền admin (nếu cần)
const checkAdminRole = async (req, res, next) => {
  try {
    const userId = req.user.id;

    const [users] = await pool.execute(
      'SELECT role FROM users WHERE id = ?',
      [userId]
    );

    if (users.length === 0 || users[0].role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Bạn không có quyền admin để thực hiện thao tác này'
      });
    }

    next();
  } catch (error) {
    console.error('Admin role check error:', error);
    return res.status(500).json({
      success: false,
      message: 'Lỗi kiểm tra quyền admin'
    });
  }
};

// Middleware kiểm tra rate limiting (cơ bản)
const rateLimit = (windowMs = 15 * 60 * 1000, max = 100) => {
  const requests = new Map();

  return (req, res, next) => {
    const ip = req.ip || req.connection.remoteAddress;
    const now = Date.now();
    const windowStart = now - windowMs;

    // Clean old requests
    if (requests.has(ip)) {
      requests.set(ip, requests.get(ip).filter(timestamp => timestamp > windowStart));
    }

    const currentRequests = requests.get(ip) || [];
    
    if (currentRequests.length >= max) {
      return res.status(429).json({
        success: false,
        message: 'Quá nhiều yêu cầu, vui lòng thử lại sau'
      });
    }

    currentRequests.push(now);
    requests.set(ip, currentRequests);
    next();
  };
};

module.exports = {
  authenticateToken,
  checkQuizOwnership,
  checkSessionHost,
  checkAdminRole,
  rateLimit
};
