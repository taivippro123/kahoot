const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { authenticateToken, checkSessionHost } = require('../middleware/auth');

// Generate PIN code
function generatePinCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Create game session
router.post('/session', authenticateToken, async (req, res) => {
  try {
    const { quizId } = req.body;
    const userId = req.user.id;

    // Check if user owns the quiz
    const [quizRows] = await pool.execute(
      'SELECT * FROM quizzes WHERE id = ? AND owner_id = ?',
      [quizId, userId]
    );

    if (quizRows.length === 0) {
      return res.status(403).json({
        success: false,
        message: 'Bạn không có quyền sử dụng quiz này'
      });
    }

    // Generate unique PIN code
    let pinCode;
    let isUnique = false;
    while (!isUnique) {
      pinCode = generatePinCode();
      const [existingSessions] = await pool.execute(
        'SELECT id FROM quiz_sessions WHERE pin_code = ? AND status IN ("waiting","in_progress")',
        [pinCode]
      );
      if (existingSessions.length === 0) {
        isUnique = true;
      }
    }

    // Create session
    const [result] = await pool.execute(
      'INSERT INTO quiz_sessions (quiz_id, host_id, pin_code, status, created_at) VALUES (?, ?, ?, "waiting", NOW())',
      [quizId, userId, pinCode]
    );

    const sessionId = result.insertId;

    res.json({
      success: true,
      message: 'Game session đã được tạo thành công',
      data: {
        sessionId,
        pinCode,
        quizId
      }
    });
  } catch (error) {
    console.error('Error creating game session:', error);
    res.status(500).json({
      success: false,
      message: 'Lỗi server khi tạo game session'
    });
  }
});

// Get session info by PIN
router.get('/session/:pinCode', async (req, res) => {
  try {
    const { pinCode } = req.params;

    const [sessions] = await pool.execute(`
      SELECT 
        qs.id as session_id,
        qs.pin_code,
        qs.status,
        qs.created_at,
        q.title as quiz_title,
        q.description as quiz_description,
        q.id as quiz_id
      FROM quiz_sessions qs
      JOIN quizzes q ON qs.quiz_id = q.id
      WHERE qs.pin_code = ? AND qs.status IN ("waiting","in_progress")
    `, [pinCode]);

    if (sessions.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Không tìm thấy game session với PIN này'
      });
    }

    const session = sessions[0];

    // Get player count
    const [playerCount] = await pool.execute(
      'SELECT COUNT(*) as count FROM player_sessions WHERE session_id = ?',
      [session.session_id]
    );

    res.json({
      success: true,
      data: {
        ...session,
        playerCount: playerCount[0].count
      }
    });
  } catch (error) {
    console.error('Error getting session info:', error);
    res.status(500).json({
      success: false,
      message: 'Lỗi server khi lấy thông tin session'
    });
  }
});

// Join game session
router.post('/join', async (req, res) => {
  try {
    const { pinCode, nickname } = req.body;

    // Validate input
    if (!pinCode || !nickname) {
      return res.status(400).json({
        success: false,
        message: 'PIN code và nickname là bắt buộc'
      });
    }

    // Check if session exists and is active
    const [sessions] = await pool.execute(
      'SELECT id, quiz_id FROM quiz_sessions WHERE pin_code = ? AND status = "waiting"',
      [pinCode]
    );

    if (sessions.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Không tìm thấy game session với PIN này'
      });
    }

    const sessionId = sessions[0].id;
    const quizId = sessions[0].quiz_id;

    // Check if nickname is already taken in this session
    const [existingPlayers] = await pool.execute(
      'SELECT id FROM player_sessions WHERE session_id = ? AND nickname = ?',
      [sessionId, nickname]
    );

    if (existingPlayers.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Nickname này đã được sử dụng trong session'
      });
    }

    // Create player session
    const [result] = await pool.execute(
      'INSERT INTO player_sessions (session_id, nickname) VALUES (?, ?)',
      [sessionId, nickname]
    );

    const playerId = result.insertId;

    res.json({
      success: true,
      message: 'Tham gia game thành công',
      data: {
        sessionId,
        playerId,
        nickname,
        pinCode
      }
    });
  } catch (error) {
    console.error('Error joining game:', error);
    res.status(500).json({
      success: false,
      message: 'Lỗi server khi tham gia game'
    });
  }
});

