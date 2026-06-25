import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { RoomRegistry } from '../src/rooms.js';

/**
 * Unit-тесты `RoomRegistry` (задача 21, TDD §11; PRD F-05, п. 9, US-5/US-10).
 * Покрывают критичный путь: атомарный лимит ≤4, жизненный цикл комнаты,
 * кольцевой буфер истории, изоляцию снимков состава/истории.
 *
 * Раннер — встроенный `node:test` (без внешних зависимостей).
 */

/** Сокращение для участника (вход). */
const member = (socketId, name = `user-${socketId}`) => ({ socketId, name });

/** Ожидаемый снимок участника до media:state (камера/микрофон off, как у клиента). */
const snap = (socketId, name = `user-${socketId}`) => ({
  socketId,
  name,
  audioEnabled: false,
  videoEnabled: false,
});

/** Минимальное сообщение для истории. */
const msg = (id, text = `m${id}`) => ({ id, type: 'user', name: 'A', text, ts: id });

describe('RoomRegistry.joinRoom', () => {
  /** @type {RoomRegistry} */
  let registry;

  beforeEach(() => {
    registry = new RoomRegistry({ maxMembers: 4, chatHistoryCap: 200 });
  });

  test('создаёт комнату при первом входе по новому id (PRD п. 5, US-4)', () => {
    assert.equal(registry.hasRoom('r1'), false);

    const result = registry.joinRoom('r1', member('s1'));

    assert.equal(result.ok, true);
    assert.equal(registry.hasRoom('r1'), true);
    assert.equal(registry.getMemberCount('r1'), 1);
    assert.deepEqual(result.members, [snap('s1')]);
  });

  test('название комнаты задаёт создатель; последующие входы его не меняют', () => {
    const created = registry.joinRoom('r1', member('s1'), 'Планёрка');
    assert.equal(created.title, 'Планёрка');

    // Второй участник присылает своё название — оно игнорируется.
    const joined = registry.joinRoom('r1', member('s2'), 'Чужое название');
    assert.equal(joined.title, 'Планёрка');
  });

  test('допускает одинаковые имена, различая участников по socketId (US-1)', () => {
    registry.joinRoom('r1', member('s1', 'Алекс'));
    const result = registry.joinRoom('r1', member('s2', 'Алекс'));

    assert.equal(result.ok, true);
    assert.equal(registry.getMemberCount('r1'), 2);
    const names = result.members.map((m) => m.name);
    assert.deepEqual(names, ['Алекс', 'Алекс']);
  });

  test('атомарно соблюдает лимит ≤4: 5-й вход отклоняется (F-05, US-5)', () => {
    for (const id of ['s1', 's2', 's3', 's4']) {
      assert.equal(registry.joinRoom('r1', member(id)).ok, true);
    }
    assert.equal(registry.getMemberCount('r1'), 4);

    const fifth = registry.joinRoom('r1', member('s5'));
    assert.deepEqual(fifth, { ok: false, reason: 'full' });
    // Отказ без побочных эффектов — состав не изменился.
    assert.equal(registry.getMemberCount('r1'), 4);
  });

  test('уважает кастомный maxMembers из конструктора', () => {
    const small = new RoomRegistry({ maxMembers: 2 });
    assert.equal(small.joinRoom('r', member('a')).ok, true);
    assert.equal(small.joinRoom('r', member('b')).ok, true);
    assert.equal(small.joinRoom('r', member('c')).ok, false);
  });

  test('возвращает копию состава (мутация снаружи не влияет на реестр)', () => {
    registry.joinRoom('r1', member('s1'));
    const result = registry.joinRoom('r1', member('s2'));

    result.members.push({ socketId: 'hacker', name: 'x' });
    assert.equal(registry.getMemberCount('r1'), 2);
  });
});

describe('RoomRegistry.leaveRoom', () => {
  /** @type {RoomRegistry} */
  let registry;

  beforeEach(() => {
    registry = new RoomRegistry({ maxMembers: 4 });
  });

  test('удаляет участника и возвращает обновлённый состав', () => {
    registry.joinRoom('r1', member('s1'));
    registry.joinRoom('r1', member('s2'));

    const result = registry.leaveRoom('r1', 's1');

    assert.equal(result.roomDeleted, false);
    assert.deepEqual(result.members, [snap('s2')]);
    assert.equal(registry.getMemberCount('r1'), 1);
  });

  test('удаляет комнату и историю при выходе последнего (PRD п. 9, US-10)', () => {
    registry.joinRoom('r1', member('s1'));
    registry.addMessage('r1', msg(1));

    const result = registry.leaveRoom('r1', 's1');

    assert.equal(result.roomDeleted, true);
    assert.deepEqual(result.members, []);
    assert.equal(registry.hasRoom('r1'), false);
    // История удалена вместе с комнатой.
    assert.deepEqual(registry.getHistory('r1'), []);
  });

  test('повторный вход по тому же id создаёт новую пустую комнату (US-10)', () => {
    registry.joinRoom('r1', member('s1'), 'Старая');
    registry.addMessage('r1', msg(1, 'привет'));
    registry.leaveRoom('r1', 's1');

    const result = registry.joinRoom('r1', member('s2'), 'Новая');
    assert.equal(result.title, 'Новая');
    assert.deepEqual(registry.getHistory('r1'), []);
    assert.equal(registry.getMemberCount('r1'), 1);
  });

  test('безопасный no-op для несуществующей комнаты', () => {
    const result = registry.leaveRoom('missing', 's1');
    assert.deepEqual(result, { roomDeleted: false, members: [] });
  });

  test('идемпотентность: повторный выход того же сокета не падает', () => {
    registry.joinRoom('r1', member('s1'));
    registry.joinRoom('r1', member('s2'));
    registry.leaveRoom('r1', 's1');
    // Повторный leave того же сокета (room:leave + disconnect) безопасен.
    const result = registry.leaveRoom('r1', 's1');
    assert.equal(result.roomDeleted, false);
    assert.equal(registry.getMemberCount('r1'), 1);
  });
});

