import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { Toaster } from 'sonner';
import Home from './components/Home';
import Host from './components/Host';
import Question from './components/Question';
import Ranking from './components/Ranking';
import WaitingRoom from './components/WaitingRoom';
import UserWaiting from './components/UserWaiting';

function App() {
  return (
    <Router>
      <div className="App">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/host" element={<Host />} />
          <Route path="/question" element={<Question />} />
          <Route path="/ranking" element={<Ranking />} />
          <Route path="/waiting-room" element={<WaitingRoom />} />
          <Route path="/user-waiting" element={<UserWaiting />} />
        </Routes>
        <Toaster position="top-right" richColors closeButton duration={4000} />
      </div>
    </Router>
  );
}

export default App;
