import { roomRegistry } from './rooms.js';
import { validateName } from './validation.js';

/** Разумный потолок длины идентификатора комнаты (защита от мусорного ввода). */
const MAX_ROOM_ID_LEN = 64;

/**
 * Нормализует roomId из клиента: строка, trim, ограничение длины.
 * Содержимое намеренно не ограничивается по символам — любой URL открывает или
 * создаёт комнату (PRD п. 5/6, US-4), авторизации нет.
 * @param {unknown} raw
 * @returns {string} нормализованный id или '' если ввод некорректен.
 */
const normalizeRoomId = (raw) =>
  typeof raw === 'string' ? raw.trim().slice(0, MAX_ROOM_ID_LEN) : '';

/**
 * Регистрирует обработчик входа в комнату для одного сокета (TDD §4.2, §6, §7.1).
 *
 * Поток `room:join` (PRD F-01/F-04/F-05, US-2/US-4/US-5):
 *  1. нормализация roomId + валидация имени (задача 4);
 *  2. атомарный `joinRoom` (задача 3) — лимит ≤ 4 проверяется без гонок;
 *  3. при отказе → `room:full`; при успехе → `room:joined` инициатору
 *     (его selfId, состав без него самого, история чата) и `room:peer-joined`
 *     остальным участникам комнаты.
 *
 * Системное чат-сообщение о входе добавляется отдельно в задаче 8.
 *
 * @param {import('socket.io').Server} io
 * @param {import('socket.io').Socket} socket
 */
export function registerRoomHandlers(io, socket) {
  socket.on('room:join', (payload = {}) => {
    const roomId = normalizeRoomId(payload.roomId);
    if (!roomId) {
      socket.emit('server:error', {
        code: 'INVALID_ROOM',
        message: 'Некорректный идентификатор комнаты',
      });
      return;
    }

    const nameResult = validateName(payload.name);
    if (!nameResult.ok) {
      socket.emit('server:error', { code: nameResult.code, message: nameResult.message });
      return;
    }
    const name = nameResult.value;

    // Атомарная проверка лимита и вставка (см. RoomRegistry.joinRoom, задача 3).
    const join = roomRegistry.joinRoom(roomId, { socketId: socket.id, name });
    if (!join.ok) {
      socket.emit('room:full', { roomId });
      return;
    }

    // Привязываем сокет к socket.io-комнате для адресной рассылки; данные о
    // комнате и имени понадобятся при выходе/обрыве (задача 6) и в чате (задача 8).
    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.name = name;

    // Инициатору — его id, состав БЕЗ него самого (для установления mesh) и история.
    const others = join.members.filter((m) => m.socketId !== socket.id);
    socket.emit('room:joined', {
      selfId: socket.id,
      members: others,
      history: roomRegistry.getHistory(roomId),
    });

    // Остальным — что появился новый участник (триггер offer по правилу initiator, §7.1).
    socket.to(roomId).emit('room:peer-joined', { socketId: socket.id, name });
  });
}
