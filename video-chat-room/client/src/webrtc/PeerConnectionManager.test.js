import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { PeerConnectionManager, DEFAULT_RTC_CONFIG } from './PeerConnectionManager.js';

/**
 * Unit-тесты `PeerConnectionManager` (задача 22, TDD §4.3/§7.1/§11; PRD F-06/F-07/F-09/F-10,
 * US-5/US-6/US-7/US-11). `RTCPeerConnection` подменяется моком, моделирующим perfect
 * negotiation: `onnegotiationneeded`, направления трансиверов и `setLocalDescription()`
 * без аргумента (авто-offer/answer). Проверяем порождение offer, разрешение glare по
 * роли polite/impolite, relay сигналинга, буферизацию ICE, тумблеры и колбэки UI.
 */

/** Дать резолвнуться микрозадачам/таймерам (negotiation→setLocalDescription→sendSignal). */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Мок `RTCPeerConnection` с моделью переговоров: addTrack/addTransceiver/смена
 * `direction` ставят флаг negotiation-needed и асинхронно зовут `onnegotiationneeded`;
 * `setLocalDescription()` без аргумента сам выбирает offer (из stable) или answer (из
 * have-remote-offer); по достижении stable `currentDirection` трансиверов фиксируется.
 */
class MockRTCPeerConnection {
  /** @type {MockRTCPeerConnection[]} */
  static instances = [];

  constructor(config) {
    this.config = config;
    this.localDescription = null;
    this.remoteDescription = null;
    this.connectionState = 'new';
    this.signalingState = 'stable';
    this.onicecandidate = null;
    this.ontrack = null;
    this.onconnectionstatechange = null;
    this.oniceconnectionstatechange = null;
    this.onnegotiationneeded = null;
    this.closed = false;
    this.addedIceCandidates = [];
    this.senders = [];
    this.transceivers = [];
    /** @type {{ track: object | null }[]} Приёмники (отдельно от senders). */
    this.receivers = [];
    this._negScheduled = false;
    MockRTCPeerConnection.instances.push(this);
  }

  /** Однократно (на тик) сигналим, что нужна (ре)negotiation. */
  #scheduleNegotiation() {
    if (this._negScheduled) return;
    this._negScheduled = true;
    queueMicrotask(() => {
      this._negScheduled = false;
      this.onnegotiationneeded?.();
    });
  }

  #makeSender(track = null) {
    const sender = {
      track,
      replaceTrack: vi.fn((next) => {
        sender.track = next;
        return Promise.resolve();
      }),
    };
    this.senders.push(sender);
    return sender;
  }

  #makeTransceiver(kind, direction, sender) {
    const self = this;
    const tx = {
      kind,
      _direction: direction,
      currentDirection: null,
      sender,
      get direction() {
        return this._direction;
      },
      set direction(value) {
        if (value === this._direction) return;
        this._direction = value;
        self.#scheduleNegotiation();
      },
      stop: vi.fn(function stop() {
        tx._direction = 'stopped';
        tx.currentDirection = 'stopped';
      }),
    };
    this.transceivers.push(tx);
    return tx;
  }

  addTrack(track) {
    const sender = this.#makeSender(track);
    this.#makeTransceiver(track.kind, 'sendrecv', sender);
    this.#scheduleNegotiation();
    return sender;
  }

  addTransceiver(kind, opts) {
    const sender = this.#makeSender(null);
    const tx = this.#makeTransceiver(kind, opts?.direction ?? 'sendrecv', sender);
    this.#scheduleNegotiation();
    return tx;
  }

  getTransceivers() {
    return this.transceivers;
  }

  getReceivers() {
    return this.receivers;
  }

  #applyStable() {
    for (const tx of this.transceivers) {
      if (tx._direction !== 'stopped') tx.currentDirection = tx._direction;
    }
  }

  // Без аргумента: offer из stable, answer из have-remote-offer (perfect negotiation).
  setLocalDescription(desc) {
    const type = desc?.type ?? (this.signalingState === 'have-remote-offer' ? 'answer' : 'offer');
    this.localDescription = { type, sdp: `${type}-sdp` };
    if (type === 'offer') {
      this.signalingState = 'have-local-offer';
    } else {
      this.signalingState = 'stable';
      this.#applyStable();
    }
    return Promise.resolve();
  }

  setRemoteDescription(desc) {
    this.remoteDescription = desc;
    if (desc?.type === 'offer') {
      // SRD(offer) из have-local-offer = неявный rollback нашего offer (perfect neg.).
      this.signalingState = 'have-remote-offer';
    } else {
      this.signalingState = 'stable';
      this.#applyStable();
    }
    return Promise.resolve();
  }

  addIceCandidate(candidate) {
    this.addedIceCandidates.push(candidate);
    return Promise.resolve();
  }

  close() {
    this.closed = true;
  }
}

