import { Routes, Route, Navigate } from 'react-router-dom';
import StartScreen from './pages/StartScreen.jsx';
import RoomScreen from './pages/RoomScreen.jsx';
import NoticeScreen from './components/NoticeScreen.jsx';
import { isWebRTCSupported } from './lib/support.js';

// Поддержку WebRTC проверяем один раз при загрузке модуля (PRD п. 36, US-13;
// TDD §8): возможности браузера в рамках сессии не меняются.
const webrtcSupported = isWebRTCSupported();

// Роутинг Start ↔ Room (impl §1.2).
// "/"             — стартовый экран (ввод имени, создание комнаты).
// "/room/:roomId" — экран комнаты; roomId служит ссылкой-приглашением (PRD F-02/F-04).
export default function App() {
  // Блок-экран при отсутствии поддержки WebRTC — приложение неработоспособно без
  // peer-соединений и getUserMedia, поэтому перехватываем до роутинга (задача 19).
  if (!webrtcSupported) {
    return (
      <NoticeScreen
        title="Браузер не поддерживается"
        text="Ваш браузер не поддерживает WebRTC. Откройте приложение в актуальной версии Chrome, Firefox или Edge по защищённому соединению (HTTPS)."
      />
    );
  }

  return (
    <Routes>
      <Route path="/" element={<StartScreen />} />
      <Route path="/room/:roomId" element={<RoomScreen />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
