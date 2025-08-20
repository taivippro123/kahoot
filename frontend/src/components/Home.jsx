import React, { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import API_URL from '../config/api';
const Home = () => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('play');
  const [pinCode, setPinCode] = useState('');
  const [nickname, setNickname] = useState('');
  
  // Login state
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  
  // Register state
  const [registerEmail, setRegisterEmail] = useState('');
  const [registerPassword, setRegisterPassword] = useState('');
  const [registerDisplayName, setRegisterDisplayName] = useState('');

  useEffect(() => {
    const token = localStorage.getItem('token');
    const userStr = localStorage.getItem('user');

    // Nếu đã có token + user => chuyển thẳng vào host
    if (token && userStr) {
      try {
        const u = JSON.parse(userStr);
        if (u && u.id) {
          navigate('/host');
          return;
        }
      } catch (_) {}
    }

    // Nếu có token nhưng chưa có user => gọi /auth/me để phục hồi rồi chuyển vào host
    if (token && !userStr) {
      fetch(`${API_URL}/api/auth/me`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
        .then(res => res.ok ? res.json() : null)
        .then(data => {
          if (data?.success && data?.data) {
            localStorage.setItem('user', JSON.stringify(data.data));
            navigate('/host');
          }
        })
        .catch(() => {});
    }
  }, [navigate]);

  const handleJoinGame = async () => {
    if (!pinCode.trim() || !nickname.trim()) {
      toast.error('Vui lòng nhập đầy đủ thông tin');
      return;
    }

    try {
      // Join game session
      const response = await fetch(`${API_URL}/api/game/join`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          pinCode: pinCode.trim(),
          nickname: nickname.trim()
        }),
      });

      const data = await response.json();

      if (data.success) {
        toast.success('Tham gia game thành công!');
        navigate('/user-waiting', {
          state: {
            sessionId: data.data.sessionId,
            playerId: data.data.playerId,
            nickname: nickname.trim(),
            pinCode: pinCode.trim()
          }
        });
      } else {
        toast.error(data.message || 'Không thể tham gia game');
      }
    } catch (error) {
      toast.error('Lỗi kết nối server');
    }
  };

  const handleLogin = async () => {
    if (!loginEmail.trim() || !loginPassword.trim()) {
      toast.error('Vui lòng nhập đầy đủ thông tin');
      return;
    }

    try {
      const response = await fetch(`${API_URL}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: loginEmail.trim(),
          password: loginPassword
        }),
      });

      const data = await response.json();

      if (data.success) {
        localStorage.setItem('token', data.data.token);
        localStorage.setItem('user', JSON.stringify(data.data.user));
        toast.success('Đăng nhập thành công!');
        navigate('/host');
      } else {
        toast.error(data.message || 'Đăng nhập thất bại');
      }
    } catch (error) {
      toast.error('Lỗi kết nối server');
    }
  };

  const handleRegister = async () => {
    if (!registerEmail.trim() || !registerPassword.trim() || !registerDisplayName.trim()) {
      toast.error('Vui lòng nhập đầy đủ thông tin');
      return;
    }

    if (registerPassword.length < 6) {
      toast.error('Mật khẩu phải có ít nhất 6 ký tự');
      return;
    }

    try {
      const response = await fetch(`${API_URL}/api/auth/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: registerEmail.trim(),
          password: registerPassword,
          displayName: registerDisplayName.trim()
        }),
      });

      const data = await response.json();

      if (data.success) {
        localStorage.setItem('token', data.data.token);
        localStorage.setItem('user', JSON.stringify(data.data.user));
        toast.success('Đăng ký thành công!');
        navigate('/host');
      } else {
        toast.error(data.message || 'Đăng ký thất bại');
      }
    } catch (error) {
      toast.error('Lỗi kết nối server');
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-600 via-blue-600 to-indigo-700 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo và Title */}
        <div className="text-center mb-8">
          <div className="text-6xl mb-4">🎯</div>
          <h1 className="text-4xl font-bold text-white mb-2">Kahoot Clone</h1>
          <p className="text-white/80">Học tập vui vẻ, thi đua thú vị!</p>
        </div>

        {/* Main Card */}
        <Card className="w-full shadow-2xl">
          <CardHeader className="text-center">
            <CardTitle className="text-2xl">Chào mừng bạn!</CardTitle>
            <CardDescription>
              Chọn cách bạn muốn tham gia
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="play">Chơi Game</TabsTrigger>
                <TabsTrigger value="login">Đăng Nhập</TabsTrigger>
                <TabsTrigger value="register">Đăng Ký</TabsTrigger>
              </TabsList>

              {/* Tab Chơi Game */}
              <TabsContent value="play" className="space-y-4 mt-6">
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="pinCode">Mã PIN Game</Label>
                    <Input
                      id="pinCode"
                      type="text"
                      placeholder="Nhập mã PIN 6 số"
                      value={pinCode}
                      onChange={(e) => setPinCode(e.target.value)}
                      maxLength={6}
                      className="text-center text-lg font-mono"
                    />
                  </div>
                  <div>
                    <Label htmlFor="nickname">Tên của bạn</Label>
                    <Input
                      id="nickname"
                      type="text"
                      placeholder="Nhập tên hiển thị"
                      value={nickname}
                      onChange={(e) => setNickname(e.target.value)}
                      maxLength={20}
                    />
                  </div>
                  <Button 
                    onClick={handleJoinGame} 
                    className="w-full bg-green-600 hover:bg-green-700 text-lg py-3"
                    disabled={!pinCode.trim() || !nickname.trim()}
                  >
                    🎮 Tham Gia Game
                  </Button>
                </div>
              </TabsContent>

              {/* Tab Đăng Nhập */}
              <TabsContent value="login" className="space-y-4 mt-6">
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="loginEmail">Email</Label>
                    <Input
                      id="loginEmail"
                      type="email"
                      placeholder="your@email.com"
                      value={loginEmail}
                      onChange={(e) => setLoginEmail(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label htmlFor="loginPassword">Mật khẩu</Label>
                    <Input
                      id="loginPassword"
                      type="password"
                      placeholder="Nhập mật khẩu"
                      value={loginPassword}
                      onChange={(e) => setLoginPassword(e.target.value)}
                    />
                  </div>
                  <Button 
                    onClick={handleLogin} 
                    className="w-full bg-blue-600 hover:bg-blue-700 text-lg py-3"
                    disabled={!loginEmail.trim() || !loginPassword.trim()}
                  >
                    🔑 Đăng Nhập
                  </Button>
                </div>
              </TabsContent>

              {/* Tab Đăng Ký */}
              <TabsContent value="register" className="space-y-4 mt-6">
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="registerDisplayName">Tên hiển thị</Label>
                    <Input
                      id="registerDisplayName"
                      type="text"
                      placeholder="Tên của bạn"
                      value={registerDisplayName}
                      onChange={(e) => setRegisterDisplayName(e.target.value)}
                      maxLength={50}
                    />
                  </div>
                  <div>
                    <Label htmlFor="registerEmail">Email</Label>
                    <Input
                      id="registerEmail"
                      type="email"
                      placeholder="your@email.com"
                      value={registerEmail}
                      onChange={(e) => setRegisterEmail(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label htmlFor="registerPassword">Mật khẩu</Label>
                    <Input
                      id="registerPassword"
                      type="password"
                      placeholder="Tối thiểu 6 ký tự"
                      value={registerPassword}
                      onChange={(e) => setRegisterPassword(e.target.value)}
                      minLength={6}
                    />
                  </div>
                  <Button 
                    onClick={handleRegister} 
                    className="w-full bg-purple-600 hover:bg-purple-700 text-lg py-3"
                    disabled={!registerEmail.trim() || !registerPassword.trim() || !registerDisplayName.trim()}
                  >
                    ✨ Đăng Ký
                  </Button>
                </div>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        {/* Footer */}
        <div className="text-center mt-6 text-white/60">
          <p>Hỗ trợ tối đa 40 người chơi cùng lúc</p>
          <p className="text-sm mt-1">Real-time multiplayer với Socket.io</p>
        </div>
      </div>
    </div>
  );
};

export default Home;
