import { useNavigate } from 'react-router-dom';
import { nanoid } from 'nanoid';
import EntryScreen from '../components/EntryScreen.jsx';

/**
 * Стартовый экран (задача 13): ввод имени (PRD п. 38, US-1) и создание комнаты
 * (PRD F-02, US-2). Имя живёт только в памяти текущей вкладки — без localStorage
 * (TDD §5) — и передаётся в `RoomScreen` через router state.
 *
 * @returns {JSX.Element}
 */
export default function StartScreen() {
  const navigate = useNavigate();

  /**
   * Создаёт комнату: генерирует `roomId` (nanoid(8), TDD §5) и переходит на её
   * URL, прокидывая нормализованное имя в state навигации (PRD F-02, US-2).
   *
   * @param {string} name - уже нормализованное имя из `EntryScreen`.
   */
  const handleCreateRoom = (name) => {
    const roomId = nanoid(8);
    navigate(`/room/${roomId}`, { state: { name } });
  };

  return (
    <EntryScreen
      title="Видеочат-комната"
      byline="от Fora Soft"
      caption="Мгновенный групповой видеозвонок в браузере. Без регистрации и установок — просто введите имя."
      placeholder="Введите название комнаты"
      submitLabel="Создать комнату"
      onSubmit={handleCreateRoom}
    />
  );
}
