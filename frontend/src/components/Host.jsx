import React, { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Plus, Play, Users, Settings, LogOut, Eye, Edit, Trash } from 'lucide-react';
import API_URL from '../config/api';

const Host = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [quizzes, setQuizzes] = useState([]);
  const [loading, setLoading] = useState(true);
  
  // Quiz creation state
  const [showCreateQuiz, setShowCreateQuiz] = useState(false);
  const [quizTitle, setQuizTitle] = useState('');
  const [quizDescription, setQuizDescription] = useState('');
  const [questions, setQuestions] = useState([
    {
      content: '',
      choices: [
        { content: '', isCorrect: false },
        { content: '', isCorrect: false },
        { content: '', isCorrect: false },
        { content: '', isCorrect: false }
      ],
      timeLimit: 20,
      points: 1000
    }
  ]);
  const [isEditing, setIsEditing] = useState(false);
  const [editQuizId, setEditQuizId] = useState(null);

  // Game session state
  const [currentSession, setCurrentSession] = useState(null);
  const [sessionPin, setSessionPin] = useState('');

  useEffect(() => {
    const userData = localStorage.getItem('user');
    const token = localStorage.getItem('token');
    if (!userData) {
      if (token) {
        // Try to restore user from token
        fetch(`${API_URL}/api/auth/me`, {
          headers: { 'Authorization': `Bearer ${token}` }
        })
          .then(res => res.ok ? res.json() : null)
          .then(data => {
            if (data?.success && data?.data) {
              localStorage.setItem('user', JSON.stringify(data.data));
              setUser(data.data);
              fetchQuizzes();
            } else {
              navigate('/');
            }
          })
          .catch(() => navigate('/'));
        return;
      }
      navigate('/');
      return;
    }
    setUser(JSON.parse(userData));
    fetchQuizzes();
  }, [navigate]);

  const fetchQuizzes = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_URL}/api/quiz`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      if (response.ok) {
        const data = await response.json();
        const normalized = (data.data || []).map((q) => ({
          ...q,
          questionCount: q.question_count ?? q.questionCount ?? 0,
        }));
        setQuizzes(normalized);
      }
    } catch (error) {
      console.error('Error fetching quizzes:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadQuizForEdit = async (quizId) => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_URL}/api/quiz/${quizId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) return toast.error('Không tải được quiz');
      const data = await res.json();
      const q = data.data;
      setQuizTitle(q.title || '');
      setQuizDescription(q.description || '');
      const mapped = (q.questions || []).map((qq) => ({
        content: qq.content || '',
        timeLimit: qq.time_limit_s || 20,
        points: qq.points || 1000,
        choices: (qq.choices || []).map((c) => ({ content: c.content || '', isCorrect: !!c.is_correct }))
      }));
      setQuestions(mapped.length ? mapped : [{ content: '', choices: [ {content:'',isCorrect:false},{content:'',isCorrect:false},{content:'',isCorrect:false},{content:'',isCorrect:false} ], timeLimit: 20, points: 1000 }]);
      setIsEditing(true);
      setEditQuizId(quizId);
      setShowCreateQuiz(true);
    } catch (e) {
      toast.error('Lỗi tải quiz');
    }
  };

  const handleUpdateQuiz = async () => {
    if (!quizTitle.trim()) {
      toast.error('Vui lòng nhập tiêu đề quiz');
      return;
    }
    for (let i = 0; i < questions.length; i++) {
      const question = questions[i];
      if (!question.content.trim()) { toast.error(`Câu hỏi ${i+1}: Vui lòng nhập nội dung`); return; }
      const validChoices = question.choices.filter(c => c.content.trim());
      if (validChoices.length !== 4) { toast.error(`Câu hỏi ${i+1}: Cần đủ 4 đáp án`); return; }
      const correctChoices = validChoices.filter(c => c.isCorrect);
      if (correctChoices.length !== 1) { toast.error(`Câu hỏi ${i+1}: Cần đúng 1 đáp án đúng`); return; }
    }
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_URL}/api/quiz/${editQuizId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          title: quizTitle.trim(),
          description: quizDescription.trim(),
          isPublic: false,
          questions: questions.map(q => ({
            content: q.content.trim(),
            choices: q.choices.filter(c => c.content.trim()),
            timeLimit: q.timeLimit,
            points: q.points
          }))
        })
      });
      const data = await res.json();
      if (data.success) {
        toast.success('Cập nhật quiz thành công!');
        setIsEditing(false);
        setEditQuizId(null);
        setShowCreateQuiz(false);
        resetQuizForm();
        fetchQuizzes();
      } else {
        toast.error(data.message || 'Cập nhật quiz thất bại');
      }
    } catch (e) {
      toast.error('Lỗi kết nối server');
    }
  };

  const handleDeleteQuiz = async (quizId) => {
    if (!window.confirm('Bạn chắc chắn muốn xóa quiz này?')) return;
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_URL}/api/quiz/${quizId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success) {
        toast.success('Đã xóa quiz');
        fetchQuizzes();
      } else {
        toast.error(data.message || 'Xóa quiz thất bại');
      }
    } catch (e) {
      toast.error('Lỗi kết nối server');
    }
  };

  const handleCreateQuiz = async () => {
    if (!quizTitle.trim()) {
      toast.error('Vui lòng nhập tiêu đề quiz');
      return;
    }

    // Validate questions
    for (let i = 0; i < questions.length; i++) {
      const question = questions[i];
      if (!question.content.trim()) {
        toast.error(`Câu hỏi ${i + 1}: Vui lòng nhập nội dung`);
        return;
      }
      
      const validChoices = question.choices.filter(choice => choice.content.trim());
      if (validChoices.length !== 4) {
        toast.error(`Câu hỏi ${i + 1}: Cần đủ 4 đáp án`);
        return;
      }
      
      const correctChoices = validChoices.filter(choice => choice.isCorrect);
      if (correctChoices.length !== 1) {
        toast.error(`Câu hỏi ${i + 1}: Cần đúng 1 đáp án đúng`);
        return;
      }
    }

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_URL}/api/quiz`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          title: quizTitle.trim(),
          description: quizDescription.trim(),
          isPublic: false,
          questions: questions.map(q => ({
            content: q.content.trim(),
            choices: q.choices.filter(c => c.content.trim()),
            timeLimit: q.timeLimit,
            points: q.points
          }))
        })
      });

      const data = await response.json();

      if (data.success) {
        toast.success('Tạo quiz thành công!');
        setShowCreateQuiz(false);
        resetQuizForm();
        fetchQuizzes();
      } else {
        toast.error(data.message || 'Tạo quiz thất bại');
      }
    } catch (error) {
      toast.error('Lỗi kết nối server');
    }
  };

  const resetQuizForm = () => {
    setQuizTitle('');
    setQuizDescription('');
    setQuestions([{
      content: '',
      choices: [
        { content: '', isCorrect: false },
        { content: '', isCorrect: false },
        { content: '', isCorrect: false },
        { content: '', isCorrect: false }
      ],
      timeLimit: 20,
      points: 1000
    }]);
  };

  const addQuestion = () => {
    setQuestions([...questions, {
      content: '',
      choices: [
        { content: '', isCorrect: false },
        { content: '', isCorrect: false },
        { content: '', isCorrect: false },
        { content: '', isCorrect: false }
      ],
      timeLimit: 20,
      points: 1000
    }]);
  };

  const removeQuestion = (index) => {
    if (questions.length > 1) {
      setQuestions(questions.filter((_, i) => i !== index));
    }
  };

  const updateQuestion = (index, field, value) => {
    const newQuestions = [...questions];
    newQuestions[index] = { ...newQuestions[index], [field]: value };
    setQuestions(newQuestions);
  };

  const updateChoice = (questionIndex, choiceIndex, field, value) => {
    const newQuestions = [...questions];
    newQuestions[questionIndex].choices[choiceIndex] = {
      ...newQuestions[questionIndex].choices[choiceIndex],
      [field]: value
    };
    setQuestions(newQuestions);
  };

  const setCorrectChoice = (questionIndex, choiceIndex) => {
    const newQuestions = [...questions];
    newQuestions[questionIndex].choices.forEach((choice, i) => {
      choice.isCorrect = i === choiceIndex;
    });
    setQuestions(newQuestions);
  };

  const startGameSession = async (quizId) => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_URL}/api/game/session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ quizId })
      });

      const data = await response.json();

      if (data.success) {
        const s = {
          id: data.data.sessionId,
          pinCode: data.data.pinCode,
          quizId
        };
        setCurrentSession(s);
        setSessionPin(s.pinCode);
        toast.success(`Game session đã tạo! PIN: ${s.pinCode}`);
        // Auto navigate to waiting room as host
        navigate('/waiting-room', { state: { sessionId: s.id, isHost: true, pinCode: s.pinCode } });
      } else {
        toast.error(data.message || 'Không thể tạo game session');
      }
    } catch (error) {
      toast.error('Lỗi kết nối server');
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    navigate('/');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Đang tải...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center">
              <h1 className="text-2xl font-bold text-gray-900">🎯 Kahoot Clone</h1>
              <Badge variant="secondary" className="ml-3">
                Host Mode
              </Badge>
            </div>
            <div className="flex items-center space-x-4">
              <span className="text-gray-700">Xin chào, {user?.displayName}</span>
              <Button variant="outline" onClick={handleLogout}>
                <LogOut className="h-4 w-4 mr-2" />
                Đăng xuất
              </Button>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Current Session */}
        {currentSession && (
          <Card className="mb-8 bg-green-50 border-green-200">
            <CardHeader>
              <CardTitle className="text-green-800 flex items-center">
                <Play className="h-5 w-5 mr-2" />
                Game Session Đang Hoạt Động
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-green-700 font-medium">PIN Code: <span className="font-mono text-2xl">{sessionPin}</span></p>
                  <p className="text-green-600 text-sm">Người chơi có thể tham gia bằng PIN này</p>
                </div>
                <Button 
                  onClick={() => navigate('/waiting-room', { state: { sessionId: currentSession.id, isHost: true, pinCode: currentSession.pinCode } })}
                  className="bg-green-600 hover:bg-green-700"
                >
                  <Eye className="h-4 w-4 mr-2" />
                  Xem Waiting Room
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Quiz Management */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Quiz List */}
          <div>
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold text-gray-900">Quiz Của Bạn</h2>
              <Button onClick={() => setShowCreateQuiz(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Tạo Quiz Mới
              </Button>
            </div>

            <div className="space-y-4">
              {quizzes.map((quiz) => (
                <Card key={quiz.id} className="hover:shadow-md transition-shadow">
                  <CardHeader>
                    <CardTitle className="text-lg">{quiz.title}</CardTitle>
                    <CardDescription>{quiz.description}</CardDescription>
                    <div className="flex items-center space-x-2 text-sm text-gray-500">
                      <Users className="h-4 w-4" />
                      <span>{quiz.questionCount} câu hỏi</span>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="flex space-x-2">
                      <Button 
                        onClick={() => startGameSession(quiz.id)}
                        disabled={!!currentSession}
                        className="flex-1"
                      >
                        <Play className="h-4 w-4 mr-2" />
                        Bắt Đầu Game
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => loadQuizForEdit(quiz.id)}>
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => handleDeleteQuiz(quiz.id)}>
                        <Trash className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
              
              {quizzes.length === 0 && (
                <Card className="text-center py-12">
                  <CardContent>
                    <div className="text-gray-400 mb-4">
                      <Settings className="h-16 w-16 mx-auto" />
                    </div>
                    <p className="text-gray-500">Bạn chưa có quiz nào</p>
                    <Button 
                      onClick={() => setShowCreateQuiz(true)} 
                      className="mt-4"
                    >
                      Tạo Quiz Đầu Tiên
                    </Button>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>

          {/* Create Quiz Form */}
          {showCreateQuiz && (
            <div>
              <Card>
                <CardHeader>
                  <CardTitle>{isEditing ? 'Cập nhật Quiz' : 'Tạo Quiz Mới'}</CardTitle>
                  <CardDescription>
                    {isEditing ? 'Chỉnh sửa quiz và các câu hỏi trắc nghiệm' : 'Tạo quiz với câu hỏi trắc nghiệm 4 đáp án'}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div>
                    <Label htmlFor="quizTitle">Tiêu đề Quiz</Label>
                    <Input
                      id="quizTitle"
                      value={quizTitle}
                      onChange={(e) => setQuizTitle(e.target.value)}
                      placeholder="Nhập tiêu đề quiz"
                    />
                  </div>
                  
                  <div>
                    <Label htmlFor="quizDescription">Mô tả</Label>
                    <Textarea
                      id="quizDescription"
                      value={quizDescription}
                      onChange={(e) => setQuizDescription(e.target.value)}
                      placeholder="Mô tả ngắn về quiz"
                      rows={3}
                    />
                  </div>

                  <div>
                    <div className="flex justify-between items-center mb-4">
                      <Label>Câu hỏi ({questions.length})</Label>
                      <Button variant="outline" size="sm" onClick={addQuestion}>
                        <Plus className="h-4 w-4 mr-2" />
                        Thêm câu hỏi
                      </Button>
                    </div>

                    <div className="space-y-6">
                      {questions.map((question, qIndex) => (
                        <Card key={qIndex} className="p-4">
                          <div className="flex justify-between items-start mb-4">
                            <h4 className="font-medium">Câu hỏi {qIndex + 1}</h4>
                            {questions.length > 1 && (
                              <Button 
                                variant="outline" 
                                size="sm" 
                                onClick={() => removeQuestion(qIndex)}
                                className="text-red-600 hover:text-red-700"
                              >
                                <Trash className="h-4 w-4" />
                              </Button>
                            )}
                          </div>

                          <div className="space-y-4">
                            <div>
                              <Label>Nội dung câu hỏi</Label>
                              <Textarea
                                value={question.content}
                                onChange={(e) => updateQuestion(qIndex, 'content', e.target.value)}
                                placeholder="Nhập câu hỏi"
                                rows={2}
                              />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                              <div>
                                <Label>Thời gian (giây)</Label>
                                <Input
                                  type="number"
                                  value={question.timeLimit}
                                  onChange={(e) => updateQuestion(qIndex, 'timeLimit', parseInt(e.target.value))}
                                  min="5"
                                  max="60"
                                />
                              </div>
                              <div>
                                <Label>Điểm</Label>
                                <Input
                                  type="number"
                                  value={question.points}
                                  onChange={(e) => updateQuestion(qIndex, 'points', parseInt(e.target.value))}
                                  min="100"
                                  step="100"
                                />
                              </div>
                            </div>

                            <div>
                              <Label>Đáp án</Label>
                              <div className="space-y-2">
                                {question.choices.map((choice, cIndex) => (
                                  <div key={cIndex} className="flex items-center space-x-2">
                                    <input
                                      type="radio"
                                      name={`question-${qIndex}`}
                                      checked={choice.isCorrect}
                                      onChange={() => setCorrectChoice(qIndex, cIndex)}
                                      className="text-blue-600"
                                    />
                                    <Input
                                      value={choice.content}
                                      onChange={(e) => updateChoice(qIndex, cIndex, 'content', e.target.value)}
                                      placeholder={`Đáp án ${cIndex + 1}`}
                                      className={choice.isCorrect ? 'border-green-500 bg-green-50' : ''}
                                    />
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        </Card>
                      ))}
                    </div>
                  </div>

                  <div className="flex space-x-3">
                    {isEditing ? (
                      <Button onClick={handleUpdateQuiz} className="flex-1">Cập nhật Quiz</Button>
                    ) : (
                      <Button onClick={handleCreateQuiz} className="flex-1">Tạo Quiz</Button>
                    )}
                    <Button 
                      variant="outline" 
                      onClick={() => {
                        setShowCreateQuiz(false);
                        setIsEditing(false);
                        setEditQuizId(null);
                        resetQuizForm();
                      }}
                    >
                      Hủy
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Host;
