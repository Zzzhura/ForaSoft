import { randomUUID } from 'node:crypto';
import { roomRegistry } from './rooms.js';
import { validateMessage } from './validation.js';

/**
 * Чат и системные события (TDD §6, §8, §9; PRD F-12…F-15, US-8/US-9).
 *
 * Единый источник построения и рассылки сообщений чата:
 *  - пользовательские сообщения (`chat:send` → `chat:message`);
 *  - системные сообщения о входе/выходе участников (`type:'system'`).
 *
 * Каждое сообщение пишется в историю комнаты через `RoomRegistry.addMessage`,
 * который сам ограничивает её кольцевым буфером (cap `CHAT_HISTORY_CAP`, §9),
 * поэтому поздний участник видит прошлую переписку (F-14), а память не растёт.
 */

/**
 * Системное сообщение чата (вход/выход участника, F-15, US-9). Текст формируется
 * на сервере из уже экранированного имени, поэтому безопасен для вывода.
 * @param {string} text
 * @returns {import('./rooms.js').Message}
 */
export const createSystemMessage = (text) => ({
  id: randomUUID(),
  type: 'system',
  text,
  ts: Date.now(),
});

/**
 * Пользовательское сообщение чата (F-12/F-13). `name` и `text` уже прошли
 * валидацию/экранирование (см. validation.js), время фиксируется сервером —
 * клиент форматирует HH:MM по локали при рендере.
 * @param {string} name  Отображаемое имя отправителя.
 * @param {string} text  Экранированный текст сообщения.
 * @returns {import('./rooms.js').Message}
 */
export const createUserMessage = (name, text) => ({
  id: randomUUID(),
  type: 'user',
  name,
  text,
  ts: Date.now(),
});

/**
 * Сохраняет системное сообщение в историю комнаты и рассылает его всем
 * участникам (F-15, US-9). Используется обработчиками входа/выхода (задачи 5/6).
 *
 * @param {import('socket.io').Server} io
 * @param {string} roomId
 * @param {string} text  Готовый текст (имя должно быть уже экранировано).
 * @returns {import('./rooms.js').Message}
 */
export function emitSystemMessage(io, roomId, text) {
  const message = createSystemMessage(text);
  roomRegistry.addMessage(roomId, message);
  io.to(roomId).emit('chat:message', message);
  return message;
}

/**
 * Регистрирует обработчик чата для одного сокета (TDD §6.1, §8).
 *
 * Поток `chat:send` (PRD F-12/F-13, п. 24/39/40, US-8):
 *  1. отправитель должен состоять в комнате (`socket.data.roomId`, задача 5);
 *  2. валидация текста (непустой, ≤ лимита, HTML-экранирование, задача 4);
 *  3. построение `Message{type:'user'}` с серверным `ts`;
 *  4. запись в историю (cap, §9) и broadcast `chat:message` всем в комнате.
 *
 * @param {import('socket.io').Server} io
 * @param {import('socket.io').Socket} socket
 */
export function registerChatHandlers(io, socket) {
  socket.on('chat:send', (payload = {}) => {
    const roomId = socket.data.roomId;
    if (!roomId) {
      // Сокет не в комнате (не прошёл room:join) — отправлять некуда.
      socket.emit('server:error', {
        code: 'INTERNAL',
        message: 'Вы не находитесь в комнате',
      });
      return;
    }

    const result = validateMessage(payload.text);
    if (!result.ok) {
      socket.emit('server:error', { code: result.code, message: result.message });
      return;
    }

    const message = createUserMessage(socket.data.name, result.value);
    roomRegistry.addMessage(roomId, message);
    io.to(roomId).emit('chat:message', message);
  });
}
