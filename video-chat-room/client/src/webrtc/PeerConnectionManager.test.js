import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { PeerConnectionManager, DEFAULT_RTC_CONFIG } from './PeerConnectionManager.js';

/**
 * Unit-тесты `PeerConnectionManager` (задача 22, TDD §4.3/§7.1/§11; PRD F-06/F-07/F-09/F-10,
 * US-5/US-6/US-7/US-11). `RTCPeerConnection` подменяется моком — проверяем
 * детерминированное правило initiator (анти-glare), relay сигналинга, буферизацию
 * ICE, тумблеры и колбэки UI без реального WebRTC.
 */

/** Дать резолвнуться цепочке промисов (createOffer→setLocalDescription→sendSignal). */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Мок `RTCPeerConnection`: фиксирует вызовы и моментально резолвит SDP/ICE. */
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
    this.closed = false;
    this.addedIceCandidates = [];
    this.senders = [];
    this.transceivers = [];
    /** @type {{ track: object | null }[]} Приёмники (отдельно от senders). */
    this.receivers = [];
    MockRTCPeerConnection.instances.push(this);
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

  addTrack(track) {
    return this.#makeSender(track);
  }

  addTransceiver(kind, opts) {
    const transceiver = {
      kind,
      direction: opts?.direction,
      sender: this.#makeSender(null),
      stop: vi.fn(function stop() {
        transceiver.direction = 'stopped';
      }),
    };
    this.transceivers.push(transceiver);
    return transceiver;
  }

  getTransceivers() {
    return this.transceivers;
  }

  createOffer() {
    return Promise.resolve({ type: 'offer', sdp: 'offer-sdp' });
  }

  createAnswer() {
    return Promise.resolve({ type: 'answer', sdp: 'answer-sdp' });
  }

  setLocalDescription(desc) {
    this.localDescription = desc;
    return Promise.resolve();
  }

  setRemoteDescription(desc) {
    this.remoteDescription = desc;
    return Promise.resolve();
  }

  addIceCandidate(candidate) {
    this.addedIceCandidates.push(candidate);
    return Promise.resolve();
  }

  getReceivers() {
    return this.receivers;
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

beforeEach(() => {
  MockRTCPeerConnection.instances = [];
  globalThis.RTCPeerConnection = MockRTCPeerConnection;
  globalThis.MediaStream = MockMediaStream;
});

afterEach(() => {
  delete globalThis.RTCPeerConnection;
  delete globalThis.MediaStream;
});

describe('правило initiator (анти-glare, 10.1, §7.1)', () => {
  test('initiator — участник с лексикографически меньшим socketId', () => {
    const { pcm } = makePCM({ selfId: 'b' });
    expect(pcm.isInitiator('c')).toBe(true); // 'b' < 'c'
    expect(pcm.isInitiator('a')).toBe(false); // 'b' > 'a'
  });

  test('addPeer как initiator отправляет offer', async () => {
    const { pcm, sendSignal } = makePCM({ selfId: 'a' });
    pcm.addPeer('b'); // 'a' < 'b' → мы initiator
    await flush();

    expect(sendSignal).toHaveBeenCalledWith('offer', 'b', {
      sdp: { type: 'offer', sdp: 'offer-sdp' },
    });
  });

  test('addPeer как не-initiator offer НЕ отправляет', async () => {
    const { pcm, sendSignal } = makePCM({ selfId: 'z' });
    pcm.addPeer('a'); // 'z' > 'a' → ждём offer от 'a'
    await flush();

    const offerCalls = sendSignal.mock.calls.filter(([type]) => type === 'offer');
    expect(offerCalls).toHaveLength(0);
  });

  test('явный флаг initiator переопределяет правило', async () => {
    const { pcm, sendSignal } = makePCM({ selfId: 'z' });
    pcm.addPeer('a', { initiator: true });
    await flush();
    expect(sendSignal.mock.calls.some(([type]) => type === 'offer')).toBe(true);
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

  test('без видеодорожки: initiator и answerer — sendrecv video без дорожки', () => {
    const { pcm: pcmInit } = makePCM({ selfId: 'a', localStream: fakeLocalStream({ video: false }) });
    pcmInit.addPeer('b');
    const [pcInit] = MockRTCPeerConnection.instances;
    expect(pcInit.transceivers.some((t) => t.kind === 'video' && t.direction === 'sendrecv')).toBe(
      true,
    );

    MockRTCPeerConnection.instances = [];
    const { pcm: pcmAns } = makePCM({ selfId: 'z', localStream: fakeLocalStream({ video: false }) });
    pcmAns.addPeer('a', { initiator: false });
    const [pcAns] = MockRTCPeerConnection.instances;
    expect(pcAns.transceivers.some((t) => t.kind === 'video' && t.direction === 'sendrecv')).toBe(
      true,
    );
  });

  test('без локального потока: recvonly audio + sendrecv video', () => {
    const { pcm: pcmInit } = makePCM({ selfId: 'a', localStream: null });
    pcmInit.addPeer('b');
    const [pcInit] = MockRTCPeerConnection.instances;
    expect(pcInit.transceivers).toHaveLength(2);
    expect(pcInit.transceivers.some((t) => t.kind === 'audio' && t.direction === 'recvonly')).toBe(
      true,
    );
    expect(pcInit.transceivers.some((t) => t.kind === 'video' && t.direction === 'sendrecv')).toBe(
      true,
    );

    MockRTCPeerConnection.instances = [];
    const { pcm: pcmAns } = makePCM({ selfId: 'z', localStream: null });
    pcmAns.addPeer('a', { initiator: false });
    const [pcAns] = MockRTCPeerConnection.instances;
    expect(pcAns.transceivers).toHaveLength(2);
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
    pcm.addPeer('a', { initiator: false });
    const [pc] = MockRTCPeerConnection.instances;

    pc.onicecandidate({ candidate: { candidate: 'cand-1' } });
    expect(sendSignal).toHaveBeenCalledWith('ice', 'a', { candidate: { candidate: 'cand-1' } });

    sendSignal.mockClear();
    pc.onicecandidate({ candidate: null });
    expect(sendSignal).not.toHaveBeenCalled();
  });
});

describe('буферизация ICE-кандидатов', () => {
  test('кандидаты до remoteDescription буферизуются и применяются после', async () => {
    const { pcm } = makePCM({ selfId: 'z' });
    pcm.addPeer('a', { initiator: false });
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

describe('тумблеры и закрытие', () => {
  test('replaceVideoTrack меняет дорожку у video-sender каждого peer (тумблер камеры, §7.3)', async () => {
    const { pcm } = makePCM();
    pcm.addPeer('b');
    const [pc] = MockRTCPeerConnection.instances;
    const videoSender = pc.senders[1]; // [audio, video]

    const newTrack = { kind: 'video' };
    pcm.replaceVideoTrack(newTrack);
    await flush();
    expect(videoSender.replaceTrack).toHaveBeenCalledWith(newTrack);
  });

  test('replaceVideoTrack на пустом sendrecv — addTrack и offer (US-6)', async () => {
    const localStream = fakeLocalStream({ video: false });
    const { pcm, sendSignal } = makePCM({ localStream: fakeLocalStream({ video: false }) });
    pcm.localStream = localStream;
    pcm.addPeer('b');
    await flush();
    sendSignal.mockClear();

    const newTrack = { kind: 'video' };
    pcm.replaceVideoTrack(newTrack);
    await flush();
    await flush();

    const [pc] = MockRTCPeerConnection.instances;
    expect(pc.transceivers[0].stop).toHaveBeenCalled();
    expect(sendSignal).toHaveBeenCalledWith('offer', 'b', {
      sdp: { type: 'offer', sdp: 'offer-sdp' },
    });
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
