import { roomRegistry } from './rooms.js';
import { validateName, sanitizeRoomTitle } from './validation.js';
import { emitSystemMessage } from './chat.js';

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
 *     остальным участникам комнаты;
 *  4. системное сообщение «<имя> присоединился к комнате» в чат (F-15, US-9).
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
    // Название комнаты задаёт только создатель; у входящих по ссылке оно пустое и
    // игнорируется (комната уже создана). Санитизация — тот же XSS-щит (п. 39).
    const title = sanitizeRoomTitle(payload.title);

    // Атомарная проверка лимита и вставка (см. RoomRegistry.joinRoom, задача 3).
    const join = roomRegistry.joinRoom(roomId, { socketId: socket.id, name }, title);
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
      // Название комнаты (создателя) — источник истины на сервере (F-14 late-joiner).
      title: join.title,
    });

    // Остальным — что появился новый участник (триггер offer по правилу initiator, §7.1).
    socket.to(roomId).emit('room:peer-joined', { socketId: socket.id, name });

    // Системное сообщение в чат + история (F-15, US-9). Добавляется после room:joined,
    // поэтому в выданную новичку историю не попадает — он видит его как live-событие.
    emitSystemMessage(io, roomId, `${name} присоединился к комнате`);
  });

  // Явный выход и обрыв соединения обрабатываются одинаково (PRD F-18, US-10/US-11):
  // не различаем «вышел» и «потерял соединение».
  socket.on('room:leave', () => handleLeave(io, socket));
  socket.on('disconnect', () => handleLeave(io, socket));
}

/**
 * Выводит участника из комнаты по выходу или обрыву (TDD §7.2).
 * Идемпотентна: повторный вызов (например, `room:leave`, а следом `disconnect`)
 * безопасен, т.к. после первого вызова `socket.data.roomId` очищается.
 *
 * Если комната опустела — `RoomRegistry` удаляет её вместе с историей (задача 3),
 * оповещать некого. Иначе оставшимся уходит `room:peer-left` и системное
 * сообщение «<имя> покинул комнату» (единая формулировка, F-18).
 *
 * @param {import('socket.io').Server} io
 * @param {import('socket.io').Socket} socket
 */
function handleLeave(io, socket) {
  const roomId = socket.data.roomId;
  if (!roomId) {
    return; // сокет не состоял в комнате (или уже обработан)
  }
  const name = socket.data.name;

  const { roomDeleted } = roomRegistry.leaveRoom(roomId, socket.id);
  socket.leave(roomId);
  // Сбрасываем данные, чтобы парный disconnect не сработал повторно.
  delete socket.data.roomId;
  delete socket.data.name;

  if (roomDeleted) {
    return; // комната и история удалены — оповещать некого
  }

  // Плитка участника исчезает у остальных (F-17).
  io.to(roomId).emit('room:peer-left', { socketId: socket.id });

  // Системное сообщение в чат + история (F-15, US-9); late-joiner увидит его (F-14).
  emitSystemMessage(io, roomId, `${name} покинул комнату`);
}
