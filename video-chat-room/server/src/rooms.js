import { config } from './config.js';

/**
 * @typedef {Object} Member
 * @property {string} socketId  Внутренний ID участника (socket.id), не показывается в UI.
 * @property {string} name      Отображаемое имя (может повторяться внутри комнаты).
 * @property {boolean} audioEnabled  Микрофон включён (для индикаторов у остальных, US-7).
 * @property {boolean} videoEnabled  Камера включена (для заглушки-силуэта у остальных, US-12).
 */

/**
 * @typedef {Object} Message
 * @property {string} id
 * @property {'user'|'system'} type
 * @property {string} [name]    Имя отправителя (для type==='user').
 * @property {string} text
 * @property {number} ts        Unix-время в мс.
 */

/**
 * @typedef {Object} Room
 * @property {string} id
 * @property {string} title      Название комнаты, заданное создателем (может быть пустым).
 * @property {Map<string, Member>} members
 * @property {Message[]} chatHistory
 */

/**
 * In-memory реестр комнат — единственный источник истины о составе и истории чата
 * (TDD §4.1, §5). Без БД и персистентности: комната живёт, пока в ней есть участники,
 * и удаляется вместе с историей чата при выходе последнего (PRD п. 9, US-10).
 *
 * Лимит участников и размер истории внедряются через конструктор (по умолчанию — из env),
 * что упрощает юнит-тесты (задача 21).
 */
export class RoomRegistry {
  /**
   * @param {{ maxMembers?: number, chatHistoryCap?: number }} [options]
   */
  constructor({ maxMembers = config.maxMembers, chatHistoryCap = config.chatHistoryCap } = {}) {
    /** Максимум участников в комнате (mesh → 4, PRD F-05). */
    this.maxMembers = maxMembers;
    /** Предел кольцевого буфера истории чата на комнату (TDD §9). */
    this.chatHistoryCap = chatHistoryCap;
    /** @type {Map<string, Room>} roomId → Room */
    this.rooms = new Map();
  }

  /**
   * Атомарно (в одном синхронном блоке, без `await` между проверкой и вставкой)
   * добавляет участника. Комната создаётся при первом входе по новому ID (PRD п. 5, US-4).
   * Если комната уже заполнена — отказ без побочных эффектов (PRD F-05/п. 8, US-5).
   *
   * @param {string} roomId
   * @param {Member} member
   * @param {string} [title]  Название комнаты; учитывается только при её создании.
   * @returns {{ ok: true, members: Member[], title: string } | { ok: false, reason: 'full' }}
   */
  joinRoom(roomId, member, title = '') {
    let room = this.rooms.get(roomId);
    if (!room) {
      // Новый/несуществующий ID → моментально создаём пустую комнату (подзадача 3.3).
      // Название задаёт создатель (первый участник); последующие входы его не меняют.
      room = { id: roomId, title, members: new Map(), chatHistory: [] };
      this.rooms.set(roomId, room);
    }

    // --- Критическая секция лимита: проверка и вставка без await между ними. ---
    // Только уже существовавшая комната может быть полной; свежесозданная всегда пуста.
    if (room.members.size >= this.maxMembers) {
      return { ok: false, reason: 'full' };
    }
    // Камера и микрофон по умолчанию включены (PRD п. 13); клиент уточнит реальное
    // состояние сразу после входа событием media:state (например, вход без устройств).
    room.members.set(member.socketId, {
      socketId: member.socketId,
      name: member.name,
      audioEnabled: true,
      videoEnabled: true,
    });
    // --- Конец критической секции. ---

    return { ok: true, members: this.#snapshotMembers(room), title: room.title };
  }

  /**
   * Удаляет участника. Когда комната опустела — удаляет её вместе с историей чата
   * (PRD п. 9, US-10). Для несуществующей комнаты — безопасный no-op.
   *
   * @param {string} roomId
   * @param {string} socketId
   * @returns {{ roomDeleted: boolean, members: Member[] }}
   */
  leaveRoom(roomId, socketId) {
    const room = this.rooms.get(roomId);
    if (!room) {
      return { roomDeleted: false, members: [] };
    }

    room.members.delete(socketId);

    if (room.members.size === 0) {
      this.rooms.delete(roomId);
      return { roomDeleted: true, members: [] };
    }

    return { roomDeleted: false, members: this.#snapshotMembers(room) };
  }

  /**
   * Обновляет состояние медиа участника (микрофон/камера). Источник истины для
   * поздних участников: их `room:joined` отдаёт уже актуальные флаги (US-7/US-12).
   * Для несуществующей комнаты/участника — безопасный no-op.
   *
   * @param {string} roomId
   * @param {string} socketId
   * @param {{ audioEnabled: boolean, videoEnabled: boolean }} state
   * @returns {boolean} true, если состояние обновлено.
   */
  setMediaState(roomId, socketId, state) {
    const member = this.rooms.get(roomId)?.members.get(socketId);
    if (!member) {
      return false;
    }
    member.audioEnabled = Boolean(state.audioEnabled);
    member.videoEnabled = Boolean(state.videoEnabled);
    return true;
  }

  /**
   * @param {string} roomId
   * @returns {Member[]} Снимок состава (копия) либо пустой массив.
   */
  getMembers(roomId) {
    const room = this.rooms.get(roomId);
    return room ? this.#snapshotMembers(room) : [];
  }

  /**
   * Добавляет сообщение в историю комнаты с кольцевым ограничением (хранятся
   * последние `chatHistoryCap` сообщений, TDD §9). Для несуществующей комнаты — no-op.
   *
   * @param {string} roomId
   * @param {Message} message  Полностью сформированное сообщение (id/ts генерирует вызывающий).
   * @returns {Message | null} Сохранённое сообщение или null, если комнаты нет.
   */
  addMessage(roomId, message) {
    const room = this.rooms.get(roomId);
    if (!room) {
      return null;
    }
    room.chatHistory.push(message);
    if (room.chatHistory.length > this.chatHistoryCap) {
      room.chatHistory.splice(0, room.chatHistory.length - this.chatHistoryCap);
    }
    return message;
  }

  /**
   * @param {string} roomId
   * @returns {Message[]} Копия истории (для F-14: поздний участник видит прошлую переписку).
   */
  getHistory(roomId) {
    const room = this.rooms.get(roomId);
    return room ? [...room.chatHistory] : [];
  }

  /**
   * @param {string} roomId
   * @returns {boolean}
   */
  hasRoom(roomId) {
    return this.rooms.has(roomId);
  }

  /**
   * @param {string} roomId
   * @returns {number} Число участников в комнате (0, если её нет).
   */
  getMemberCount(roomId) {
    const room = this.rooms.get(roomId);
    return room ? room.members.size : 0;
  }

  /** @returns {number} Число активных комнат (для диагностики/тестов). */
  get roomCount() {
    return this.rooms.size;
  }

  /**
   * @param {Room} room
   * @returns {Member[]} Свежий массив-копия участников (чтобы внешний код не мутировал Map).
   */
  #snapshotMembers(room) {
    return [...room.members.values()].map((m) => ({
      socketId: m.socketId,
      name: m.name,
      audioEnabled: m.audioEnabled,
      videoEnabled: m.videoEnabled,
    }));
  }
}

/** Разделяемый между socket-обработчиками экземпляр (задачи 5/6/8). */
export const roomRegistry = new RoomRegistry();
