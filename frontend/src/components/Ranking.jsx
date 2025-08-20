import React, { useState, useEffect, useRef } from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useNavigate, useLocation } from 'react-router-dom';
import { toast } from 'sonner';
import { Trophy, Medal, Users, Target, ArrowLeft, Share2, Download } from 'lucide-react';
import { ArrowRight } from 'lucide-react';
import API_URL from '../config/api';

const Ranking = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { sessionId, playerId, nickname, pinCode, isHost } = location.state || {};
  
  const [leaderboard, setLeaderboard] = useState([]);
  const [sessionInfo, setSessionInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [currentPlayerRank, setCurrentPlayerRank] = useState(null);
  const socketRef = useRef(null);
  const [hasMore, setHasMore] = useState(true);

  useEffect(() => {
    if (!sessionId) {
      navigate('/');
      return;
    }

    // Setup socket to move to next question when host clicks next
    import('socket.io-client').then(({ io }) => {
      socketRef.current = io(`${API_URL}`);
      socketRef.current.on('connect', () => {
        if (isHost) {
          socketRef.current.emit('join_session', { sessionId, isHost: true });
        } else {
          socketRef.current.emit('join_session', { sessionId, playerId, nickname });
        }
      });

      socketRef.current.on('question_displayed', (payload) => {
        // receiving new question means there is at least one more; navigate accordingly
        if (isHost) {
          navigate('/question', { state: { sessionId, isHost: true, pinCode } });
        } else {
          navigate('/question', { state: { sessionId, playerId, nickname, pinCode } });
        }
      });

      socketRef.current.on('game_ended', () => {
        setHasMore(false);
        navigate('/');
      });

      socketRef.current.on('question_progress', (p) => {
        if (typeof p?.currentOrder === 'number' && typeof p?.totalQuestions === 'number') {
          setHasMore(p.currentOrder < p.totalQuestions);
        }
      });

      // ask progress to decide if Next should be shown
      socketRef.current.emit('request_progress', { sessionId });

      socketRef.current.on('app_error', (p) => {
        if (p?.message) toast.error(p.message);
      });
    });

    fetchLeaderboard();

    return () => {
      if (socketRef.current) socketRef.current.disconnect();
    };
  }, [sessionId, navigate, isHost, playerId, nickname, pinCode]);

  const fetchLeaderboard = async () => {
    try {
      const response = await fetch(`${API_URL}/api/game/session/${sessionId}/leaderboard`);
      
      if (response.ok) {
        const data = await response.json();
        const raw = Array.isArray(data.data) ? data.data : [];
        // Map snake_case -> camelCase to match UI
        const mapped = raw.map(p => ({
          playerId: p.player_id,
          nickname: p.nickname,
          totalScore: p.total_score ?? 0,
          totalAnswers: p.total_answers ?? 0,
          correctCount: p.correct_count ?? 0,
          wrongCount: p.wrong_count ?? 0,
          rank: p.rank ?? 0,
        }));
        setLeaderboard(mapped);
        const playerRank = mapped.find(player => player.nickname === nickname);
        if (playerRank) setCurrentPlayerRank(playerRank);
      } else {
        const err = await response.json().catch(() => ({}));
        toast.error(err.message || 'Không thể tải bảng xếp hạng');
      }
    } catch (error) {
      console.error('Error fetching leaderboard:', error);
      toast.error('Không thể tải bảng xếp hạng');
    } finally {
      setLoading(false);
    }
  };

  const getRankIcon = (rank) => {
    if (rank === 1) return '🥇';
    if (rank === 2) return '🥈';
    if (rank === 3) return '🥉';
    return `#${rank}`;
  };

  const getRankColor = (rank) => {
    if (rank === 1) return 'bg-yellow-500 text-white';
    if (rank === 2) return 'bg-gray-400 text-white';
    if (rank === 3) return 'bg-amber-600 text-white';
    return 'bg-gray-200 text-gray-700';
  };

  const getScoreColor = (score) => {
    if (score >= 8000) return 'text-green-600';
    if (score >= 5000) return 'text-blue-600';
    if (score >= 2000) return 'text-yellow-600';
    return 'text-gray-600';
  };

  const handleBackToHome = () => {
    navigate('/');
  };

  const handleShareResults = () => {
    if (navigator.share) {
      navigator.share({
        title: 'Kết quả Kahoot Clone',
        text: `Tôi đã chơi Kahoot Clone và đạt được ${currentPlayerRank?.totalScore || 0} điểm!`,
        url: window.location.href
      });
    } else {
      navigator.clipboard.writeText(
        `Kết quả Kahoot Clone: ${currentPlayerRank?.totalScore || 0} điểm - Xếp hạng ${currentPlayerRank?.rank || 'N/A'}`
      );
      toast.success('Đã copy kết quả vào clipboard!');
    }
  };

  const handleDownloadResults = () => {
    const results = {
      sessionId,
      playerName: nickname,
      rank: currentPlayerRank?.rank || 'N/A',
      totalScore: currentPlayerRank?.totalScore || 0,
      correctAnswers: currentPlayerRank?.correctCount || 0,
      wrongAnswers: currentPlayerRank?.wrongCount || 0,
      leaderboard: leaderboard
    };

    const blob = new Blob([JSON.stringify(results, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `kahoot-results-${nickname || 'player'}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    toast.success('Đã tải xuống kết quả!');
  };

  const handleNextQuestion = () => {
    if (!isHost) navigate('/');
    if (!hasMore) navigate('/');
    navigate('/question', { state: { sessionId, isHost: true, pinCode, startNext: true } });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-600 via-blue-600 to-indigo-700 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto"></div>
          <p className="mt-4 text-white">Đang tải bảng xếp hạng...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-600 via-blue-600 to-indigo-700 p-4">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="text-6xl mb-4">🏆</div>
          <h1 className="text-4xl font-bold text-white mb-2">Bảng Xếp Hạng</h1>
          <p className="text-white/80">Kết quả cuối cùng của game session</p>
          {pinCode && (
            <Badge variant="secondary" className="mt-2 bg-white/20 text-white">
              PIN: {pinCode}
            </Badge>
          )}
        </div>

        {/* Current Player Summary */}
        {currentPlayerRank && (
          <Card className="mb-8 bg-white/10 backdrop-blur-sm border-white/20">
            <CardHeader className="text-center">
              <CardTitle className="text-white text-2xl">Kết quả của bạn</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-center text-white">
                <div>
                  <div className="text-3xl font-bold text-yellow-400">
                    {getRankIcon(currentPlayerRank.rank)}
                  </div>
                  <div className="text-sm opacity-80">Xếp hạng</div>
                </div>
                <div>
                  <div className={`text-3xl font-bold ${getScoreColor(currentPlayerRank.totalScore)}`}>
                    {currentPlayerRank.totalScore.toLocaleString()}
                  </div>
                  <div className="text-sm opacity-80">Tổng điểm</div>
                </div>
                <div>
                  <div className="text-3xl font-bold text-green-400">
                    {currentPlayerRank.correctCount}
                  </div>
                  <div className="text-sm opacity-80">Đúng</div>
                </div>
                <div>
                  <div className="text-3xl font-bold text-red-400">
                    {currentPlayerRank.wrongCount}
                  </div>
                  <div className="text-sm opacity-80">Sai</div>
                </div>
              </div>
              
              {/* Action Buttons */}
              <div className="flex justify-center space-x-4 mt-6">
                <Button onClick={handleShareResults} variant="outline" className="bg-white/20 border-white/30 text-white hover:bg-white/30">
                  <Share2 className="h-4 w-4 mr-2" />
                  Chia sẻ
                </Button>
                <Button onClick={handleDownloadResults} variant="outline" className="bg-white/20 border-white/30 text-white hover:bg-white/30">
                  <Download className="h-4 w-4 mr-2" />
                  Tải xuống
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Leaderboard */}
        <Card className="mb-8">
          <CardHeader>
            <CardTitle className="text-2xl flex items-center justify-center">
              <Trophy className="h-6 w-6 mr-2 text-yellow-500" />
              Bảng Xếp Hạng Cuối Cùng
            </CardTitle>
            <CardDescription className="text-center">
              {leaderboard.length} người chơi tham gia
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {leaderboard.map((player, index) => (
                <div
                  key={index}
                  className={`flex items-center justify-between p-4 rounded-lg transition-all duration-200 ${
                    player.nickname === nickname 
                      ? 'bg-blue-50 border-2 border-blue-300 shadow-lg' 
                      : 'bg-gray-50 hover:bg-gray-100'
                  }`}
                >
                  <div className="flex items-center space-x-4">
                    <div className={`w-12 h-12 rounded-full flex items-center justify-center font-bold text-lg ${getRankColor(player.rank)}`}>
                      {getRankIcon(player.rank)}
                    </div>
                    <div>
                      <div className="flex items-center space-x-2">
                        <span className="font-semibold text-lg">{player.nickname}</span>
                        {player.nickname === nickname && (
                          <Badge variant="secondary" className="bg-blue-100 text-blue-800">
                            Bạn
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center space-x-4 text-sm text-gray-600">
                        <span className="flex items-center">
                          <Target className="h-3 w-3 mr-1" />
                          {player.correctCount} đúng
                        </span>
                        <span className="flex items-center">
                          <Users className="h-3 w-3 mr-1" />
                          {player.wrongCount} sai
                        </span>
                      </div>
                    </div>
                  </div>
                  
                  <div className="text-right">
                    <div className={`text-2xl font-bold ${getScoreColor(player.totalScore)}`}>
                      {player.totalScore.toLocaleString()}
                    </div>
                    <div className="text-sm text-gray-500">điểm</div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Game Statistics */}
        <Card className="mb-8 bg-white/10 backdrop-blur-sm border-white/20">
          <CardHeader>
            <CardTitle className="text-white text-center">Thống Kê Game</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-center text-white">
              <div>
                <div className="text-4xl font-bold text-blue-400">
                  {leaderboard.length}
                </div>
                <div className="text-sm opacity-80">Tổng người chơi</div>
              </div>
              <div>
                <div className="text-4xl font-bold text-green-400">
                  {leaderboard.reduce((sum, player) => sum + player.correctCount, 0)}
                </div>
                <div className="text-sm opacity-80">Tổng câu trả lời đúng</div>
              </div>
              <div>
                <div className="text-4xl font-bold text-yellow-400">
                  {leaderboard.length > 0 
                    ? Math.round(leaderboard.reduce((sum, player) => sum + player.totalScore, 0) / leaderboard.length)
                    : 0
                  }
                </div>
                <div className="text-sm opacity-80">Điểm trung bình</div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Action Buttons */}
        <div className="text-center space-y-4">
          <Button 
            onClick={handleBackToHome} 
            size="lg"
            className="bg-white text-purple-600 hover:bg-gray-100 text-lg px-8 py-3"
          >
            <ArrowLeft className="h-5 w-5 mr-2" />
            Về Trang Chủ
          </Button>
          {isHost && hasMore === true && (
            <div>
              <Button onClick={handleNextQuestion} size="lg" className="bg-yellow-400 hover:bg-yellow-500 text-black text-lg px-8 py-3 disabled:opacity-60 disabled:cursor-not-allowed">
                <ArrowRight className="h-5 w-5 mr-2" />
                Câu hỏi tiếp theo
              </Button>
            </div>
          )}
          
          <div className="text-white/60 text-sm">
            <p>Cảm ơn bạn đã tham gia game!</p>
            <p>Hẹn gặp lại trong những lần chơi tiếp theo! 🎮</p>
          </div>
        </div>

        {/* Footer */}
        <div className="text-center mt-12 text-white/40">
          <p>Kahoot Clone - Học tập vui vẻ, thi đua thú vị!</p>
          <p className="text-xs mt-1">Real-time multiplayer với Socket.io</p>
        </div>
      </div>
    </div>
  );
};

export default Ranking;
