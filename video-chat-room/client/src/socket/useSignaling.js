import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';

/**
 * Хук сигнального канала на socket.io-client (TDD §4.2, §6, §8; PRD п. 35, US-13).
 *
 * Единая точка связи клиента с сервером: устанавливает соединение, отслеживает его
 * состояние, принимает события состава/чата/сигналинга (§6.2) и предоставляет
 * методы их отправки (§6.1). Поверх него работают `PeerConnectionManager` (через
 * `sendSignal`) и UI чата/комнаты — оркестрация собирается в задаче 18 (RoomScreen).
 *
 * Адрес сервера. В dev Socket.io проксируется Vite на тот же origin (`/socket.io`,
 * см. vite.config.js), в проде статика и сокет отдаются одним процессом — поэтому по
 * умолчанию подключаемся к текущему origin (без явного URL). Переопределяется через
 * `VITE_SERVER_URL`, только если сервер живёт на другом адресе.
 *
 * Без auto-reconnect (`reconnection: false`, PRD F-18, US-11): обрыв = выход, сервер
 * освобождает слот по `disconnect`, возврат — только ручным повторным входом. Это
 * соответствует решению «автопереподключение не выполняется».
 *
 * Обработчики событий передаются через `handlers` и читаются из ref на момент
 * прихода события, поэтому смена коллбэков между рендерами НЕ пересоздаёт сокет
 * (соединение поднимается один раз за время жизни компонента).
 *
 * @typedef {'connecting'|'connected'|'error'} SignalingStatus
 *
 * @typedef {Object} SignalingHandlers
 * @property {(data: { selfId: string, members: Array<{socketId:string,name:string}>, history: Array, title: string }) => void} [onJoined]      `room:joined` — успешный вход (состав без себя + история + название комнаты, F-14).
 * @property {(data: { roomId: string }) => void} [onRoomFull]        `room:full` — лимит 4 исчерпан (US-5).
 * @property {(data: { socketId: string, name: string }) => void} [onPeerJoined]  `room:peer-joined` — новый участник (триггер mesh-offer, §7.1).
 * @property {(data: { socketId: string }) => void} [onPeerLeft]      `room:peer-left` — участник вышел/отключился (US-10/US-11).
 * @property {(message: { id:string, type:'user'|'system', name?:string, text:string, ts:number }) => void} [onChatMessage] `chat:message` — новое сообщение (user/system).
 * @property {(data: { from: string, sdp: object }) => void} [onSignalOffer]   `signal:offer` (relay).
 * @property {(data: { from: string, sdp: object }) => void} [onSignalAnswer]  `signal:answer` (relay).
 * @property {(data: { from: string, candidate: object }) => void} [onSignalIce]  `signal:ice` (relay).
 * @property {(data: { code: string, message: string }) => void} [onServerError]  `server:error` — ошибка валидации/сервера.
 *
 * @param {SignalingHandlers} [handlers]
 * @returns {{
 *   status: SignalingStatus,
 *   connected: boolean,
 *   serverError: boolean,
 *   joinRoom: (roomId: string, name: string) => void,
 *   leaveRoom: () => void,
 *   sendChat: (text: string) => void,
 *   sendSignal: (type: 'offer'|'answer'|'ice', to: string, payload: object) => void,
 * }}
 */
export function useSignaling(handlers = {}) {
  // 'connecting' — сокет ещё не подключился; 'connected' — есть связь;
  // 'error' — connect_error (сервер недоступен, PRD п. 35 → баннер в задаче 19).
  const [status, setStatus] = useState('connecting');

  // Актуальные коллбэки без пересоздания сокета: обновляем ref на каждый рендер,
  // listener'ы читают из него на момент события (без stale-closure).
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  /** @type {React.MutableRefObject<import('socket.io-client').Socket | null>} */
  const socketRef = useRef(null);

  useEffect(() => {
    const url = import.meta.env.VITE_SERVER_URL || undefined;
    const socket = io(url, {
      // Возврат только вручную (PRD F-18): транспортный reconnect отключён, чтобы
      // обрыв надёжно приводил к выходу, а не к «тихому» восстановлению без rejoin.
      reconnection: false,
      // По умолчанию ws с fallback на polling; на одном origin CORS не мешает.
    });
    socketRef.current = socket;

    // --- Жизненный цикл соединения ---
    socket.on('connect', () => setStatus('connected'));
    // Сервер недоступен/сигналинг не поднялся (PRD п. 35, US-13).
    socket.on('connect_error', () => setStatus('error'));
    // Обрыв уже установленного соединения: тоже трактуем как ошибку связи —
    // звонок не продолжить без сокета, UI покажет баннер (задача 19).
    socket.on('disconnect', () => setStatus('error'));

    // --- Состав комнаты / чат / сигналинг (§6.2) ---
    // Каждый listener делегирует в актуальный коллбэк из ref (если задан).
    const forward = (event, key) => {
      socket.on(event, (data) => handlersRef.current[key]?.(data));
    };
    forward('room:joined', 'onJoined');
    forward('room:full', 'onRoomFull');
    forward('room:peer-joined', 'onPeerJoined');
    forward('room:peer-left', 'onPeerLeft');
    forward('chat:message', 'onChatMessage');
    forward('signal:offer', 'onSignalOffer');
    forward('signal:answer', 'onSignalAnswer');
    forward('signal:ice', 'onSignalIce');
    forward('server:error', 'onServerError');

    return () => {
      // Размонтирование (выход из комнаты): закрываем сокет → сервер обработает
      // disconnect как выход участника (роль room:leave, см. roomHandlers.js).
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  // --- Отправка событий C→S (§6.1) ---
  // Все эмиттеры безопасны до подключения: socket.io буферизует исходящие события
  // и отправит их после установления связи.

  /**
   * Вход в комнату: `room:join {roomId, name, title}` (F-01/F-04).
   * `title` — название комнаты от создателя; у входящих по ссылке пустое (сервер
   * игнорирует его для уже существующей комнаты).
   * @param {string} roomId
   * @param {string} name
   * @param {string} [title]
   */
  const joinRoom = (roomId, name, title = '') => {
    socketRef.current?.emit('room:join', { roomId, name, title });
  };

  /** Явный выход: `room:leave` (F-17, US-10). */
  const leaveRoom = () => {
    socketRef.current?.emit('room:leave');
  };

  /** Отправка сообщения чата: `chat:send {text}` (F-12, US-8). */
  const sendChat = (text) => {
    socketRef.current?.emit('chat:send', { text });
  };

  /**
   * Отправка сигналинга адресату `to` (`signal:offer|answer|ice`, §6.1).
   * Сигнатура совместима с `PeerConnectionManager.sendSignal(type, to, payload)`.
   * @param {'offer'|'answer'|'ice'} type
   * @param {string} to socketId адресата
   * @param {object} payload `{ sdp }` для offer/answer, `{ candidate }` для ice
   */
  const sendSignal = (type, to, payload) => {
    socketRef.current?.emit(`signal:${type}`, { to, ...payload });
  };

  return {
    status,
    connected: status === 'connected',
    serverError: status === 'error',
    joinRoom,
    leaveRoom,
    sendChat,
    sendSignal,
  };
}