/** Минимальный мок `MediaStream` (в node/jsdom его нет): копит дорожки. */
class MockMediaStream {
  constructor(tracks = []) {
    this._tracks = [...tracks];
  }
  getTracks() {
    return this._tracks;
  }
  addTrack(track) {
    this._tracks.push(track);
  }
}

/** Фейковый локальный поток с настраиваемым набором дорожек. */
function fakeLocalStream({ audio = true, video = true } = {}) {
  const tracks = [];
  if (audio) tracks.push({ kind: 'audio', enabled: true });
  if (video) tracks.push({ kind: 'video', enabled: true });
  return {
    getAudioTracks: () => tracks.filter((t) => t.kind === 'audio'),
    getVideoTracks: () => tracks.filter((t) => t.kind === 'video'),
  };
}

/** Собирает PCM с мок-колбэками для удобства тестов. */
function makePCM(overrides = {}) {
  const callbacks = {
    sendSignal: vi.fn(),
    onRemoteStream: vi.fn(),
    onPeerLeft: vi.fn(),
    onPeerState: vi.fn(),
  };
  const pcm = new PeerConnectionManager({
    selfId: 'a',
    localStream: fakeLocalStream(),
    ...callbacks,
    ...overrides,
  });
  return { pcm, ...callbacks, ...overrides };
}

/** Доводит соединение до stable: ждёт первичный offer и подаёт answer. */
async function settle(pcm, socketId) {
  await flush();
  await pcm.handleAnswer(socketId, { type: 'answer', sdp: 'ans' });
  await flush();
}

beforeEach(() => {
  MockRTCPeerConnection.instances = [];
  globalThis.RTCPeerConnection = MockRTCPeerConnection;
  globalThis.MediaStream = MockMediaStream;
});

afterEach(() => {
  delete globalThis.RTCPeerConnection;
  delete globalThis.MediaStream;
});

describe('правило initiator (роли polite/impolite, 10.1, §7.1)', () => {
  test('initiator — участник с лексикографически меньшим socketId', () => {
    const { pcm } = makePCM({ selfId: 'b' });
    expect(pcm.isInitiator('c')).toBe(true); // 'b' < 'c'
    expect(pcm.isInitiator('a')).toBe(false); // 'b' > 'a'
  });

  test('addPeer порождает offer через onnegotiationneeded', async () => {
    const { pcm, sendSignal } = makePCM({ selfId: 'a' });
    pcm.addPeer('b');
    await flush();
    expect(sendSignal).toHaveBeenCalledWith('offer', 'b', {
      sdp: { type: 'offer', sdp: 'offer-sdp' },
    });
  });
});