describe('RoomRegistry история чата (capping, TDD §9)', () => {
  test('addMessage добавляет сообщение и возвращает его', () => {
    const registry = new RoomRegistry();
    registry.joinRoom('r1', member('s1'));

    const m = msg(1, 'hi');
    assert.equal(registry.addMessage('r1', m), m);
    assert.deepEqual(registry.getHistory('r1'), [m]);
  });

  test('addMessage в несуществующую комнату → null', () => {
    const registry = new RoomRegistry();
    assert.equal(registry.addMessage('missing', msg(1)), null);
  });

  test('кольцевой буфер хранит последние N сообщений', () => {
    const registry = new RoomRegistry({ chatHistoryCap: 3 });
    registry.joinRoom('r1', member('s1'));

    for (let i = 1; i <= 5; i += 1) {
      registry.addMessage('r1', msg(i));
    }

    const history = registry.getHistory('r1');
    assert.equal(history.length, 3);
    assert.deepEqual(
      history.map((m) => m.id),
      [3, 4, 5],
    );
  });

  test('getHistory возвращает копию (мутация снаружи не влияет на реестр)', () => {
    const registry = new RoomRegistry();
    registry.joinRoom('r1', member('s1'));
    registry.addMessage('r1', msg(1));

    const history = registry.getHistory('r1');
    history.push(msg(2));
    assert.equal(registry.getHistory('r1').length, 1);
  });

  test('getHistory несуществующей комнаты → пустой массив', () => {
    const registry = new RoomRegistry();
    assert.deepEqual(registry.getHistory('missing'), []);
  });
});

describe('RoomRegistry getters', () => {
  test('getMembers возвращает копию состава или []', () => {
    const registry = new RoomRegistry();
    assert.deepEqual(registry.getMembers('missing'), []);

    registry.joinRoom('r1', member('s1'));
    const members = registry.getMembers('r1');
    assert.deepEqual(members, [snap('s1')]);
    members.push({ socketId: 'x', name: 'x' });
    assert.equal(registry.getMemberCount('r1'), 1);
  });

  test('roomCount отражает число активных комнат', () => {
    const registry = new RoomRegistry();
    assert.equal(registry.roomCount, 0);
    registry.joinRoom('a', member('s1'));
    registry.joinRoom('b', member('s2'));
    assert.equal(registry.roomCount, 2);
    registry.leaveRoom('a', 's1');
    assert.equal(registry.roomCount, 1);
  });

  test('getMemberCount несуществующей комнаты → 0', () => {
    const registry = new RoomRegistry();
    assert.equal(registry.getMemberCount('missing'), 0);
  });
});

describe('RoomRegistry.setMediaState (US-7/US-12)', () => {
  test('обновляет флаги микрофона/камеры в снимке состава', () => {
    const registry = new RoomRegistry();
    registry.joinRoom('r1', member('s1'));

    const ok = registry.setMediaState('r1', 's1', { audioEnabled: false, videoEnabled: false });

    assert.equal(ok, true);
    assert.deepEqual(registry.getMembers('r1'), [
      { socketId: 's1', name: 'user-s1', audioEnabled: false, videoEnabled: false },
    ]);
  });

  test('приводит значения к boolean (тонкий relay)', () => {
    const registry = new RoomRegistry();
    registry.joinRoom('r1', member('s1'));

    registry.setMediaState('r1', 's1', { audioEnabled: 0, videoEnabled: 'yes' });

    const [m] = registry.getMembers('r1');
    assert.equal(m.audioEnabled, false);
    assert.equal(m.videoEnabled, true);
  });

  test('no-op для несуществующей комнаты/участника', () => {
    const registry = new RoomRegistry();
    assert.equal(registry.setMediaState('missing', 's1', {}), false);
    registry.joinRoom('r1', member('s1'));
    assert.equal(registry.setMediaState('r1', 'ghost', {}), false);
  });
});
