# Kahoot Clone Backend

Backend cho ứng dụng clone Kahoot với hỗ trợ real-time multiplayer sử dụng Socket.io.

## Tính năng

- ✅ Đăng ký/Đăng nhập tài khoản
- ✅ Tạo và quản lý quiz
- ✅ Hỗ trợ câu hỏi trắc nghiệm 4 đáp án
- ✅ Game session với PIN code
- ✅ Real-time multiplayer (40+ người chơi)
- ✅ Hệ thống điểm và xếp hạng
- ✅ Socket.io cho real-time communication

## Cài đặt

### Yêu cầu hệ thống
- Node.js 16+
- MySQL 8.0+ (XAMPP)
- npm hoặc yarn

### Bước 1: Clone repository
```bash
git clone <repository-url>
cd kahoot/backend
```

### Bước 2: Cài đặt dependencies
```bash
npm install
```

### Bước 3: Cấu hình database
1. Khởi động XAMPP và start MySQL service
2. Tạo database `kahoot_clone` trong phpMyAdmin (hoặc import SQL schema đã có)
3. Cập nhật file `.env`:
```env
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=
DB_NAME=kahoot_clone
DB_PORT=3306
JWT_SECRET=your-secret-key-here
```

### Bước 4: Khởi động server
```bash
# Development mode
npm run dev

# Production mode
npm start
```

Server sẽ chạy tại `http://localhost:5000`

## API Endpoints

### Authentication
- `POST /api/auth/register` - Đăng ký tài khoản
- `POST /api/auth/login` - Đăng nhập
- `GET /api/auth/me` - Lấy thông tin user
- `PUT /api/auth/profile` - Cập nhật profile

### Quiz Management
- `GET /api/quiz` - Lấy danh sách quiz của user
- `POST /api/quiz` - Tạo quiz mới
- `GET /api/quiz/:id` - Lấy chi tiết quiz

### Game Session
- `POST /api/game/session` - Tạo game session
- `GET /api/game/session/:pinCode` - Lấy thông tin session
- `POST /api/game/join` - Người chơi tham gia session

## Socket.io Events

### Client -> Server
- `join_session` - Tham gia session
- `start_game` - Bắt đầu game (host)
- `show_question` - Hiển thị câu hỏi (host)
- `submit_answer` - Trả lời câu hỏi (player)

### Server -> Client
- `player_joined` - Người chơi mới tham gia
- `player_left` - Người chơi rời khỏi
- `game_started` - Game bắt đầu
- `question_displayed` - Hiển thị câu hỏi
- `answer_submitted` - Xác nhận trả lời

## Cấu trúc Database

Database được tự động tạo với các bảng:
- `users` - Thông tin người dùng
- `quizzes` - Quiz
- `questions` - Câu hỏi
- `choices` - Đáp án
- `quiz_sessions` - Phiên chơi
- `player_sessions` - Người chơi trong session
- `player_answers` - Câu trả lời của người chơi
- `session_leaderboards` - Bảng xếp hạng cuối phiên

## Deployment

### Vercel (Free Tier)
1. Tạo tài khoản Vercel
2. Connect repository
3. Cấu hình environment variables
4. Deploy

### Render (Free Tier)
1. Tạo tài khoản Render
2. Tạo Web Service
3. Connect repository
4. Cấu hình environment variables
5. Deploy

## Performance

- Hỗ trợ 40+ người chơi cùng lúc
- Connection pooling cho database
- Real-time communication với Socket.io
- Optimized queries với indexes

## Troubleshooting

### Database connection failed
- Kiểm tra XAMPP MySQL service đã start
- Kiểm tra thông tin database trong `.env`
- Kiểm tra database `kahoot_clone` đã được tạo

### Socket.io connection issues
- Kiểm tra CORS configuration
- Kiểm tra client URL trong `config.env`

## License

MIT License
