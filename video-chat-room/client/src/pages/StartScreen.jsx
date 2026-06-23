import { useNavigate } from 'react-router-dom';
import { nanoid } from 'nanoid';
import EntryScreen from '../components/EntryScreen.jsx';

/**
 * Стартовый экран (задача 13): ввод названия комнаты и её создание (PRD F-02,
 * US-2). Первый шаг двухшагового входа — имя пользователя спрашивается уже на
 * экране комнаты (`RoomScreen`, US-4). roomId генерируется (nanoid(8), TDD §5);
 * введённое название — лишь повод создать комнату, на клиенте не сохраняется
 * (без localStorage, TDD §5).
 *
 * @returns {JSX.Element}
 */
export default function StartScreen() {
  const navigate = useNavigate();

  // Создаём комнату с новым уникальным id и переходим на её URL без имени —
  // имя вводится отдельным шагом на экране комнаты (US-4).
  const handleCreateRoom = () => {
    const roomId = nanoid(8);
    navigate(`/room/${roomId}`);
  };

  return (
    <EntryScreen
      title="Видеочат-комната"
      byline="от Fora Soft"
      caption="Мгновенный групповой видеозвонок в браузере. Без регистрации и установок — просто введите название комнаты."
      placeholder="Введите название комнаты"
      submitLabel="Создать комнату"
      onSubmit={handleCreateRoom}
    />
  );
}
