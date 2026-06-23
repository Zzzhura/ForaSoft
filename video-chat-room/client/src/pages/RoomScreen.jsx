import { useState } from 'react';
import { useParams, useLocation } from 'react-router-dom';
import EntryScreen from '../components/EntryScreen.jsx';
import CopyLinkButton from '../components/CopyLinkButton.jsx';

/**
 * Экран комнаты. Задача 14: чтение `roomId` из URL и вход по ссылке-приглашению.
 * Имя приходит из `StartScreen` через router state; при прямом открытии ссылки
 * state пуст — показываем экран ввода имени (PRD F-04, US-4). Перезагрузка теряет
 * router state → повторный ввод имени, что соответствует «новый вход» (PRD п. 28).
 *
 * Полная оркестрация (медиа + сигналинг + сетка + чат) — задача 18.
 *
 * @returns {JSX.Element}
 */
export default function RoomScreen() {
  const { roomId } = useParams();
  const location = useLocation();
  const [name, setName] = useState(location.state?.name ?? null);

  // Вход по ссылке без переданного имени — запрашиваем имя перед входом (US-4).
  if (!name) {
    return (
      <EntryScreen
        title="Видеочат-комната"
        byline="от Fora Soft"
        caption="Введите имя, чтобы присоединиться к звонку."
        placeholder="Введите ваше имя"
        submitLabel="Войти"
        onSubmit={setName}
      />
    );
  }

  // Заглушка экрана комнаты — полная реализация в задаче 18.
  return (
    <main className="screen">
      <h1>Комната: {roomId}</h1>
      <p>Вы вошли как: {name}</p>
      <CopyLinkButton />
      <p>Экран комнаты — заглушка каркаса. Реализация в задаче 18.</p>
    </main>
  );
}