// Submit answer
router.post('/answer', async (req, res) => {
  try {
    const { sessionId, playerId, questionId, choiceId, timeMs } = req.body;

    // Validate input
    if (!sessionId || !playerId || !questionId || !choiceId) {
      return res.status(400).json({
        success: false,
        message: 'Thiếu thông tin cần thiết'
      });
    }

    // Check if session is active
    const [sessions] = await pool.execute(
      'SELECT status FROM quiz_sessions WHERE id = ?',
      [sessionId]
    );

    if (sessions.length === 0 || sessions[0].status !== 'in_progress') {
      return res.status(400).json({
        success: false,
        message: 'Game session không hợp lệ hoặc chưa bắt đầu'
      });
    }

    // Check if player exists in session
    const [players] = await pool.execute(
      'SELECT id FROM player_sessions WHERE id = ? AND session_id = ?',
      [playerId, sessionId]
    );

    if (players.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Người chơi không tồn tại trong session'
      });
    }

    // Check if answer already submitted
    const [existingAnswers] = await pool.execute(
      'SELECT id FROM player_answers WHERE session_id = ? AND player_id = ? AND question_id = ?',
      [sessionId, playerId, questionId]
    );

    if (existingAnswers.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Bạn đã trả lời câu hỏi này rồi'
      });
    }

    // Get question and choice info
    const [questions] = await pool.execute(`
      SELECT 
        q.id,
        q.content,
        q.time_limit_s,
        q.points,
        c.id as choice_id,
        c.content as choice_content,
        c.is_correct
      FROM questions q
      JOIN choices c ON q.id = c.question_id
      WHERE q.id = ? AND c.id = ?
    `, [questionId, choiceId]);

    if (questions.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Câu hỏi hoặc đáp án không hợp lệ'
      });
    }

    const question = questions[0];
    const isCorrect = question.is_correct;

    // Calculate score based on time and correctness
    let score = 0;
    if (isCorrect) {
      const maxTime = (questions[0].time_limit_s || 20) * 1000;
      const timeBonus = Math.max(0, (maxTime - (timeMs || 0)) / maxTime);
      score = Math.round((questions[0].points || 1000) * (0.5 + 0.5 * timeBonus));
    }

    // Save answer
    await pool.execute(
      'INSERT INTO player_answers (session_id, player_id, question_id, choice_id, time_ms, is_correct, score_earned) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [sessionId, playerId, questionId, choiceId, timeMs || 0, isCorrect ? 1 : 0, score]
    );

    // Compute player total score
    const [totals] = await pool.execute(
      'SELECT COALESCE(SUM(score_earned),0) as total FROM player_answers WHERE session_id = ? AND player_id = ?',
      [sessionId, playerId]
    );

    res.json({
      success: true,
      message: 'Đã gửi câu trả lời thành công',
      data: {
        isCorrect,
        score,
        totalScore: totals[0].total
      }
    });
  } catch (error) {
    console.error('Error submitting answer:', error);
    res.status(500).json({
      success: false,
      message: 'Lỗi server khi gửi câu trả lời'
    });
  }
});

// Get leaderboard for session
router.get('/session/:sessionId/leaderboard', async (req, res) => {
  try {
    const { sessionId } = req.params;

    // Check if session exists
    const [sessions] = await pool.execute(
      'SELECT id FROM quiz_sessions WHERE id = ?',
      [sessionId]
    );

    if (sessions.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Không tìm thấy game session'
      });
    }

    // Get leaderboard with player stats
    const [leaderboard] = await pool.execute(`
      SELECT 
        ps.id as player_id,
        ps.nickname,
        COALESCE(SUM(pa.score_earned),0) as total_score,
        COUNT(pa.id) as total_answers,
        SUM(CASE WHEN pa.is_correct = 1 THEN 1 ELSE 0 END) as correct_count,
        SUM(CASE WHEN pa.is_correct = 0 THEN 1 ELSE 0 END) as wrong_count
      FROM player_sessions ps
      LEFT JOIN player_answers pa ON ps.id = pa.player_id AND pa.session_id = ?
      WHERE ps.session_id = ?
      GROUP BY ps.id, ps.nickname
      ORDER BY total_score DESC, MIN(ps.joined_at) ASC
    `, [sessionId, sessionId]);

    // Add rank to each player
    const leaderboardWithRank = leaderboard.map((player, index) => ({
      ...player,
      rank: index + 1
    }));

    res.json({
      success: true,
      data: leaderboardWithRank
    });
  } catch (error) {
    console.error('Error getting leaderboard:', error);
    res.status(500).json({
      success: false,
      message: 'Lỗi server khi lấy bảng xếp hạng'
    });
  }
});

// Start game (host only)
router.post('/session/:sessionId/start', authenticateToken, checkSessionHost, async (req, res) => {
  try {
    const { sessionId } = req.params;

    // Update session status
    await pool.execute(
      'UPDATE quiz_sessions SET status = "in_progress", started_at = NOW() WHERE id = ?',
      [sessionId]
    );

    res.json({
      success: true,
      message: 'Game đã bắt đầu'
    });
  } catch (error) {
    console.error('Error starting game:', error);
    res.status(500).json({
      success: false,
      message: 'Lỗi server khi bắt đầu game'
    });
  }
});

