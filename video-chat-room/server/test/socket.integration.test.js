import { test, describe, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { Server as SocketIOServer } from 'socket.io';
import { io as ioClient } from 'socket.io-client';
import { registerRoomHandlers } from '../src/roomHandlers.js';
import { registerSignalingHandlers } from '../src/signaling.js';
import { registerChatHandlers } from '../src/chat.js';
import { roomRegistry } from '../src/rooms.js';

/**
 * Integration-тесты сокет-слоя (задача 23, TDD §6/§11; PRD F-05/F-12/F-18).
 * socket.io-client против тестового сервера с реальными обработчиками
 * (room/signaling/chat). Проверяем сквозной контракт §6: join→joined, лимит/full,
 * relay чата и сигналинга, peer-left при выходе/обрыве.
 */

/** @type {http.Server} */
let httpServer;
/** @type {SocketIOServer} */
let ioServer;
let port;

/** Клиенты, поднятые в текущем тесте (для гарантированной очистки). */
const clients = [];

before(async () => {
  httpServer = http.createServer();
  ioServer = new SocketIOServer(httpServer);
  // То же подключение обработчиков, что и в index.js (задачи 5/6/7/8).
  ioServer.on('connection', (socket) => {
    registerRoomHandlers(ioServer, socket);
    registerSignalingHandlers(ioServer, socket);
    registerChatHandlers(ioServer, socket);
  });
  await new Promise((resolve) => httpServer.listen(0, resolve));
  port = httpServer.address().port;
});

after(async () => {
  ioServer.close();
  await new Promise((resolve) => httpServer.close(resolve));
});

afterEach(async () => {
  await Promise.all(clients.splice(0).map(disconnectClient));
  // Состояние комнат — общий singleton; сбрасываем между тестами для изоляции.
  roomRegistry.rooms.clear();
});

/** Уникальный roomId на тест (изоляция состояния). */
const uniqueRoom = () => `room-${randomUUID()}`;

/** Новый клиент-сокет (отдельное соединение). */
function connect() {
  const socket = ioClient(`http://localhost:${port}`, {
    transports: ['websocket'],
    forceNew: true,
  });
  clients.push(socket);
  return socket;
}

/** Промис «соединение установлено». */
function waitConnected(socket) {
  return new Promise((resolve, reject) => {
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
  });
}

/** Ждёт событие, удовлетворяющее предикату (по умолчанию — любое). */
function waitForEvent(socket, event, predicate = () => true) {
  return new Promise((resolve) => {
    const handler = (data) => {
      if (predicate(data)) {
        socket.off(event, handler);
        resolve(data);
      }
    };
    socket.on(event, handler);
  });
}

/** Корректно отключает клиента. */
function disconnectClient(socket) {
  return new Promise((resolve) => {
    if (socket.connected) {
      socket.once('disconnect', () => resolve());
      socket.disconnect();
    } else {
      socket.close();
      resolve();
    }
  });
}

/** Подключается, входит в комнату и ждёт `room:joined`. */
async function joinRoom({ roomId, name, title } = {}) {
  const socket = connect();
  await waitConnected(socket);
  socket.emit('room:join', { roomId, name, title });
  const joined = await waitForEvent(socket, 'room:joined');
  return { socket, joined };
}

describe('room:join → room:joined (§6, F-01/F-04)', () => {
  test('первый участник: selfId, пустой состав и история, название комнаты', async () => {
    const roomId = uniqueRoom();
    const { socket, joined } = await joinRoom({ roomId, name: 'Алекс', title: 'Планёрка' });

    assert.equal(joined.selfId, socket.id);
    assert.deepEqual(joined.members, []);
    assert.deepEqual(joined.history, []);
    assert.equal(joined.title, 'Планёрка');
  });

  test('второй участник получает состав; первый — room:peer-joined и системное сообщение', async () => {
    const roomId = uniqueRoom();
    const a = await joinRoom({ roomId, name: 'A' });

    const peerJoined = waitForEvent(a.socket, 'room:peer-joined');
    const sysJoin = waitForEvent(
      a.socket,
      'chat:message',
      (m) => m.type === 'system' && m.text.includes('присоединил'),
    );

    const b = await joinRoom({ roomId, name: 'B' });

    assert.equal(b.joined.members.length, 1);
    assert.equal(b.joined.members[0].name, 'A');
    assert.equal(b.joined.members[0].socketId, a.socket.id);

    const peer = await peerJoined;
    assert.equal(peer.socketId, b.socket.id);
    assert.equal(peer.name, 'B');

    const sys = await sysJoin;
    assert.match(sys.text, /присоединил/);
  });

  test('новичок видит предыдущую переписку в history (F-14)', async () => {
    const roomId = uniqueRoom();
    const a = await joinRoom({ roomId, name: 'A' });

    a.socket.emit('chat:send', { text: 'до тебя' });
    await waitForEvent(a.socket, 'chat:message', (m) => m.type === 'user');

    const b = await joinRoom({ roomId, name: 'B' });
    const userMessages = b.joined.history.filter((m) => m.type === 'user');
    assert.equal(userMessages.length, 1);
    assert.equal(userMessages[0].text, 'до тебя');
  });
});

describe('лимит комнаты (F-05, US-5)', () => {
  test('5-й участник получает room:full', async () => {
    const roomId = uniqueRoom();
    for (let i = 0; i < 4; i += 1) {
      await joinRoom({ roomId, name: `U${i}` });
    }

    const fifth = connect();
    await waitConnected(fifth);
    fifth.emit('room:join', { roomId, name: 'Fifth' });

    const full = await waitForEvent(fifth, 'room:full');
    assert.equal(full.roomId, roomId);
  });
});

describe('relay чата (F-12, US-8)', () => {
  test('chat:send рассылается всем участникам комнаты', async () => {
    const roomId = uniqueRoom();
    const a = await joinRoom({ roomId, name: 'A' });
    const b = await joinRoom({ roomId, name: 'B' });

    const aGot = waitForEvent(a.socket, 'chat:message', (m) => m.type === 'user');
    const bGot = waitForEvent(b.socket, 'chat:message', (m) => m.type === 'user');

    a.socket.emit('chat:send', { text: 'привет' });
    const [ma, mb] = await Promise.all([aGot, bGot]);

    assert.equal(ma.type, 'user');
    assert.equal(ma.name, 'A');
    assert.equal(ma.text, 'привет');
    assert.equal(mb.text, 'привет');
  });

  test('пустое сообщение отклоняется server:error (п. 24)', async () => {
    const roomId = uniqueRoom();
    const a = await joinRoom({ roomId, name: 'A' });

    const err = waitForEvent(a.socket, 'server:error');
    a.socket.emit('chat:send', { text: '   ' });
    const result = await err;
    assert.equal(result.code, 'EMPTY_MESSAGE');
  });
});

describe('relay сигналинга (F-06, §7.1)', () => {
  test('signal:offer пересылается адресату с подстановкой from', async () => {
    const roomId = uniqueRoom();
    const a = await joinRoom({ roomId, name: 'A' });
    const b = await joinRoom({ roomId, name: 'B' });

    const offerGot = waitForEvent(b.socket, 'signal:offer');
    a.socket.emit('signal:offer', { to: b.socket.id, sdp: { type: 'offer', sdp: 'x' } });

    const offer = await offerGot;
    assert.equal(offer.from, a.socket.id);
    assert.deepEqual(offer.sdp, { type: 'offer', sdp: 'x' });
  });

  test('signal:ice пересылается адресату с from', async () => {
    const roomId = uniqueRoom();
    const a = await joinRoom({ roomId, name: 'A' });
    const b = await joinRoom({ roomId, name: 'B' });

    const iceGot = waitForEvent(b.socket, 'signal:ice');
    a.socket.emit('signal:ice', { to: b.socket.id, candidate: { candidate: 'c1' } });

    const ice = await iceGot;
    assert.equal(ice.from, a.socket.id);
    assert.deepEqual(ice.candidate, { candidate: 'c1' });
  });

  test('сигналинг НЕ пересекает границы комнат (defense-in-depth)', async () => {
    const a = await joinRoom({ roomId: uniqueRoom(), name: 'A' });
    const c = await joinRoom({ roomId: uniqueRoom(), name: 'C' });

    const received = waitForEvent(c.socket, 'signal:offer').then(() => 'received');
    const timeout = new Promise((resolve) => setTimeout(() => resolve('timeout'), 200));

    a.socket.emit('signal:offer', { to: c.socket.id, sdp: { type: 'offer', sdp: 'x' } });
    assert.equal(await Promise.race([received, timeout]), 'timeout');
  });
});

describe('media:state (US-7/US-12)', () => {
  test('состав по умолчанию приходит с включёнными микрофоном и камерой', async () => {
    const roomId = uniqueRoom();
    await joinRoom({ roomId, name: 'A' });
    const b = await joinRoom({ roomId, name: 'B' });

    assert.equal(b.joined.members[0].audioEnabled, true);
    assert.equal(b.joined.members[0].videoEnabled, true);
  });

  test('изменение ретранслируется остальным в комнате с from', async () => {
    const roomId = uniqueRoom();
    const a = await joinRoom({ roomId, name: 'A' });
    const b = await joinRoom({ roomId, name: 'B' });

    const got = waitForEvent(b.socket, 'media:state');
    a.socket.emit('media:state', { audioEnabled: false, videoEnabled: false });

    const state = await got;
    assert.equal(state.from, a.socket.id);
    assert.equal(state.audioEnabled, false);
    assert.equal(state.videoEnabled, false);
  });

  test('поздний участник получает актуальные флаги в room:joined', async () => {
    const roomId = uniqueRoom();
    const a = await joinRoom({ roomId, name: 'A' });

    // A выключил камеру до входа B; короткая пауза — сервер успел записать состояние
    // в реестр (своего media:state отправитель не получает, ждать нечего).
    a.socket.emit('media:state', { audioEnabled: true, videoEnabled: false });
    await new Promise((r) => setTimeout(r, 100));

    const b = await joinRoom({ roomId, name: 'B' });
    const memberA = b.joined.members.find((m) => m.socketId === a.socket.id);
    assert.equal(memberA.audioEnabled, true);
    assert.equal(memberA.videoEnabled, false);
  });
});

describe('выход и обрыв (F-18, US-10/US-11)', () => {
  test('disconnect → room:peer-left и системное сообщение остальным', async () => {
    const roomId = uniqueRoom();
    const a = await joinRoom({ roomId, name: 'A' });
    const b = await joinRoom({ roomId, name: 'B' });
    const bId = b.socket.id;

    const left = waitForEvent(a.socket, 'room:peer-left', (d) => d.socketId === bId);
    const sysLeave = waitForEvent(
      a.socket,
      'chat:message',
      (m) => m.type === 'system' && m.text.includes('покинул'),
    );

    b.socket.disconnect();

    assert.equal((await left).socketId, bId);
    assert.match((await sysLeave).text, /покинул комнату/);
  });

  test('room:leave освобождает слот: после выхода снова можно войти 4-м', async () => {
    const roomId = uniqueRoom();
    const members = [];
    for (let i = 0; i < 4; i += 1) {
      members.push(await joinRoom({ roomId, name: `U${i}` }));
    }

    // Один выходит явно — слот освобождается.
    const left = waitForEvent(members[0].socket, 'disconnect');
    members[1].socket.emit('room:leave');
    await waitForEvent(members[0].socket, 'room:peer-left');
    void left;

    // Новый участник снова помещается (лимит снова не превышен).
    const late = connect();
    await waitConnected(late);
    late.emit('room:join', { roomId, name: 'Late' });
    const joined = await waitForEvent(late, 'room:joined');
    assert.equal(joined.members.length, 3);
  });
});