describe('addPeer', () => {
  test('идемпотентна: повторный вызов не создаёт второе соединение', () => {
    const { pcm } = makePCM();
    const pc1 = pcm.addPeer('b');
    const pc2 = pcm.addPeer('b');
    expect(pc1).toBe(pc2);
    expect(MockRTCPeerConnection.instances).toHaveLength(1);
  });

  test('использует Google STUN из конфигурации по умолчанию', () => {
    const { pcm } = makePCM();
    pcm.addPeer('b');
    const [pc] = MockRTCPeerConnection.instances;
    expect(pc.config).toEqual(DEFAULT_RTC_CONFIG);
    expect(pc.config.iceServers[0].urls).toContain('stun:stun.l.google.com:19302');
  });

  test('добавляет локальные дорожки (audio+video) в соединение', () => {
    const { pcm } = makePCM();
    pcm.addPeer('b');
    const [pc] = MockRTCPeerConnection.instances;
    // Один sender на аудио, один на видео.
    expect(pc.senders).toHaveLength(2);
  });

  test('без видеодорожки: recvonly video-трансивер (принимать чужое видео)', () => {
    const { pcm } = makePCM({ selfId: 'a', localStream: fakeLocalStream({ video: false }) });
    pcm.addPeer('b');
    const [pc] = MockRTCPeerConnection.instances;
    expect(pc.transceivers.some((t) => t.kind === 'video' && t.direction === 'recvonly')).toBe(
      true,
    );
  });

  test('без локального потока: recvonly audio + recvonly video', () => {
    const { pcm } = makePCM({ selfId: 'a', localStream: null });
    pcm.addPeer('b');
    const [pc] = MockRTCPeerConnection.instances;
    expect(pc.transceivers).toHaveLength(2);
    expect(pc.transceivers.some((t) => t.kind === 'audio' && t.direction === 'recvonly')).toBe(
      true,
    );
    expect(pc.transceivers.some((t) => t.kind === 'video' && t.direction === 'recvonly')).toBe(
      true,
    );
  });
});

describe('relay сигналинга', () => {
  test('handleOffer ставит remote, отвечает answer', async () => {
    const { pcm, sendSignal } = makePCM({ selfId: 'z' });
    await pcm.handleOffer('a', { type: 'offer', sdp: 'x' });

    const [pc] = MockRTCPeerConnection.instances;
    expect(pc.remoteDescription).toEqual({ type: 'offer', sdp: 'x' });
    expect(sendSignal).toHaveBeenCalledWith('answer', 'a', {
      sdp: { type: 'answer', sdp: 'answer-sdp' },
    });
  });

  test('handleAnswer применяет remote description', async () => {
    const { pcm } = makePCM({ selfId: 'a' });
    pcm.addPeer('b');
    await flush();
    await pcm.handleAnswer('b', { type: 'answer', sdp: 'y' });

    const [pc] = MockRTCPeerConnection.instances;
    expect(pc.remoteDescription).toEqual({ type: 'answer', sdp: 'y' });
  });

  test('handleAnswer для неизвестного peer — безопасный no-op', async () => {
    const { pcm } = makePCM();
    await expect(pcm.handleAnswer('ghost', { type: 'answer', sdp: 'y' })).resolves.toBeUndefined();
  });

  test('onicecandidate шлёт ICE адресату; пустой candidate игнорируется', () => {
    const { pcm, sendSignal } = makePCM({ selfId: 'z' });
    pcm.addPeer('a');
    const [pc] = MockRTCPeerConnection.instances;

    pc.onicecandidate({ candidate: { candidate: 'cand-1' } });
    expect(sendSignal).toHaveBeenCalledWith('ice', 'a', { candidate: { candidate: 'cand-1' } });

    sendSignal.mockClear();
    pc.onicecandidate({ candidate: null });
    expect(sendSignal).not.toHaveBeenCalledWith('ice', 'a', expect.anything());
  });
});

describe('буферизация ICE-кандидатов', () => {
  test('кандидаты до remoteDescription буферизуются и применяются после', async () => {
    const { pcm } = makePCM({ selfId: 'z' });
    pcm.addPeer('a');
    const [pc] = MockRTCPeerConnection.instances;

    // remoteDescription ещё нет → кандидат буферизуется, не применяется.
    await pcm.handleIce('a', { candidate: 'early' });
    expect(pc.addedIceCandidates).toHaveLength(0);

    // Приходит offer → setRemoteDescription → flush буфера.
    await pcm.handleOffer('a', { type: 'offer', sdp: 'x' });
    expect(pc.addedIceCandidates).toContainEqual({ candidate: 'early' });
  });

  test('кандидат после remoteDescription применяется сразу', async () => {
    const { pcm } = makePCM({ selfId: 'z' });
    await pcm.handleOffer('a', { type: 'offer', sdp: 'x' });
    const [pc] = MockRTCPeerConnection.instances;

    await pcm.handleIce('a', { candidate: 'late' });
    expect(pc.addedIceCandidates).toContainEqual({ candidate: 'late' });
  });
});

