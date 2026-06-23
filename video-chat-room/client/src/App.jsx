import { Routes, Route, Navigate } from 'react-router-dom';
import StartScreen from './pages/StartScreen.jsx';
import RoomScreen from './pages/RoomScreen.jsx';

// Роутинг Start ↔ Room (impl §1.2).
// "/"             — стартовый экран (ввод имени, создание комнаты).
// "/room/:roomId" — экран комнаты; roomId служит ссылкой-приглашением (PRD F-02/F-04).
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<StartScreen />} />
      <Route path="/room/:roomId" element={<RoomScreen />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
