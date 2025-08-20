import React, { useState, useEffect, useRef } from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useNavigate, useLocation } from 'react-router-dom';
import { toast } from 'sonner';
import { Users, Play, Settings, LogOut, Copy, Eye, Crown, UserPlus, CheckCircle } from 'lucide-react';
import API_URL from '../config/api';

const WaitingRoom = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { sessionId, playerId, nickname, pinCode, isHost } = location.state || {};
  
  const [players, setPlayers] = useState([]);
  const [sessionInfo, setSessionInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [gameStarted, setGameStarted] = useState(false);
  const [currentPlayer, setCurrentPlayer] = useState(null);
  
  const socketRef = useRef(null);
  const playersRef = useRef(new Map());

  useEffect(() => {
    // Chỉ cần sessionId; nếu là player thì phải có playerId và nickname
    if (!sessionId) {
      navigate('/');
      return;
    }
    if (!isHost && (!playerId || !nickname)) {
      navigate('/');
      return;
    }

    // Chỉ add bản thân vào danh sách nếu là player
    if (!isHost) {
      setCurrentPlayer({ playerId, nickname, joinedAt: new Date() });
      addPlayer(playerId, nickname);
    }

    connectSocket();
    fetchSessionInfo();
    
    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
    };
  }, [sessionId, playerId, nickname, isHost, navigate]);

  const connectSocket = () => {
    import('socket.io-client').then(({ io }) => {
      socketRef.current = io(`${API_URL}`);
      
      socketRef.current.on('connect', () => {
        // Join session (host hoặc player)
        const payload = isHost 
          ? { sessionId, isHost: true }
          : { sessionId, playerId, nickname, isHost: false };
        socketRef.current.emit('join_session', payload);
      });

      // Nhận danh sách người chơi hiện tại
      socketRef.current.on('session_players', (list) => {
        try {
          playersRef.current.clear();
          list.forEach(p => {
            playersRef.current.set(p.playerId, { 
              playerId: p.playerId, 
              nickname: p.nickname, 
              joinedAt: new Date(p.joinedAt || Date.now())
            });
          });
          setPlayers(Array.from(playersRef.current.values()));
        } catch (e) {}
      });

      // Nếu sau 1s mà vẫn chưa có player nào thì fallback gọi API
      setTimeout(() => {
        if (playersRef.current.size === 0) {
          fetchSessionPlayersFallback();
        }
      }, 1000);

      socketRef.current.on('player_joined', (data) => {
        if (!isHost && data.playerId === playerId) return;
        addPlayer(data.playerId, data.nickname);
        if (isHost) {
          // chỉ host mới thấy thông báo
          try { toast.success(`${data.nickname} đã tham gia!`); } catch {}
        }
      });

      socketRef.current.on('player_left', (data) => {
        removePlayer(data.playerId);
        if (isHost) {
          try { toast.info(`${data.nickname} đã rời khỏi game`); } catch {}
        }
      });

      socketRef.current.on('game_started', (data) => {
        setGameStarted(true);
        if (isHost) {
          navigate('/question', { state: { sessionId, isHost: true, pinCode } });
        } else {
          navigate('/question', { state: { sessionId, playerId, nickname, pinCode } });
        }
      });

      socketRef.current.on('error', (data) => {
        toast.error(data?.message || 'Socket error');
      });

      socketRef.current.on('app_error', (data) => {
        toast.error(data?.message || 'Socket error');
      });
    });
  };

  const fetchSessionInfo = async () => {
    try {
      // Nếu thiếu pinCode nhưng có sessionId + host thì bỏ qua phần này
      if (!pinCode) return;
      const response = await fetch(`${API_URL}/api/game/session/${pinCode}`);
      if (response.ok) {
        const data = await response.json();
        setSessionInfo({
          quizTitle: data?.data?.quiz_title || data?.data?.quizTitle,
          quizDescription: data?.data?.quiz_description || data?.data?.quizDescription,
        });
      }
    } catch (error) {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  const fetchSessionPlayersFallback = async () => {
    try {
      const res = await fetch(`${API_URL}/api/game/session/${sessionId}/players`);
      if (res.ok) {
        const json = await res.json();
        if (json?.success && Array.isArray(json.data)) {
          playersRef.current.clear();
          json.data.forEach(p => {
            playersRef.current.set(p.playerId, { playerId: p.playerId, nickname: p.nickname, joinedAt: new Date(p.joinedAt) });
          });
          setPlayers(Array.from(playersRef.current.values()));
        }
      }
    } catch (_) {}
  };

  const addPlayer = (id, name) => {
    playersRef.current.set(id, { playerId: id, nickname: name, joinedAt: new Date() });
    setPlayers(Array.from(playersRef.current.values()));
  };

  const removePlayer = (id) => {
    playersRef.current.delete(id);
    setPlayers(Array.from(playersRef.current.values()));
  };

  const handleStartGame = () => {
    if (players.length < 1) {
      toast.error('Cần ít nhất 1 người chơi để bắt đầu game');
      return;
    }
    if (socketRef.current) {
      socketRef.current.emit('start_game', { sessionId });
    }
  };

  const handleCopyPin = () => {
    if (!pinCode) return;
    navigator.clipboard.writeText(pinCode);
    toast.success('Đã copy PIN code!');
  };

  const handleKickPlayer = (id) => {
    if (!isHost) return;
    if (socketRef.current) {
      socketRef.current.emit('kick_player', { sessionId, playerId: id });
      removePlayer(id);
    }
  };

  const handleLeaveGame = () => {
    if (!isHost && socketRef.current) {
      socketRef.current.emit('leave_session', { sessionId, playerId });
    }
    navigate('/');
  };

  if (loading && !sessionInfo && isHost) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-600 via-blue-600 to-indigo-700 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto"></div>
          <p className="mt-4 text-white">Đang kết nối...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-600 via-blue-600 to-indigo-700 p-4">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="text-6xl mb-4">🚪</div>
          <h1 className="text-4xl font-bold text-white mb-2">Phòng Chờ</h1>
          <p className="text-white/80">Chờ người chơi tham gia và bắt đầu game</p>
        </div>

        {/* Session Info */}
        {sessionInfo && (
          <Card className="mb-8 bg-white/10 backdrop-blur-sm border-white/20">
            <CardHeader className="text-center">
              <CardTitle className="text-white text-2xl">{sessionInfo.quizTitle}</CardTitle>
              <CardDescription className="text-white/80">{sessionInfo.quizDescription}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-center space-x-6 text-white">
                <div className="text-center">
                  <div className="text-3xl font-bold text-blue-400">{pinCode || '—'}</div>
                  <div className="text-sm opacity-80">PIN Code</div>
                </div>
                <div className="text-center">
                  <div className="text-3xl font-bold text-green-400">{players.length}</div>
                  <div className="text-sm opacity-80">Người chơi</div>
                </div>
                <div className="text-center">
                  <div className="text-3xl font-bold text-yellow-400">
                    {isHost ? 'Host' : 'Player'}
                  </div>
                  <div className="text-sm opacity-80">Vai trò</div>
                </div>
              </div>
              
              {/* Copy PIN Button */}
              {pinCode && (
                <div className="text-center mt-4">
                  <Button onClick={handleCopyPin} variant="outline" className="bg-white/20 border-white/30 text-white hover:bg-white/30">
                    <Copy className="h-4 w-4 mr-2" />
                    Copy PIN Code
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Players List - Only show for host */}
        {isHost && (
          <Card className="mb-8">
            <CardHeader>
              <CardTitle className="text-2xl flex items-center justify-center">
                <Users className="h-6 w-6 mr-2" />
                Người Chơi ({players.length})
              </CardTitle>
              <CardDescription className="text-center">
                Danh sách người chơi đang chờ
              </CardDescription>
            </CardHeader>
            <CardContent>
              {players.length === 0 ? (
                <div className="text-center py-12 text-gray-500">
                  <UserPlus className="h-16 w-16 mx-auto mb-4 opacity-50" />
                  <p>Chưa có người chơi nào</p>
                  <p className="text-sm">Chia sẻ PIN code để mời bạn bè tham gia!</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {players.map((player, index) => (
                    <Card key={player.playerId} className={`transition-all duration-200 hover:shadow-lg ${player.nickname === nickname ? 'ring-2 ring-blue-400 bg-blue-50' : ''}`}>
                      <CardContent className="p-4 text-center">
                        <div className="flex items-center justify-center mb-3">
                          {index === 0 && (<Crown className="h-5 w-5 text-yellow-500 mr-2" />)}
                          <div className={`w-12 h-12 rounded-full flex items-center justify-center text-xl font-bold ${index === 0 ? 'bg-yellow-500 text-white' : index === 1 ? 'bg-gray-400 text-white' : index === 2 ? 'bg-amber-600 text-white' : 'bg-gray-200 text-gray-700'}`}>
                            {index + 1}
                          </div>
                        </div>
                        <div className="space-y-2">
                          <div className="flex items-center justify-center space-x-2">
                            <span className="font-semibold text-lg">{player.nickname}</span>
                            {!isHost && player.nickname === nickname && (
                              <Badge variant="secondary" className="bg-blue-100 text-blue-800">Bạn</Badge>
                            )}
                          </div>
                          <div className="text-sm text-gray-500">Tham gia lúc {new Date(player.joinedAt).toLocaleTimeString()}</div>
                          {isHost && player.nickname !== nickname && (
                            <Button variant="outline" size="sm" onClick={() => handleKickPlayer(player.playerId)} className="text-red-600 hover:text-red-700 border-red-300">Kick</Button>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Player Info - Show for non-host players */}
        {!isHost && (
          <Card className="mb-8 bg-blue-50 border-blue-200">
            <CardHeader>
              <CardTitle className="text-blue-800">Thông Tin Của Bạn</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-center">
                <div className="flex items-center justify-center mb-4">
                  <CheckCircle className="h-16 w-16 text-green-500 mr-4" />
                  <div className="text-left">
                    <p className="text-blue-700 text-xl font-semibold mb-2">
                      Tên của bạn: <span className="text-blue-900">{nickname}</span>
                    </p>
                    <p className="text-blue-600 text-sm">Bạn đã tham gia thành công vào game!</p>
                  </div>
                </div>
                <p className="text-blue-700 mb-2">Bạn đang chờ host bắt đầu game...</p>
                <p className="text-blue-600 text-sm">Hãy chờ đợi và sẵn sàng cho những câu hỏi thú vị!</p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Host Controls */}
        {isHost && (
          <Card className="mb-8 bg-green-50 border-green-200">
            <CardHeader>
              <CardTitle className="text-green-800 flex items-center">
                <Crown className="h-5 w-5 mr-2" />
                Điều Khiển Host
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col sm:flex-row items-center justify-center space-y-4 sm:space-y-0 sm:space-x-4">
                <Button onClick={handleStartGame} disabled={players.length < 1} size="lg" className="bg-green-600 hover:bg-green-700 text-lg px-8 py-3">
                  <Play className="h-5 w-5 mr-2" />
                  Bắt Đầu Game
                </Button>
                <Button variant="outline" size="lg" onClick={() => navigate('/host')} className="text-lg px-8 py-3">
                  <Settings className="h-5 w-5 mr-2" />
                  Quản Lý Quiz
                </Button>
              </div>
              <div className="text-center mt-4 text-green-700 text-sm">
                {players.length < 1 ? 'Cần ít nhất 1 người chơi để bắt đầu game' : `Sẵn sàng bắt đầu với ${players.length} người chơi!`}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Action Buttons */}
        <div className="text-center space-y-4">
          <Button onClick={handleLeaveGame} variant="outline" size="lg" className="bg-white/20 border-white/30 text-white hover:bg-white/30 text-lg px-8 py-3">
            <LogOut className="h-5 w-5 mr-2" />
            Rời Khỏi Game
          </Button>
          <div className="text-white/60 text-sm">
            <p>Chia sẻ PIN code: <span className="font-mono font-bold">{pinCode || '—'}</span></p>
            <p>Để mời bạn bè tham gia game!</p>
          </div>
        </div>

        <div className="text-center mt-8 text-white/40">
          <div className="flex items-center justify-center space-x-2">
            <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
            <span>Real-time updates với Socket.io</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default WaitingRoom;
