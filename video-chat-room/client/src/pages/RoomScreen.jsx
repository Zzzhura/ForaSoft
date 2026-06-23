import { useParams } from 'react-router-dom';

// Заглушка экрана комнаты. Полная реализация — задача 18
// (медиа + сигналинг + видеосетка + чат + контролы).
export default function RoomScreen() {
  const { roomId } = useParams();
  return (
    <main className="screen">
      <h1>Комната: {roomId}</h1>
      <p>Экран комнаты — заглушка каркаса (задача 1). Реализация в задаче 18.</p>
    </main>
  );
}