describe('perfect negotiation (glare)', () => {
  test('impolite (initiator) игнорирует встречный offer при коллизии', async () => {
    const { pcm, sendSignal } = makePCM({ selfId: 'a' }); // 'a' < 'b' → impolite
    pcm.addPeer('b');
    await flush(); // наш offer в полёте → have-local-offer
    sendSignal.mockClear();

    await pcm.handleOffer('b', { type: 'offer', sdp: 'theirs' });
    // Наш offer победит — встречный игнорируем, answer не шлём.
    expect(sendSignal.mock.calls.some(([type]) => type === 'answer')).toBe(false);
  });

  test('polite (не-initiator) принимает встречный offer и отвечает answer', async () => {
    const { pcm, sendSignal } = makePCM({ selfId: 'z' }); // 'z' > 'a' → polite
    pcm.addPeer('a');
    await flush(); // наш offer в полёте → have-local-offer
    sendSignal.mockClear();

    await pcm.handleOffer('a', { type: 'offer', sdp: 'theirs' });
    const [pc] = MockRTCPeerConnection.instances;
    // Неявный rollback + приём чужого offer + answer.
    expect(pc.remoteDescription).toEqual({ type: 'offer', sdp: 'theirs' });
    expect(sendSignal).toHaveBeenCalledWith('answer', 'a', {
      sdp: { type: 'answer', sdp: 'answer-sdp' },
    });
  });
});

describe('колбэки UI', () => {
  test('ontrack собирает входящие дорожки в один поток участника (onRemoteStream)', () => {
    const { pcm, onRemoteStream } = makePCM();
    pcm.addPeer('b');
    const [pc] = MockRTCPeerConnection.instances;

    // event.streams игнорируем (msid ненадёжен) — копим по getReceivers().
    const audio = { kind: 'audio' };
    const video = { kind: 'video' };
    pc.receivers.push({ track: audio });
    pc.ontrack({ track: audio, streams: [] });
    pc.receivers.push({ track: video });
    pc.ontrack({ track: video, streams: [] });

    expect(onRemoteStream).toHaveBeenCalledTimes(2);
    const stream = onRemoteStream.mock.calls[1][1];
    expect(stream.getTracks()).toEqual([audio, video]);
  });

  test('живой video-receiver попадает в remoteStream ещё до unmute (US-5/US-6)', () => {
    // Дорожка нового участника muted, пока не пошли кадры — но она уже должна быть
    // в потоке, чтобы `<video>` отрисовал кадры в момент unmute, а не остался чёрным.
    const { pcm, onRemoteStream } = makePCM();
    pcm.addPeer('b');
    const [pc] = MockRTCPeerConnection.instances;

    const audio = { kind: 'audio' };
    const mutedVideo = { kind: 'video', muted: true, readyState: 'live' };
    pc.receivers.push({ track: audio }, { track: mutedVideo });
    pc.ontrack({ track: audio, streams: [] });

    const stream = onRemoteStream.mock.calls.at(-1)[1];
    const tracks = typeof stream.getTracks === 'function' ? stream.getTracks() : [];
    expect(tracks.filter((t) => t.kind === 'video')).toHaveLength(1);
    expect(tracks.filter((t) => t.kind === 'audio')).toHaveLength(1);
  });

  test('из нескольких video-receiver предпочитается размьюченный', () => {
    const { pcm, onRemoteStream } = makePCM();
    pcm.addPeer('b');
    const [pc] = MockRTCPeerConnection.instances;

    const audio = { kind: 'audio' };
    const mutedVideo = { kind: 'video', muted: true, readyState: 'live' };
    const liveVideo = { kind: 'video', muted: false, readyState: 'live' };
    pc.receivers.push({ track: audio }, { track: mutedVideo }, { track: liveVideo });
    pc.ontrack({ track: audio, streams: [] });

    const stream = onRemoteStream.mock.calls.at(-1)[1];
    const video = stream.getTracks().filter((t) => t.kind === 'video');
    expect(video).toEqual([liveVideo]);
  });

  test('onconnectionstatechange сообщает failed (деградация, задача 20)', () => {
    const { pcm, onPeerState } = makePCM();
    pcm.addPeer('b');
    const [pc] = MockRTCPeerConnection.instances;

    pc.connectionState = 'failed';
    pc.onconnectionstatechange();
    expect(onPeerState).toHaveBeenCalledWith('b', 'failed');
  });
});

