/**
 * Сигналинг WebRTC: «тонкий» relay SDP-офферов/ответов и ICE-кандидатов между
 * клиентами (PRD F-06, US-6; TDD §4.2, §6, §7.1).
 *
 * Сервер НЕ разбирает содержимое SDP/ICE — он лишь пересылает payload адресату
 * `to`, подставляя `from = socket.id`, чтобы получатель знал, с кем устанавливать
 * P2P-соединение. Медиа идёт напрямую между пирами (DTLS-SRTP), минуя сервер.
 */

/** Разумный потолок длины socketId-адресата (защита от мусорного ввода). */
const MAX_TARGET_ID_LEN = 128;

/**
 * Нормализует идентификатор адресата `to` из payload клиента.
 * @param {unknown} raw
 * @returns {string} нормализованный socketId или '' если ввод некорректен.
 */
const normalizeTarget = (raw) =>
  typeof raw === 'string' ? raw.trim().slice(0, MAX_TARGET_ID_LEN) : '';

/**
 * Регистрирует обработчики сигналинга для одного сокета (TDD §6.1, §7.1).
 *
 * Контракт C→S → S→C:
 *  - `signal:offer`  `{ to, sdp }`       → `signal:offer`  `{ from, sdp }`
 *  - `signal:answer` `{ to, sdp }`       → `signal:answer` `{ from, sdp }`
 *  - `signal:ice`    `{ to, candidate }` → `signal:ice`    `{ from, candidate }`
 *
 * Relay выполняется только в пределах одной комнаты: адресат должен состоять в
 * той же комнате, что и отправитель. Это отсекает попытки слать сигналинг
 * сокетам из чужих комнат (defense-in-depth поверх отсутствия авторизации).
 *
 * @param {import('socket.io').Server} io
 * @param {import('socket.io').Socket} socket
 */
export function registerSignalingHandlers(io, socket) {
  /**
   * Пересылает сигнальное событие адресату `to`, если он в той же комнате.
   * @param {string} event имя события (`signal:offer` | `signal:answer` | `signal:ice`)
   * @param {object} payload входящий payload от клиента (содержит `to`)
   * @param {object} forwarded поля для пересылки адресату (без `to`)
   */
  const relay = (event, payload, forwarded) => {
    const to = normalizeTarget(payload?.to);
    if (!to) {
      return; // некорректный адресат — молча игнорируем (сигналинг идёмпотентен)
    }

    const roomId = socket.data.roomId;
    const target = io.sockets.sockets.get(to);
    // Адресат должен существовать и быть в той же комнате, что и отправитель.
    if (!roomId || !target || target.data.roomId !== roomId) {
      return;
    }

    io.to(to).emit(event, { from: socket.id, ...forwarded });
  };

  socket.on('signal:offer', (payload = {}) =>
    relay('signal:offer', payload, { sdp: payload.sdp }),
  );

  socket.on('signal:answer', (payload = {}) =>
    relay('signal:answer', payload, { sdp: payload.sdp }),
  );

  socket.on('signal:ice', (payload = {}) =>
    relay('signal:ice', payload, { candidate: payload.candidate }),
  );
}
