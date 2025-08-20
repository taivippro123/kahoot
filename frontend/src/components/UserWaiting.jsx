import React, { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import API_URL from '../config/api';

const UserWaiting = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { sessionId, playerId, nickname, pinCode } = location.state || {};
  const socketRef = useRef(null);

  useEffect(() => {
    if (!sessionId || !playerId || !nickname) {
      navigate('/');
      return;
    }

    import('socket.io-client').then(({ io }) => {
      socketRef.current = io(`${API_URL}`);
      socketRef.current.on('connect', () => {
        socketRef.current.emit('join_session', { sessionId, playerId, nickname, isHost: false });
      });

      socketRef.current.on('game_started', () => {
        navigate('/question', { state: { sessionId, playerId, nickname, pinCode } });
      });
    });

    return () => {
      if (socketRef.current) socketRef.current.disconnect();
    };
  }, [sessionId, playerId, nickname, pinCode, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-purple-600 via-blue-600 to-indigo-700 p-6 text-white">
      <div className="text-center space-y-4">
        <div className="text-6xl">👋</div>
        <h1 className="text-3xl font-bold">Xin chào, {nickname}!</h1>
        <p className="text-xl">Thấy tên bạn trên màn hình chưa?</p>
        <p className="text-white/80">Chờ host bắt đầu game nhé.</p>
      </div>
    </div>
  );
};

export default UserWaiting;
