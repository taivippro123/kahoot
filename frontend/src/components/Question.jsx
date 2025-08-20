import React, { useState, useEffect, useRef } from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { useNavigate, useLocation } from 'react-router-dom';
import { toast } from 'sonner';
import { Clock, Users } from 'lucide-react';
import API_URL from '../config/api';
import AfterAnswer from './AfterAnswer';

const Question = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { sessionId, playerId, nickname, pinCode, isHost } = location.state || {};
  const startNext = (location.state && location.state.startNext) || false;
  
  const [currentQuestion, setCurrentQuestion] = useState(null);
  const [selectedChoice, setSelectedChoice] = useState(null);
  const [timeLeft, setTimeLeft] = useState(20);
  const [isAnswered, setIsAnswered] = useState(false);
  const [gameState, setGameState] = useState('waiting'); // waiting, playing, answered, finished
  const [showChoices, setShowChoices] = useState(false);
  const [progress, setProgress] = useState({ order: 0, total: 0 });
  
  const timerRef = useRef(null);
  const socketRef = useRef(null);
  const revealRef = useRef(null);
  const lastOrderRef = useRef(0);
  const initializedRef = useRef(false);
  const emittedNextRef = useRef(false);
  const PROGRESS_KEY = `kahoot:lastOrder:${sessionId || ''}`;

  useEffect(() => {
    if (!sessionId) {
      navigate('/');
      return;
    }
    if (!isHost && (!playerId || !nickname)) {
      navigate('/');
      return;
    }

    // Load the highest seen order for this session to prevent going backwards
    const stored = Number(sessionStorage.getItem(PROGRESS_KEY) || 0);
    if (!Number.isNaN(stored)) {
      lastOrderRef.current = stored;
    }

    if (!initializedRef.current) {
      initializedRef.current = true;
      connectSocket();
    }
    
    return () => {
      if (socketRef.current) socketRef.current.disconnect();
      if (timerRef.current) clearInterval(timerRef.current);
      if (revealRef.current) clearTimeout(revealRef.current);
      initializedRef.current = false;
      emittedNextRef.current = false;
    };
  }, [sessionId, playerId, nickname, isHost, navigate]);

  const connectSocket = () => {
    import('socket.io-client').then(({ io }) => {
      socketRef.current = io(`${API_URL}`);
      
      socketRef.current.on('connect', () => {
        const payload = isHost ? { sessionId, isHost: true } : { sessionId, playerId, nickname };
        socketRef.current.emit('join_session', payload);
        // ask server for the current question in case this client navigated late
        socketRef.current.emit('request_current', { sessionId });
        // Fallback: if still no question after 800ms, ask again
        setTimeout(() => {
          if (gameState === 'waiting') {
            socketRef.current.emit('request_current', { sessionId });
          }
        }, 800);
        // If host came from ranking with intent to start next question, trigger it once
        if (isHost && startNext && !emittedNextRef.current) {
          emittedNextRef.current = true;
          socketRef.current.emit('next_question', { sessionId });
        }
      });

      socketRef.current.on('question_displayed', (data) => {
        const seen = Number(sessionStorage.getItem(PROGRESS_KEY) || lastOrderRef.current || 0);
        if (data?.orderIndex && data.orderIndex < seen) {
          return; // ignore older question
        }
        if (data?.orderIndex && data.orderIndex === lastOrderRef.current && currentQuestion) {
          // already showing this question; ignore duplicate push to avoid restarting timer
          return;
        }
        const q = data.question;
        const clientQ = {
          id: q.id,
          content: q.content,
          imageUrl: q.image_url || null,
          timeLimit: q.time_limit_s || q.timeLimit || 20,
          points: q.points || 1000,
          choices: (q.choices || []).map(c => ({ id: c.id, content: c.content, isCorrect: !!c.is_correct }))
        };
        setCurrentQuestion(clientQ);
        setGameState('playing');
        setTimeLeft(clientQ.timeLimit);
        setIsAnswered(false);
        setSelectedChoice(null);
        setShowChoices(false);
        if (data?.orderIndex || data?.totalQuestions) {
          setProgress({ order: data.orderIndex || 0, total: data.totalQuestions || 0 });
        }
        if (revealRef.current) clearTimeout(revealRef.current);
        revealRef.current = setTimeout(() => setShowChoices(true), 3000);
        startTimer(clientQ.timeLimit);
        if (data?.orderIndex) {
          lastOrderRef.current = data.orderIndex;
          sessionStorage.setItem(PROGRESS_KEY, String(data.orderIndex));
        }
      });

      socketRef.current.on('question_closed', () => {
        setGameState('answered');
        if (timerRef.current) clearInterval(timerRef.current);
        navigate('/ranking', { state: { sessionId, playerId, nickname, pinCode, isHost } });
      });

      socketRef.current.on('game_ended', () => {
        setGameState('finished');
        navigate('/ranking', { state: { sessionId, playerId, nickname, pinCode, isHost } });
      });

      socketRef.current.on('app_error', (data) => {
        toast.error(data?.message || 'Socket error');
      });
    });
  };

  const startTimer = (duration) => {
    if (timerRef.current) clearInterval(timerRef.current);
    setTimeLeft(duration);
    timerRef.current = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(timerRef.current);
          if (isHost) {
            if (socketRef.current) socketRef.current.emit('close_question', { sessionId });
          } else if (!isAnswered && currentQuestion) {
            // auto submit last selected or first option if nothing
            const idx = selectedChoice ?? 0;
            submitAnswer(idx);
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const handleChoiceSelect = (choiceIndex) => {
    if (isHost) return; // host không chọn đáp án
    if (!showChoices) return; // chỉ cho chọn sau khi reveal
    if (gameState !== 'playing' || isAnswered) return;
    setSelectedChoice(choiceIndex);
    // auto submit immediately without confirm
    submitAnswer(choiceIndex);
  };

  const submitAnswer = async (choiceIndex) => {
    if (isAnswered || !currentQuestion) return;
    setIsAnswered(true);
    // show waiting screen until question_closed comes
    setGameState('after_submit');
    try {
      await fetch(`${API_URL}/api/game/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          playerId,
          questionId: currentQuestion.id,
          choiceId: currentQuestion.choices[choiceIndex].id,
          timeMs: (currentQuestion.timeLimit - timeLeft) * 1000
        }),
      }).then(res => res.json());
    } catch (_) {}
    if (socketRef.current) {
      socketRef.current.emit('submit_answer', { sessionId, questionId: currentQuestion.id, choiceId: choiceIndex, timeMs: (currentQuestion.timeLimit - timeLeft) * 1000 });
    }
  };

  const closeQuestionAsHost = () => {
    if (!isHost) return;
    if (socketRef.current) socketRef.current.emit('close_question', { sessionId });
  };

  if (!currentQuestion && gameState === 'waiting') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-600 via-blue-600 to-indigo-700 flex items-center justify-center">
        <Card className="w-full max-w-md text-center">
          <CardHeader>
            <div className="text-6xl mb-4">⏳</div>
            <CardTitle className="text-2xl">Đang chờ câu hỏi...</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-gray-600 mb-4">Host sẽ bắt đầu game sớm thôi!</p>
            <div className="flex items-center justify-center space-x-2 text-blue-600">
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
              <span>Đang kết nối...</span>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (gameState === 'after_submit' && !isHost) {
    return <AfterAnswer nickname={nickname} />;
  }

  if (!currentQuestion) return null;

  const palette = [
    'bg-red-500 hover:bg-red-600 text-white',
    'bg-blue-500 hover:bg-blue-600 text-white',
    'bg-yellow-500 hover:bg-yellow-600 text-white',
    'bg-green-500 hover:bg-green-600 text-white'
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-600 via-blue-600 to-indigo-700 p-4">
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-center mb-6 text-white">
          <div className="flex items-center space-x-4">
            <Badge variant="secondary" className="bg-white/20 text-white">
              <Users className="h-4 w-4 mr-2" />
              {isHost ? 'HOST' : nickname}
            </Badge>
            <Badge variant="secondary" className="bg-white/20 text-white">
              <Clock className="h-4 w-4 mr-2" />
              {timeLeft}s
            </Badge>
            {progress.total > 0 && (
              <Badge variant="secondary" className="bg-white/20 text-white font-mono">
                {progress.order}/{progress.total}
              </Badge>
            )}
          </div>
          <div className="text-right">
            <p className="text-sm opacity-80">PIN: {pinCode}</p>
          </div>
        </div>

        <div className="mb-6">
          <Progress value={(timeLeft / (currentQuestion.timeLimit || 20)) * 100} className="h-3 bg-white/20" />
        </div>

        <Card className="mb-6">
          <CardHeader className="text-center">
            <CardTitle className="text-3xl text-gray-900">{currentQuestion.content}</CardTitle>
            {currentQuestion.imageUrl && (
              <img src={currentQuestion.imageUrl} alt="Question" className="mx-auto max-h-64 object-contain rounded-lg" />
            )}
          </CardHeader>
        </Card>

        {showChoices ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            {currentQuestion.choices.map((choice, index) => (
              <Card key={index} className={`cursor-pointer transition-all duration-200 ${isHost ? '' : 'hover:scale-105'}`} onClick={() => handleChoiceSelect(index)}>
                <CardContent className={`p-6 ${palette[index]}`}>
                  <div className="flex items-center space-x-4">
                    <div className="w-12 h-12 rounded-full flex items-center justify-center text-xl font-bold bg-white/20">
                      {String.fromCharCode(65 + index)}
                    </div>
                    <span className="text-lg font-medium">{choice.content}</span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <div className="text-center text-white/80 mb-6">Chuẩn bị... đáp án sẽ xuất hiện ngay!</div>
        )}

        {isHost && (
          <div className="text-center">
            <Button onClick={closeQuestionAsHost} size="lg" className="bg-white text-purple-600 hover:bg-gray-100 text-lg px-8 py-3">Tiếp tục</Button>
          </div>
        )}
      </div>
    </div>
  );
};

export default Question;