describe('тумблеры камеры и закрытие', () => {
  test('первое включение камеры (recvonly): replaceTrack + переход в sendrecv + offer (US-6)', async () => {
    // Вход без камеры → recvonly video-трансивер. Включение камеры ставит дорожку и
    // переводит направление в sendrecv: это запускает renegotiation (offer), которая
    // надёжно доставляет видео второй стороне (а не «холодный» replaceTrack).
    const localStream = fakeLocalStream({ video: false });
    const { pcm, sendSignal } = makePCM({ selfId: 'a', localStream });
    pcm.localStream = localStream;
    pcm.addPeer('b');
    await settle(pcm, 'b');
    sendSignal.mockClear();

    const [pc] = MockRTCPeerConnection.instances;
    const videoTx = pc.transceivers.find((t) => t.kind === 'video');
    const newTrack = { kind: 'video' };
    pcm.replaceVideoTrack(newTrack);
    await flush();

    expect(videoTx.sender.replaceTrack).toHaveBeenCalledWith(newTrack);
    expect(videoTx.direction).toBe('sendrecv');
    expect(sendSignal).toHaveBeenCalledWith('offer', 'b', {
      sdp: { type: 'offer', sdp: 'offer-sdp' },
    });
  });

  test('смена камеры при уже включённом видео — лёгкий replaceTrack без offer', async () => {
    const { pcm, sendSignal } = makePCM({ selfId: 'a' }); // камера включена на входе
    pcm.addPeer('b');
    await settle(pcm, 'b');
    sendSignal.mockClear();

    const [pc] = MockRTCPeerConnection.instances;
    const videoTx = pc.transceivers.find((t) => t.kind === 'video');
    const newTrack = { kind: 'video' };
    pcm.replaceVideoTrack(newTrack);
    await flush();

    expect(videoTx.sender.replaceTrack).toHaveBeenCalledWith(newTrack);
    expect(sendSignal.mock.calls.some(([type]) => type === 'offer')).toBe(false);
  });

  test('выключение камеры — replaceTrack(null), без offer', async () => {
    const { pcm, sendSignal } = makePCM({ selfId: 'a' });
    pcm.addPeer('b');
    await settle(pcm, 'b');
    sendSignal.mockClear();

    const [pc] = MockRTCPeerConnection.instances;
    const videoSender = pc.senders[1]; // [audio, video]
    pcm.replaceVideoTrack(null);
    await flush();

    expect(videoSender.replaceTrack).toHaveBeenCalledWith(null);
    expect(sendSignal.mock.calls.some(([type]) => type === 'offer')).toBe(false);
  });

  test('setAudioEnabled переключает enabled общей аудиодорожки (mute, §7.3)', () => {
    const localStream = fakeLocalStream();
    const { pcm } = makePCM({ localStream });

    pcm.setAudioEnabled(false);
    expect(localStream.getAudioTracks()[0].enabled).toBe(false);
    pcm.setAudioEnabled(true);
    expect(localStream.getAudioTracks()[0].enabled).toBe(true);
  });

  test('removePeer закрывает соединение, дергает onPeerLeft и идемпотентна', () => {
    const { pcm, onPeerLeft } = makePCM();
    pcm.addPeer('b');
    const [pc] = MockRTCPeerConnection.instances;

    pcm.removePeer('b');
    expect(pc.closed).toBe(true);
    expect(onPeerLeft).toHaveBeenCalledWith('b');

    onPeerLeft.mockClear();
    pcm.removePeer('b'); // повторно — no-op
    expect(onPeerLeft).not.toHaveBeenCalled();
  });

  test('closeAll закрывает все соединения и очищает реестр', () => {
    const { pcm } = makePCM();
    pcm.addPeer('b');
    pcm.addPeer('c');
    pcm.closeAll();

    expect(MockRTCPeerConnection.instances.every((pc) => pc.closed)).toBe(true);
    // Повторный addPeer после closeAll создаёт новое соединение (реестр пуст).
    pcm.addPeer('b');
    expect(MockRTCPeerConnection.instances).toHaveLength(3);
  });
});