// End game (host only)
router.post('/session/:sessionId/end', authenticateToken, checkSessionHost, async (req, res) => {
  try {
    const { sessionId } = req.params;

    // Update session status
    await pool.execute(
      'UPDATE quiz_sessions SET status = "ended", ended_at = NOW() WHERE id = ?',
      [sessionId]
    );

    // Generate final leaderboard
    const [leaderboard] = await pool.execute(`
      SELECT 
        ps.id as player_id,
        ps.nickname,
        COALESCE(SUM(pa.score_earned),0) as total_score,
        COUNT(pa.id) as total_answers,
        SUM(CASE WHEN pa.is_correct = 1 THEN 1 ELSE 0 END) as correct_count,
        SUM(CASE WHEN pa.is_correct = 0 THEN 1 ELSE 0 END) as wrong_count
      FROM player_sessions ps
      LEFT JOIN player_answers pa ON ps.id = pa.player_id AND pa.session_id = ?
      WHERE ps.session_id = ?
      GROUP BY ps.id, ps.nickname
      ORDER BY total_score DESC, MIN(ps.joined_at) ASC
    `, [sessionId, sessionId]);

    // Session data for summary
    const [[sessionRow]] = await pool.execute('SELECT quiz_id FROM quiz_sessions WHERE id = ?', [sessionId]);
    const [[qCount]] = await pool.execute('SELECT COUNT(*) as cnt FROM questions WHERE quiz_id = ?', [sessionRow.quiz_id]);
    const [[ansCount]] = await pool.execute('SELECT COUNT(*) as cnt FROM player_answers WHERE session_id = ?', [sessionId]);
    const [[acc]] = await pool.execute('SELECT IFNULL(AVG(is_correct)*100,0) as pct FROM player_answers WHERE session_id = ?', [sessionId]);
    const [[pCount]] = await pool.execute('SELECT COUNT(*) as cnt FROM player_sessions WHERE session_id = ?', [sessionId]);

    // Save session summary
    await pool.execute(`
      INSERT INTO session_summaries (
        session_id, 
        total_players, 
        total_questions, 
        total_answers, 
        avg_accuracy_pct,
        created_at
      ) VALUES (?, ?, ?, ?, ?, NOW())
    `, [
      sessionId,
      pCount.cnt,
      qCount.cnt,
      ansCount.cnt,
      acc.pct
    ]);

    res.json({
      success: true,
      message: 'Game đã kết thúc',
      data: {
        leaderboard: leaderboard.map((player, index) => ({
          ...player,
          rank: index + 1
        }))
      }
    });
  } catch (error) {
    console.error('Error ending game:', error);
    res.status(500).json({
      success: false,
      message: 'Lỗi server khi kết thúc game'
    });
  }
});

// Get session statistics
router.get('/session/:sessionId/stats', async (req, res) => {
  try {
    const { sessionId } = req.params;

    // Get basic session info
    const [sessions] = await pool.execute(`
      SELECT 
        qs.*,
        q.title as quiz_title,
        q.description as quiz_description
      FROM quiz_sessions qs
      JOIN quizzes q ON qs.quiz_id = q.id
      WHERE qs.id = ?
    `, [sessionId]);

    if (sessions.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Không tìm thấy game session'
      });
    }

    const session = sessions[0];

    // Get player count
    const [playerCount] = await pool.execute(
      'SELECT COUNT(*) as count FROM player_sessions WHERE session_id = ?',
      [sessionId]
    );

    // Get question count
    const [questionCount] = await pool.execute(
      'SELECT COUNT(*) as count FROM questions WHERE quiz_id = ?',
      [session.quiz_id]
    );

    // Get answer statistics
    const [answerStats] = await pool.execute(`
      SELECT 
        COUNT(*) as total_answers,
        SUM(CASE WHEN is_correct = 1 THEN 1 ELSE 0 END) as correct_answers,
        AVG(time_ms) as avg_time_ms
      FROM player_answers
      WHERE session_id = ?
    `, [sessionId]);

    res.json({
      success: true,
      data: {
        session,
        playerCount: playerCount[0].count,
        questionCount: questionCount[0].count,
        answerStats: answerStats[0]
      }
    });
  } catch (error) {
    console.error('Error getting session stats:', error);
    res.status(500).json({
      success: false,
      message: 'Lỗi server khi lấy thống kê session'
    });
  }
});

// Get players in a session (fallback for initial load)
router.get('/session/:sessionId/players', async (req, res) => {
  try {
    const { sessionId } = req.params;

    const [sessionRows] = await pool.execute(
      'SELECT id FROM quiz_sessions WHERE id = ?',
      [sessionId]
    );
    if (sessionRows.length === 0) {
      return res.status(404).json({ success: false, message: 'Session không tồn tại' });
    }

    const [players] = await pool.execute(
      'SELECT id as playerId, nickname, joined_at as joinedAt FROM player_sessions WHERE session_id = ? ORDER BY joined_at ASC',
      [sessionId]
    );

    res.json({ success: true, data: players });
  } catch (error) {
    console.error('Error getting session players:', error);
    res.status(500).json({ success: false, message: 'Lỗi server khi lấy danh sách người chơi' });
  }
});

module.exports = router;
