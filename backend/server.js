const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
	cors: {
		origin: process.env.CORS_ORIGIN || "http://localhost:5173",
		methods: ["GET", "POST"]
	},
	compression: true,
	maxHttpBufferSize: 1e6, // 1MB limit
	pingTimeout: 60000,
	pingInterval: 25000
});

// Middleware
app.use(helmet());
app.use(cors({
	origin: process.env.CORS_ORIGIN || "http://localhost:5173",
	credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/quiz', require('./routes/quiz'));
app.use('/api/game', require('./routes/game'));

// Health check
app.get('/health', (req, res) => {
	res.json({ 
		status: 'OK', 
		timestamp: new Date().toISOString(),
		uptime: process.uptime(),
		activeSessions: gameSessions.size,
		activeConnections: io.engine.clientsCount
	});
});

// Game session management với cache state tối ưu
const gameSessions = new Map();
const { pool } = require('./db');

// Game state cache để tối ưu performance
const gameStateCache = new Map();

// Utility functions
const GameUtils = {
	// Map database row to question object
	mapQuestionRow(row, choices) {
		return {
			id: row.id,
			content: row.content,
			image_url: row.image_url,
			time_limit_s: row.time_limit_s,
			points: row.points,
			order_index: row.order_index,
			choices: choices.map(c => ({
				id: c.id,
				content: c.content,
				is_correct: c.is_correct
			}))
		};
	},

	// Fetch question with choices by order index
	async fetchQuestionWithChoicesByOrder(quizId, orderIndex) {
		try {
			const [qRows] = await pool.execute(
				'SELECT * FROM questions WHERE quiz_id = ? AND order_index = ? LIMIT 1', 
				[quizId, orderIndex]
			);
			if (qRows.length === 0) return null;
			
			const q = qRows[0];
			const [cRows] = await pool.execute(
				'SELECT id, content, is_correct FROM choices WHERE question_id = ? ORDER BY order_index', 
				[q.id]
			);
			
			return this.mapQuestionRow(q, cRows);
		} catch (error) {
			console.error('Error fetching question:', error);
			return null;
		}
	},

	// Emit question to room or specific socket
	async emitQuestion(io, target, quizId, orderIndex, toRoom = true) {
		try {
			const question = await this.fetchQuestionWithChoicesByOrder(quizId, orderIndex);
			if (!question) return false;
			
			const [[{ cnt }]] = await pool.execute(
				'SELECT COUNT(*) as cnt FROM questions WHERE quiz_id = ?', 
				[quizId]
			);
			
			const payload = { 
				question, 
				totalQuestions: cnt, 
				orderIndex,
				timestamp: Date.now()
			};
			
			if (toRoom) {
				io.to(target).emit('question_displayed', payload);
			} else {
				io.to(target).emit('question_displayed', payload);
			}
			
			return true;
		} catch (error) {
			console.error('Error emitting question:', error);
			return false;
		}
	},

	// Get players list for session
	getPlayersList(session) {
		return Array.from(session.players.entries()).map(([id, p]) => ({
			playerId: id,
			nickname: p.nickname,
			joinedAt: p.joinedAt
		}));
	},

	// Broadcast players list to room
	broadcastPlayersList(io, sessionId, session) {
		const playersList = this.getPlayersList(session);
		io.to(sessionId).emit('session_players', playersList);
		
		// Ensure host gets the update
		if (session.host) {
			io.to(session.host).emit('session_players', playersList);
		}
	},

	// Clean up inactive sessions
	cleanupInactiveSessions() {
		const now = Date.now();
		for (const [sessionId, session] of gameSessions.entries()) {
			// Remove players inactive for more than 5 minutes
			for (const [playerId, player] of session.players.entries()) {
				if (now - player.joinedAt.getTime() > 300000) { // 5 minutes
					session.players.delete(playerId);
				}
			}
			
			// Remove empty sessions
			if (session.players.size === 0 && !session.host) {
				gameSessions.delete(sessionId);
				gameStateCache.delete(sessionId); // Clean up cache
			}
		}
	},

	// Tối ưu: Lưu answer vào cache thay vì DB ngay lập tức
	saveAnswerToCache(sessionId, playerId, questionId, choiceId, timeMs) {
		if (!gameStateCache.has(sessionId)) {
			gameStateCache.set(sessionId, {
				answers: [],
				scores: new Map(),
				lastUpdate: Date.now()
			});
		}
		
		const state = gameStateCache.get(sessionId);
		state.answers.push({
			playerId,
			questionId,
			choiceId,
			timeMs,
			timestamp: Date.now()
		});
		state.lastUpdate = Date.now();
	},

	// Tối ưu: Ghi DB async không block socket
	async saveAnswerToDB(answer) {
		setImmediate(async () => {
			try {
				await pool.execute(
					'INSERT INTO player_answers (session_id, player_id, question_id, choice_id, time_ms, is_correct, score_earned) VALUES (?, ?, ?, ?, ?, ?, ?)',
					[answer.sessionId, answer.playerId, answer.questionId, answer.choiceId, answer.timeMs, answer.isCorrect ? 1 : 0, answer.score]
				);
			} catch (error) {
				console.error('Error saving answer to DB:', error);
			}
		});
	},

	// Tối ưu: Batch save answers khi kết thúc round
	async batchSaveAnswers(sessionId) {
		try {
			const state = gameStateCache.get(sessionId);
			if (!state || state.answers.length === 0) return;

			// Lấy thông tin câu hỏi và tính điểm
			const answersToSave = [];
			for (const answer of state.answers) {
				const [[questionRow]] = await pool.execute(
					'SELECT q.points, c.is_correct FROM questions q JOIN choices c ON q.id = c.question_id WHERE q.id = ? AND c.id = ?',
					[answer.questionId, answer.choiceId]
				);
				
				if (questionRow) {
					const isCorrect = questionRow.is_correct === 1;
					let score = 0;
					if (isCorrect) {
						const maxTime = 20000; // 20 seconds default
						const timeBonus = Math.max(0, (maxTime - answer.timeMs) / maxTime);
						score = Math.round((questionRow.points || 1000) * (0.5 + 0.5 * timeBonus));
					}
					
					answersToSave.push({
						...answer,
						isCorrect,
						score
					});
				}
			}

			// Batch insert
			if (answersToSave.length > 0) {
				const values = answersToSave.map(() => '(?, ?, ?, ?, ?, ?, ?)').join(',');
				const params = answersToSave.flatMap(a => [
					sessionId, a.playerId, a.questionId, a.choiceId, a.timeMs, a.isCorrect ? 1 : 0, a.score
				]);
				
				await pool.execute(
					`INSERT INTO player_answers (session_id, player_id, question_id, choice_id, time_ms, is_correct, score_earned) VALUES ${values}`,
					params
				);
			}

			// Clear cache sau khi save
			state.answers = [];
			state.lastUpdate = Date.now();
			
		} catch (error) {
			console.error('Error batch saving answers:', error);
		}
	}
};

// Socket connection handler
io.on('connection', (socket) => {
	console.log('User connected:', socket.id);
	
	// Rate limiting for socket events
	const rateLimit = new Map();
	const checkRateLimit = (eventName, limit = 100) => {
		const now = Date.now();
		const key = `${socket.id}:${eventName}`;
		const lastEmit = rateLimit.get(key) || 0;
		
		if (now - lastEmit < limit) {
			return false;
		}
		rateLimit.set(key, now);
		return true;
	};

	// Join session (host or player)
	socket.on('join_session', async (data) => {
		try {
			const { sessionId, playerId, nickname, isHost } = data || {};
			if (!sessionId) {
				socket.emit('app_error', { message: 'Thiếu sessionId' });
				return;
			}

			// Initialize session if not exists
			if (!gameSessions.has(sessionId)) {
				gameSessions.set(sessionId, { 
					players: new Map(), 
					host: null, 
					status: 'waiting',
					createdAt: Date.now()
				});
			}
			const session = gameSessions.get(sessionId);

			// Join socket room
			socket.join(sessionId);
			socket.sessionId = sessionId;

			if (isHost) {
				// Mark this socket as host
				session.host = socket.id;
				socket.isHost = true;
				io.to(sessionId).emit('host_joined', {});
				console.log(`Host joined session ${sessionId}`);
			} else {
				if (!playerId || !nickname) {
					socket.emit('app_error', { message: 'Thiếu playerId hoặc nickname' });
					return;
				}
				
				// Track player
				session.players.set(playerId, { 
					socketId: socket.id, 
					nickname, 
					joinedAt: new Date(),
					lastActivity: Date.now()
				});
				socket.playerId = playerId;
				socket.nickname = nickname;

				// Notify others and broadcast latest list
				socket.to(sessionId).emit('player_joined', { 
					playerId, 
					nickname, 
					joinedAt: new Date() 
				});
				GameUtils.broadcastPlayersList(io, sessionId, session);
			}

			// Send current players list to this socket
			const playersList = GameUtils.getPlayersList(session);
			socket.emit('session_players', playersList);

			// If a question is already active, send it to the newly joined socket
			if (session.currentOrder && !session.questionClosed) {
				const [[row]] = await pool.execute(
					'SELECT quiz_id FROM quiz_sessions WHERE id = ?', 
					[sessionId]
				);
				if (row) {
					await GameUtils.emitQuestion(io, socket.id, row.quiz_id, session.currentOrder, false);
				}
			}
		} catch (error) {
			console.error('Error in join_session:', error);
			socket.emit('app_error', { message: 'Lỗi khi tham gia session' });
		}
	});

	// Request current question (fallback)
	socket.on('request_current', async ({ sessionId }) => {
		if (!checkRateLimit('request_current', 1000)) return; // 1 request per second
		
		try {
			const session = gameSessions.get(sessionId);
			if (!session || !session.currentOrder || session.questionClosed) return;
			
			const [[row]] = await pool.execute(
				'SELECT quiz_id FROM quiz_sessions WHERE id = ?', 
				[sessionId]
			);
			if (!row) return;
			
			await GameUtils.emitQuestion(io, socket.id, row.quiz_id, session.currentOrder, false);
		} catch (error) {
			console.error('Error in request_current:', error);
		}
	});

	// Request game progress
	socket.on('request_progress', async ({ sessionId }) => {
		if (!checkRateLimit('request_progress', 1000)) return;
		
		try {
			const session = gameSessions.get(sessionId);
			if (!session) return;
			
			const [[row]] = await pool.execute(
				'SELECT quiz_id FROM quiz_sessions WHERE id = ?', 
				[sessionId]
			);
			if (!row) return;
			
			const [[{ cnt }]] = await pool.execute(
				'SELECT COUNT(*) as cnt FROM questions WHERE quiz_id = ?', 
				[row.quiz_id]
			);
			
			io.to(socket.id).emit('question_progress', { 
				currentOrder: session.currentOrder || 0, 
				totalQuestions: cnt, 
				questionClosed: !!session.questionClosed 
			});
		} catch (error) {
			console.error('Error in request_progress:', error);
		}
	});

	// Start game (host only)
	socket.on('start_game', async ({ sessionId }) => {
		try {
			const session = gameSessions.get(sessionId);
			if (!session || session.host !== socket.id) return;

			// Update database
			await pool.execute(
				'UPDATE quiz_sessions SET status = "in_progress", started_at = NOW() WHERE id = ?', 
				[sessionId]
			);
			
			const [[row]] = await pool.execute(
				'SELECT quiz_id FROM quiz_sessions WHERE id = ?', 
				[sessionId]
			);
			if (!row) return;
			
			// Initialize session state
			session.currentOrder = 1;
			session.answerSet = new Set();
			session.questionClosed = false;
			session.status = 'in_progress';

			// Notify clients to navigate first
			io.to(sessionId).emit('game_started', { sessionId });
			
			// Emit question after short delay to ensure listeners are ready
			setTimeout(async () => {
				await GameUtils.emitQuestion(io, sessionId, row.quiz_id, session.currentOrder, true);
			}, 250);
		} catch (error) {
			console.error('Error in start_game:', error);
			socket.emit('app_error', { message: 'Lỗi khi bắt đầu game' });
		}
	});

	// Next question (host only) - Tối ưu với batch save
	socket.on('next_question', async ({ sessionId }) => {
		try {
			const session = gameSessions.get(sessionId);
			if (!session || session.host !== socket.id) return;
			
			// Tối ưu: Batch save answers trước khi chuyển câu hỏi
			await GameUtils.batchSaveAnswers(sessionId);
			
			const [[row]] = await pool.execute(
				'SELECT quiz_id FROM quiz_sessions WHERE id = ?', 
				[sessionId]
			);
			if (!row) return;
			
			// Move to next question
			session.currentOrder = (session.currentOrder || 1) + 1;
			session.answerSet = new Set();
			session.questionClosed = false;
			
			const ok = await GameUtils.emitQuestion(io, sessionId, row.quiz_id, session.currentOrder, true);
			if (!ok) {
				// No more questions: end game
				io.to(sessionId).emit('game_ended', { sessionId });
				await pool.execute(
					'UPDATE quiz_sessions SET status = "ended", ended_at = NOW() WHERE id = ?', 
					[sessionId]
				);
				session.status = 'ended';
			}
		} catch (error) {
			console.error('Error in next_question:', error);
			socket.emit('app_error', { message: 'Lỗi khi chuyển câu hỏi' });
		}
	});

	// Submit answer - TỐI ƯU: Emit ngay lập tức, ghi DB async
	socket.on('submit_answer', async (data) => {
		if (!checkRateLimit('submit_answer', 500)) return; // 2 answers per second max
		
		try {
			const { sessionId, questionId, choiceId, timeMs } = data;
			const session = gameSessions.get(sessionId);
			
			if (session && socket.playerId) {
				// Tối ưu: Emit ngay lập tức để player thấy phản hồi
				io.to(sessionId).emit('player_answered', {
					playerId: socket.playerId,
					questionId,
					choiceId,
					timeMs
				});
				
				// Record that this player has answered
				if (!session.answerSet) session.answerSet = new Set();
				session.answerSet.add(socket.playerId);
				
				// Update player's last activity
				const player = session.players.get(socket.playerId);
				if (player) {
					player.lastActivity = Date.now();
				}
				
				// Tối ưu: Lưu vào cache thay vì DB ngay
				GameUtils.saveAnswerToCache(sessionId, socket.playerId, questionId, choiceId, timeMs);
				
				// Auto close if all current players answered and not closed yet
				if (!session.questionClosed && session.players && session.answerSet.size >= session.players.size) {
					session.questionClosed = true;
					io.to(sessionId).emit('question_closed', { sessionId });
					
					// Send progress update
					const [[row]] = await pool.execute(
						'SELECT quiz_id FROM quiz_sessions WHERE id = ?', 
						[sessionId]
					);
					if (row) {
						const [[{ cnt }]] = await pool.execute(
							'SELECT COUNT(*) as cnt FROM questions WHERE quiz_id = ?', 
							[row.quiz_id]
						);
						io.to(sessionId).emit('question_progress', { 
							currentOrder: session.currentOrder || 0, 
							totalQuestions: cnt, 
							questionClosed: true 
						});
					}
				}
			}
		} catch (error) {
			console.error('Error in submit_answer:', error);
		}
	});

	// Close current question (host only) - Tối ưu với batch save
	socket.on('close_question', async ({ sessionId }) => {
		try {
			const session = gameSessions.get(sessionId);
			if (!session || session.host !== socket.id || session.questionClosed) return;
			
			// Tối ưu: Batch save answers khi đóng câu hỏi
			await GameUtils.batchSaveAnswers(sessionId);
			
			session.questionClosed = true;
			io.to(sessionId).emit('question_closed', { sessionId });
			
			// Send progress update
			const [[row]] = await pool.execute(
				'SELECT quiz_id FROM quiz_sessions WHERE id = ?', 
				[sessionId]
			);
			if (row) {
				const [[{ cnt }]] = await pool.execute(
					'SELECT COUNT(*) as cnt FROM questions WHERE quiz_id = ?', 
					[row.quiz_id]
				);
				io.to(sessionId).emit('question_progress', { 
					currentOrder: session.currentOrder || 0, 
					totalQuestions: cnt, 
					questionClosed: true 
				});
			}
		} catch (error) {
			console.error('Error in close_question:', error);
		}
	});

	// Kick player (host only)
	socket.on('kick_player', ({ sessionId, playerId }) => {
		try {
			const session = gameSessions.get(sessionId);
			if (!session || session.host !== socket.id) return;
			
			const player = session.players.get(playerId);
			if (!player) return;
			
			io.to(player.socketId).emit('player_kicked', { 
				message: 'Bạn đã bị kick khỏi game' 
			});
			session.players.delete(playerId);
			
			io.to(sessionId).emit('player_left', { 
				playerId, 
				nickname: player.nickname 
			});
			
			GameUtils.broadcastPlayersList(io, sessionId, session);
		} catch (error) {
			console.error('Error in kick_player:', error);
		}
	});

	// Leave session
	socket.on('leave_session', ({ sessionId, playerId }) => {
		try {
			const session = gameSessions.get(sessionId);
			if (!session) return;
			
			const player = session.players.get(playerId);
			if (player) {
				session.players.delete(playerId);
				socket.leave(sessionId);
				
				io.to(sessionId).emit('player_left', { 
					playerId, 
					nickname: player.nickname 
				});
				
				GameUtils.broadcastPlayersList(io, sessionId, session);
				
				// Clean up empty sessions
				if (session.players.size === 0 && !session.host) {
					gameSessions.delete(sessionId);
					gameStateCache.delete(sessionId); // Clean up cache
				}
			}
		} catch (error) {
			console.error('Error in leave_session:', error);
		}
	});

	// Disconnect handler
	socket.on('disconnect', () => {
		try {
			const { sessionId } = socket;
			if (!sessionId) return;
			
			const session = gameSessions.get(sessionId);
			if (!session) return;

			// If host disconnects, clear host flag
			if (socket.isHost && session.host === socket.id) {
				session.host = null;
				console.log(`Host disconnected from session ${sessionId}`);
				return;
			}

			// Remove player by socketId
			for (const [id, p] of session.players.entries()) {
				if (p.socketId === socket.id) {
					session.players.delete(id);
					io.to(sessionId).emit('player_left', { 
						playerId: id, 
						nickname: p.nickname 
					});
					
					const playersList = GameUtils.getPlayersList(session);
					io.to(sessionId).emit('session_players', playersList);
					break;
				}
			}
			
			// Clean up empty sessions
			if (session.players.size === 0 && !session.host) {
				gameSessions.delete(sessionId);
				gameStateCache.delete(sessionId); // Clean up cache
			}
			
			console.log(`User disconnected: ${socket.id}`);
		} catch (error) {
			console.error('Error in disconnect:', error);
		}
	});
});

// Cleanup inactive sessions every 5 minutes
setInterval(() => {
	GameUtils.cleanupInactiveSessions();
}, 300000);

// Error handling middleware
app.use((err, req, res, next) => {
	console.error('Error:', err);
	res.status(500).json({ 
		success: false, 
		message: 'Lỗi server nội bộ',
		timestamp: new Date().toISOString()
	});
});

// 404 handler
app.use('*', (req, res) => {
	res.status(404).json({ 
		success: false, 
		message: 'API endpoint không tồn tại',
		path: req.originalUrl,
		timestamp: new Date().toISOString()
	});
});

// Start server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
	console.log(`🚀 Server đang chạy tại port ${PORT}`);
	console.log(`📱 Frontend: ${process.env.CORS_ORIGIN || 'http://localhost:5173'}`);
	console.log(`🗄️  Database: ${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`);
	console.log(`🔧 Environment: ${process.env.NODE_ENV || 'development'}`);
	console.log(`⚡ Socket.io compression: enabled`);
	console.log(`🔄 Cleanup interval: 5 minutes`);
	console.log(`🚀 Realtime optimization: enabled (cache + async DB)`);
});

// Graceful shutdown
const gracefulShutdown = (signal) => {
	console.log(`${signal} received, shutting down gracefully`);
	
	// Tối ưu: Batch save tất cả answers còn lại trước khi shutdown
	const savePromises = [];
	for (const [sessionId] of gameStateCache) {
		savePromises.push(GameUtils.batchSaveAnswers(sessionId));
	}
	
	Promise.all(savePromises).then(() => {
		server.close(() => {
			console.log('HTTP server closed');
			
			// Close database connections
			pool.end((err) => {
				if (err) {
					console.error('Error closing database pool:', err);
				} else {
					console.log('Database connections closed');
				}
				
				// Close socket.io
				io.close(() => {
					console.log('Socket.io server closed');
					process.exit(0);
				});
			});
		});
	}).catch(err => {
		console.error('Error saving final answers:', err);
		process.exit(1);
	});
	
	// Force exit after 10 seconds
	setTimeout(() => {
		console.error('Could not close connections in time, forcefully shutting down');
		process.exit(1);
	}, 10000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
	console.error('Uncaught Exception:', err);
	gracefulShutdown('UNCAUGHT_EXCEPTION');
});

process.on('unhandledRejection', (reason, promise) => {
	console.error('Unhandled Rejection at:', promise, 'reason:', reason);
	gracefulShutdown('UNHANDLED_REJECTION');
});
