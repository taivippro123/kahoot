const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { authenticateToken, checkQuizOwnership } = require('../middleware/auth');

// GET /api/quiz - Lấy danh sách quiz của user
router.get('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    const [quizzes] = await pool.execute(`
      SELECT 
        q.id,
        q.title,
        q.description,
        q.is_public,
        q.created_at,
        (SELECT COUNT(*) FROM questions qq WHERE qq.quiz_id = q.id) AS question_count,
        (SELECT COUNT(*) FROM quiz_sessions s WHERE s.quiz_id = q.id) AS session_count
      FROM quizzes q
      WHERE q.owner_id = ?
      ORDER BY q.created_at DESC
    `, [userId]);

    res.json({
      success: true,
      data: quizzes
    });
  } catch (error) {
    console.error('Error fetching quizzes:', error);
    res.status(500).json({
      success: false,
      message: 'Lỗi server khi lấy danh sách quiz'
    });
  }
});

// POST /api/quiz - Tạo quiz mới
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { title, description, isPublic, questions } = req.body;
    const userId = req.user.id;

    // Validate input
    if (!title || !questions || questions.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Tiêu đề và câu hỏi là bắt buộc'
      });
    }

    // Validate questions
    for (let i = 0; i < questions.length; i++) {
      const question = questions[i];
      if (!question.content || !question.choices || question.choices.length !== 4) {
        return res.status(400).json({
          success: false,
          message: `Câu hỏi ${i + 1}: Cần có nội dung và đủ 4 đáp án`
        });
      }

      const correctChoices = question.choices.filter(choice => choice.isCorrect);
      if (correctChoices.length !== 1) {
        return res.status(400).json({
          success: false,
          message: `Câu hỏi ${i + 1}: Cần đúng 1 đáp án đúng`
        });
      }
    }

    // Start transaction
    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
      // Create quiz
      const [quizResult] = await connection.execute(
        'INSERT INTO quizzes (owner_id, title, description, is_public, created_at) VALUES (?, ?, ?, ?, NOW())',
        [userId, title, description, isPublic || false]
      );

      const quizId = quizResult.insertId;

      // Create questions and choices
      for (let i = 0; i < questions.length; i++) {
        const question = questions[i];
        const [questionResult] = await connection.execute(
          'INSERT INTO questions (quiz_id, content, image_url, time_limit_s, points, order_index) VALUES (?, ?, ?, ?, ?, ?)',
          [quizId, question.content, question.imageUrl || null, question.timeLimit || 20, question.points || 1000, i + 1]
        );

        const questionId = questionResult.insertId;

        // Create choices
        for (let j = 0; j < question.choices.length; j++) {
          const choice = question.choices[j];
          await connection.execute(
            'INSERT INTO choices (question_id, content, is_correct, order_index) VALUES (?, ?, ?, ?)',
            [questionId, choice.content, choice.isCorrect ? 1 : 0, j + 1]
          );
        }
      }

      await connection.commit();

      res.status(201).json({
        success: true,
        message: 'Tạo quiz thành công',
        data: {
          quizId,
          title,
          description,
          questionCount: questions.length
        }
      });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('Error creating quiz:', error);
    res.status(500).json({
      success: false,
      message: 'Lỗi server khi tạo quiz'
    });
  }
});

// GET /api/quiz/:id - Lấy chi tiết quiz
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    // Get quiz info
    const [quizzes] = await pool.execute(`
      SELECT 
        q.*,
        u.display_name as creator_name
      FROM quizzes q
      JOIN users u ON q.owner_id = u.id
      WHERE q.id = ? AND (q.owner_id = ? OR q.is_public = 1)
    `, [id, userId]);

    if (quizzes.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Không tìm thấy quiz hoặc bạn không có quyền xem'
      });
    }

    const quiz = quizzes[0];

    // Get questions with choices
    const [questions] = await pool.execute(`
      SELECT 
        q.id,
        q.content,
        q.image_url,
        q.time_limit_s,
        q.points,
        q.order_index,
        q.created_at
      FROM questions q
      WHERE q.quiz_id = ?
      ORDER BY q.order_index ASC
    `, [id]);

    // Get choices for each question
    for (let question of questions) {
      const [choices] = await pool.execute(`
        SELECT 
          c.id,
          c.content,
          c.is_correct,
          c.order_index
        FROM choices c
        WHERE c.question_id = ?
        ORDER BY c.order_index ASC
      `, [question.id]);

      question.choices = choices;
    }

    quiz.questions = questions;

    res.json({
      success: true,
      data: quiz
    });
  } catch (error) {
    console.error('Error fetching quiz details:', error);
    res.status(500).json({
      success: false,
      message: 'Lỗi server khi lấy chi tiết quiz'
    });
  }
});

// PUT /api/quiz/:id - Cập nhật quiz
router.put('/:id', authenticateToken, checkQuizOwnership, async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, isPublic, questions } = req.body;

    // Validate input
    if (!title || !questions || questions.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Tiêu đề và câu hỏi là bắt buộc'
      });
    }

    for (let i = 0; i < questions.length; i++) {
      const question = questions[i];
      if (!question.content || !question.choices || question.choices.length !== 4) {
        return res.status(400).json({ success: false, message: `Câu hỏi ${i + 1}: Cần có nội dung và đủ 4 đáp án` });
      }
      const correctChoices = question.choices.filter(choice => choice.isCorrect);
      if (correctChoices.length !== 1) {
        return res.status(400).json({ success: false, message: `Câu hỏi ${i + 1}: Cần đúng 1 đáp án đúng` });
      }
    }

    // Start transaction
    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
      // Update quiz
      await connection.execute(
        'UPDATE quizzes SET title = ?, description = ?, is_public = ?, updated_at = NOW() WHERE id = ?',
        [title, description, isPublic || false, id]
      );

      // Delete existing questions and choices
      await connection.execute('DELETE FROM choices WHERE question_id IN (SELECT id FROM questions WHERE quiz_id = ?)', [id]);
      await connection.execute('DELETE FROM questions WHERE quiz_id = ?', [id]);

      // Create new questions and choices
      for (let i = 0; i < questions.length; i++) {
        const question = questions[i];
        const [questionResult] = await connection.execute(
          'INSERT INTO questions (quiz_id, content, image_url, time_limit_s, points, order_index) VALUES (?, ?, ?, ?, ?, ?)',
          [id, question.content, question.imageUrl || null, question.timeLimit || 20, question.points || 1000, i + 1]
        );

        const questionId = questionResult.insertId;

        // Create choices
        for (let j = 0; j < question.choices.length; j++) {
          const choice = question.choices[j];
          await connection.execute(
            'INSERT INTO choices (question_id, content, is_correct, order_index) VALUES (?, ?, ?, ?)',
            [questionId, choice.content, choice.isCorrect ? 1 : 0, j + 1]
          );
        }
      }

      await connection.commit();

      res.json({
        success: true,
        message: 'Cập nhật quiz thành công',
        data: {
          quizId: id,
          title,
          description,
          questionCount: questions.length
        }
      });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('Error updating quiz:', error);
    res.status(500).json({ success: false, message: 'Lỗi server khi cập nhật quiz' });
  }
});

// DELETE /api/quiz/:id - Xóa quiz
router.delete('/:id', authenticateToken, checkQuizOwnership, async (req, res) => {
  try {
    const { id } = req.params;

    // Check if quiz has active sessions
    const [activeSessions] = await pool.execute(
      'SELECT id FROM quiz_sessions WHERE quiz_id = ? AND status IN ("active", "playing", "waiting", "in_progress")',
      [id]
    );

    if (activeSessions.length > 0) {
      return res.status(400).json({ success: false, message: 'Không thể xóa quiz đang có game session hoạt động' });
    }

    // Start transaction
    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
      await connection.execute('DELETE FROM choices WHERE question_id IN (SELECT id FROM questions WHERE quiz_id = ?)', [id]);
      await connection.execute('DELETE FROM questions WHERE quiz_id = ?', [id]);
      await connection.execute('DELETE FROM quizzes WHERE id = ?', [id]);
      await connection.commit();
      res.json({ success: true, message: 'Xóa quiz thành công' });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('Error deleting quiz:', error);
    res.status(500).json({ success: false, message: 'Lỗi server khi xóa quiz' });
  }
});

// GET /api/quiz/public - Lấy danh sách quiz public
router.get('/public/list', async (req, res) => {
  try {
    const [quizzes] = await pool.execute(`
      SELECT 
        q.id,
        q.title,
        q.description,
        q.created_at,
        u.display_name as creator_name,
        (SELECT COUNT(*) FROM questions qq WHERE qq.quiz_id = q.id) AS question_count,
        (SELECT COUNT(*) FROM quiz_sessions s WHERE s.quiz_id = q.id) AS session_count
      FROM quizzes q
      JOIN users u ON q.owner_id = u.id
      WHERE q.is_public = 1
      ORDER BY q.created_at DESC
      LIMIT 20
    `);

    res.json({ success: true, data: quizzes });
  } catch (error) {
    console.error('Error fetching public quizzes:', error);
    res.status(500).json({ success: false, message: 'Lỗi server khi lấy danh sách quiz public' });
  }
});

// GET /api/quiz/:id/statistics - Lấy thống kê quiz
router.get('/:id/statistics', authenticateToken, checkQuizOwnership, async (req, res) => {
  try {
    const { id } = req.params;

    const [stats] = await pool.execute(`
      SELECT 
        (SELECT COUNT(*) FROM quiz_sessions s WHERE s.quiz_id = q.id) as total_sessions,
        (SELECT COUNT(*) FROM player_sessions ps WHERE ps.session_id IN (SELECT id FROM quiz_sessions s2 WHERE s2.quiz_id = q.id)) as total_players,
        (SELECT COUNT(*) FROM player_answers pa WHERE pa.session_id IN (SELECT id FROM quiz_sessions s3 WHERE s3.quiz_id = q.id)) as total_answers
      FROM quizzes q
      WHERE q.id = ?
    `, [id]);

    const [questionStats] = await pool.execute(`
      SELECT 
        q.content,
        (SELECT COUNT(*) FROM player_answers pa WHERE pa.question_id = q.id) as answer_count,
        (SELECT SUM(CASE WHEN pa2.is_correct = 1 THEN 1 ELSE 0 END) FROM player_answers pa2 WHERE pa2.question_id = q.id) as correct_count,
        (SELECT AVG(pa3.time_ms) FROM player_answers pa3 WHERE pa3.question_id = q.id) as avg_time_ms
      FROM questions q
      WHERE q.quiz_id = ?
      ORDER BY q.order_index ASC
    `, [id]);

    res.json({ success: true, data: { quizStats: stats[0], questionStats } });
  } catch (error) {
    console.error('Error fetching quiz statistics:', error);
    res.status(500).json({ success: false, message: 'Lỗi server khi lấy thống kê quiz' });
  }
});

module.exports = router;
