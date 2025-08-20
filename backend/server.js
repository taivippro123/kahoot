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
	}
});

app.use(helmet());
app.use(cors({
	origin: process.env.CORS_ORIGIN || "http://localhost:5173",
	credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/quiz', require('./routes/quiz'));
app.use('/api/game', require('./routes/game'));

app.get('/health', (req, res) => {
	res.json({ 
		status: 'OK', 
		timestamp: new Date().toISOString(),
		uptime: process.uptime()
	});
});

// sessionId -> { players: Map<playerId, {socketId, nickname, joinedAt}>, host: socketId, status }
const gameSessions = new Map();

const { pool } = require('./db');

function mapQuestionRow(row, choices) {
	return {
		id: row.id,
		content: row.content,
		image_url: row.image_url,
		time_limit_s: row.time_limit_s,
		points: row.points,
		order_index: row.order_index,
		choices: choices
	};
}

async function fetchQuestionWithChoicesByOrder(quizId, orderIndex) {
	const [qRows] = await pool.execute('SELECT * FROM questions WHERE quiz_id = ? AND order_index = ? LIMIT 1', [quizId, orderIndex]);
	if (qRows.length === 0) return null;
	const q = qRows[0];
	const [cRows] = await pool.execute('SELECT id, content, is_correct FROM choices WHERE question_id = ? ORDER BY order_index', [q.id]);
	return mapQuestionRow(q, cRows);
}

async function emitQuestion(io, roomOrSocketId, quizId, orderIndex, toRoom = true) {
	const question = await fetchQuestionWithChoicesByOrder(quizId, orderIndex);
	if (!question) return false;
	const [[{ cnt }]] = await pool.execute('SELECT COUNT(*) as cnt FROM questions WHERE quiz_id = ?', [quizId]);
	const target = toRoom ? io.to(roomOrSocketId) : io.to(roomOrSocketId);
	target.emit('question_displayed', { question, totalQuestions: cnt, orderIndex });
	return true;
}

io.on('connection', (socket) => {
	console.log('User connected:', socket.id);

	// Join session (host or player)
	socket.on('join_session', async (data) => {
		const { sessionId, playerId, nickname, isHost } = data || {};
		if (!sessionId) {
			socket.emit('app_error', { message: 'Thiếu sessionId' });
			return;
		}

		if (!gameSessions.has(sessionId)) {
			gameSessions.set(sessionId, { players: new Map(), host: null, status: 'waiting' });
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
			session.players.set(playerId, { socketId: socket.id, nickname, joinedAt: new Date() });
			socket.playerId = playerId;
			socket.nickname = nickname;

			// Notify others and broadcast latest list
			socket.to(sessionId).emit('player_joined', { playerId, nickname, joinedAt: new Date() });
			const playersListAll = Array.from(session.players.entries()).map(([id, p]) => ({ playerId: id, nickname: p.nickname, joinedAt: p.joinedAt }));
			io.to(sessionId).emit('session_players', playersListAll);

			// Nếu host đang online trong phòng, gửi riêng đảm bảo host nhận được
			if (session.host) {
				io.to(session.host).emit('session_players', playersListAll);
			}
		}

		// Send current players list to this socket (redundant but safe)
		const playersList = Array.from(session.players.entries()).map(([id, p]) => ({
			playerId: id,
			nickname: p.nickname,
			joinedAt: p.joinedAt
		}));
		socket.emit('session_players', playersList);

		// If a question is already active for this session, send it to the newly joined socket
		if (session.currentOrder && !session.questionClosed) {
			const [[row]] = await pool.execute('SELECT quiz_id FROM quiz_sessions WHERE id = ?', [sessionId]);
			if (row) {
				await emitQuestion(io, socket.id, row.quiz_id, session.currentOrder, false);
			}
		}
	});

	// Client asks for the current active question explicitly (fallback)
	socket.on('request_current', async ({ sessionId }) => {
		const session = gameSessions.get(sessionId);
		if (!session || !session.currentOrder || session.questionClosed) return;
		const [[row]] = await pool.execute('SELECT quiz_id FROM quiz_sessions WHERE id = ?', [sessionId]);
		if (!row) return;
		await emitQuestion(io, socket.id, row.quiz_id, session.currentOrder, false);
	});

	// Client asks for progress (how many questions and current order)
	socket.on('request_progress', async ({ sessionId }) => {
		const session = gameSessions.get(sessionId);
		if (!session) return;
		const [[row]] = await pool.execute('SELECT quiz_id FROM quiz_sessions WHERE id = ?', [sessionId]);
		if (!row) return;
		const [[{ cnt }]] = await pool.execute('SELECT COUNT(*) as cnt FROM questions WHERE quiz_id = ?', [row.quiz_id]);
		io.to(socket.id).emit('question_progress', { currentOrder: session.currentOrder || 0, totalQuestions: cnt, questionClosed: !!session.questionClosed });
	});

	// Start game (host only)
	socket.on('start_game', async ({ sessionId }) => {
		const session = gameSessions.get(sessionId);
		if (!session || session.host !== socket.id) return;

		await pool.execute('UPDATE quiz_sessions SET status = "in_progress", started_at = NOW() WHERE id = ?', [sessionId]);
		const [[row]] = await pool.execute('SELECT quiz_id FROM quiz_sessions WHERE id = ?', [sessionId]);
		if (!row) return;
		session.currentOrder = 1;
		session.answerSet = new Set();
		session.questionClosed = false;

		// First notify clients to navigate
		io.to(sessionId).emit('game_started', { sessionId });
		// Then emit the question shortly after to ensure listeners are ready
		setTimeout(async () => {
			await emitQuestion(io, sessionId, row.quiz_id, session.currentOrder, true);
		}, 250);
	});

	// Next question (host only)
	socket.on('next_question', async ({ sessionId }) => {
		const session = gameSessions.get(sessionId);
		if (!session || session.host !== socket.id) return;
		const [[row]] = await pool.execute('SELECT quiz_id FROM quiz_sessions WHERE id = ?', [sessionId]);
		if (!row) return;
		session.currentOrder = (session.currentOrder || 1) + 1;
		session.answerSet = new Set();
		session.questionClosed = false;
		const ok = await emitQuestion(io, sessionId, row.quiz_id, session.currentOrder, true);
		if (!ok) {
			// No more questions: end only now
			io.to(sessionId).emit('game_ended', { sessionId });
			await pool.execute('UPDATE quiz_sessions SET status = "ended", ended_at = NOW() WHERE id = ?', [sessionId]);
		}
	});

	// Submit answer
	socket.on('submit_answer', async (data) => {
		const { sessionId, questionId, choiceId, timeMs } = data;
		const session = gameSessions.get(sessionId);
		
		if (session) {
			// record that this player has answered
			if (!session.answerSet) session.answerSet = new Set();
			session.answerSet.add(socket.playerId);
			// Notify other players about the answer
			socket.to(sessionId).emit('player_answered', {
				playerId: socket.playerId,
				questionId,
				choiceId,
				timeMs
			});
			// Auto close if all current players answered and not closed yet
			if (!session.questionClosed && session.players && session.answerSet.size >= session.players.size) {
				session.questionClosed = true;
				io.to(sessionId).emit('question_closed', { sessionId });
				const [[row]] = await pool.execute('SELECT quiz_id FROM quiz_sessions WHERE id = ?', [sessionId]);
				if (row) {
					const [[{ cnt }]] = await pool.execute('SELECT COUNT(*) as cnt FROM questions WHERE quiz_id = ?', [row.quiz_id]);
					io.to(sessionId).emit('question_progress', { currentOrder: session.currentOrder || 0, totalQuestions: cnt, questionClosed: true });
				}
			}
		}
	});

	// Close current question (host only)
	socket.on('close_question', async ({ sessionId }) => {
		const session = gameSessions.get(sessionId);
		if (!session || session.host !== socket.id) return;
		if (session.questionClosed) return;
		session.questionClosed = true;
		io.to(sessionId).emit('question_closed', { sessionId });
		const [[row]] = await pool.execute('SELECT quiz_id FROM quiz_sessions WHERE id = ?', [sessionId]);
		if (row) {
			const [[{ cnt }]] = await pool.execute('SELECT COUNT(*) as cnt FROM questions WHERE quiz_id = ?', [row.quiz_id]);
			io.to(sessionId).emit('question_progress', { currentOrder: session.currentOrder || 0, totalQuestions: cnt, questionClosed: true });
		}
	});

	// Host kicks a player
	socket.on('kick_player', ({ sessionId, playerId }) => {
		const session = gameSessions.get(sessionId);
		if (!session || session.host !== socket.id) return;
		const player = session.players.get(playerId);
		if (!player) return;
		io.to(player.socketId).emit('player_kicked', { message: 'Bạn đã bị kick khỏi game' });
		session.players.delete(playerId);
		io.to(sessionId).emit('player_left', { playerId, nickname: player.nickname });
		const playersList = Array.from(session.players.entries()).map(([id, p]) => ({ playerId: id, nickname: p.nickname, joinedAt: p.joinedAt }));
		io.to(sessionId).emit('session_players', playersList);
	});

	// Player leaves session
	socket.on('leave_session', ({ sessionId, playerId }) => {
		const session = gameSessions.get(sessionId);
		if (!session) return;
		const player = session.players.get(playerId);
		if (player) {
			session.players.delete(playerId);
			socket.leave(sessionId);
			io.to(sessionId).emit('player_left', { playerId, nickname: player.nickname });
			const playersList = Array.from(session.players.entries()).map(([id, p]) => ({ playerId: id, nickname: p.nickname, joinedAt: p.joinedAt }));
			io.to(sessionId).emit('session_players', playersList);
			if (session.players.size === 0) gameSessions.delete(sessionId);
		}
	});

	socket.on('disconnect', () => {
		const { sessionId } = socket;
		if (!sessionId) return;
		const session = gameSessions.get(sessionId);
		if (!session) return;

		// If host disconnects, just clear host flag
		if (socket.isHost && session.host === socket.id) {
			session.host = null;
			return;
		}

		// Remove player by socketId
		for (const [id, p] of session.players.entries()) {
			if (p.socketId === socket.id) {
				session.players.delete(id);
				io.to(sessionId).emit('player_left', { playerId: id, nickname: p.nickname });
				const playersList = Array.from(session.players.entries()).map(([pid, pl]) => ({ playerId: pid, nickname: pl.nickname, joinedAt: pl.joinedAt }));
				io.to(sessionId).emit('session_players', playersList);
				break;
			}
		}
		if (session.players.size === 0 && !session.host) gameSessions.delete(sessionId);
	});
});

app.use((err, req, res, next) => {
	console.error('Error:', err);
	res.status(500).json({ success: false, message: 'Lỗi server nội bộ' });
});

app.use('*', (req, res) => {
	res.status(404).json({ success: false, message: 'API endpoint không tồn tại' });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
	console.log(`🚀 Server đang chạy tại port ${PORT}`);
	console.log(`📱 Frontend: ${process.env.CORS_ORIGIN || 'http://localhost:5173'}`);
	console.log(`🗄️  Database: ${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`);
	console.log(`🔧 Environment: ${process.env.NODE_ENV || 'development'}`);
});

process.on('SIGTERM', () => {
	console.log('SIGTERM received, shutting down gracefully');
	server.close(() => {
		console.log('Process terminated');
		process.exit(0);
	});
});

process.on('SIGINT', () => {
	console.log('SIGINT received, shutting down gracefully');
	server.close(() => {
		console.log('Process terminated');
		process.exit(0);
	});
});
