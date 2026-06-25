/**
 * Менеджер mesh-соединений WebRTC (TDD §3, §4.3, §7.1, §13; PRD F-06/F-07, US-5/US-6/US-11).
 *
 * Держит по одному нативному `RTCPeerConnection` на каждого удалённого участника
 * (в полной комнате из 4 человек — до 3 одновременно). Используется нативный API
 * (TDD §14 TBD-4: «чистый» WebRTC, полный контроль над `replaceTrack`), без
 * обёрток вроде simple-peer.
 *
 * Анти-glare (10.1, §7.1): для каждой пары offer инициирует участник с
 * лексикографически меньшим `socketId`. Правило детерминировано и не зависит от
 * того, кто новичок, — это снимает гонку и двойные offer при одновременном входе.
 *
 * ICE-restart намеренно не выполняется (TDD §14 TBD-3): обрыв = выход, возврат
 * только вручную (PRD F-18). Недоступность STUN/строгий NAT деградирует отдельную
 * пару, но не валит остальные соединения (§13; обработка индикации — задача 20).
 */

/** ICE-конфигурация по умолчанию: публичные Google STUN (PRD §7, TDD §4.3). */
export const DEFAULT_RTC_CONFIG = {
  iceServers: [{ urls: ['stun:stun.l.google.com:19302'] }],
};

export class PeerConnectionManager {
  /**
   * @param {Object} options
   * @param {string} options.selfId  Собственный socketId (для правила initiator).
   * @param {MediaStream | null} options.localStream  Локальные дорожки (может быть null — нет устройств).
   * @param {(type: 'offer'|'answer'|'ice', to: string, payload: object) => void} options.sendSignal
   *        Отправка сигналинга наружу (маппится на socket-события `signal:*` в задаче 18).
   * @param {(socketId: string, stream: MediaStream) => void} options.onRemoteStream
   *        Появился/обновился удалённый поток — UI рисует плитку (10.2).
   * @param {(socketId: string) => void} [options.onPeerLeft]
   *        Соединение с участником закрыто (removePeer) — UI убирает плитку (10.2).
   * @param {(socketId: string, state: RTCPeerConnectionState) => void} [options.onPeerState]
   *        Сменилось состояние соединения пары (задача 20): UI показывает индикатор
   *        «соединение не установлено» при 'failed' (строгий NAT / STUN недоступен),
   *        не удаляя участника (TDD §13/§14 TBD-1).
   * @param {RTCConfiguration} [options.rtcConfig]  Переопределение ICE-конфига (тесты/env).
   */
  constructor({
    selfId,
    localStream,
    sendSignal,
    onRemoteStream,
    onPeerLeft,
    onPeerState,
    rtcConfig,
  }) {
    this.selfId = selfId;
    this.localStream = localStream ?? null;
    this.sendSignal = sendSignal;
    this.onRemoteStream = onRemoteStream;
    this.onPeerLeft = onPeerLeft;
    this.onPeerState = onPeerState;
    this.rtcConfig = rtcConfig ?? DEFAULT_RTC_CONFIG;

    /**
     * socketId → запись о соединении.
     * @type {Map<string, { pc: RTCPeerConnection, audioSender: RTCRtpSender | null,
     *                      videoSender: RTCRtpSender | null,
     *                      pendingCandidates: RTCIceCandidateInit[],
     *                      remoteStream: MediaStream | null }>}
     */
    this.peers = new Map();
  }

  /** @type {WeakSet<MediaStreamTrack>} дорожки с подписанным onunmute. */
  #unmuteHooked = new WeakSet();
  /** @type {Map<string, number>} отложенный resync remoteStream по socketId. */
  #resyncTimers = new Map();

  /**
   * Возвращает true, если этот клиент инициирует offer для пары с `peerId`
   * (детерминированное правило 10.1: меньший socketId — initiator).
   * @param {string} peerId
   * @returns {boolean}
   */
  isInitiator(peerId) {
    return this.selfId < peerId;
  }

  /**
   * Создаёт соединение с участником и (если мы initiator) отправляет offer.
   * Идемпотентна: повторный вызов для уже известного peer — no-op (защищает от
   * гонки room:joined/room:peer-joined и встречного offer).
   *
   * @param {string} socketId
   * @param {{ initiator?: boolean }} [opts] переопределение роли (по умолчанию — по правилу).
   * @returns {RTCPeerConnection}
   */
  addPeer(socketId, { initiator } = {}) {
    const existing = this.peers.get(socketId);
    if (existing) {
      return existing.pc;
    }

    const pc = new RTCPeerConnection(this.rtcConfig);
    const shouldOffer = initiator ?? this.isInitiator(socketId);
    const { audioSender, videoSender } = this.#attachLocalMedia(pc);
    const record = { pc, audioSender, videoSender, pendingCandidates: [], remoteStream: null };
    this.peers.set(socketId, record);

    // Локальные ICE-кандидаты → удалённому участнику через relay сервера.
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendSignal('ice', socketId, { candidate: event.candidate });
      }
    };

    // Удалённый поток → UI. Собираем СОБСТВЕННЫЙ поток участника и докладываем в
    // него каждую входящую дорожку (`event.track`), а не полагаемся на
    // `event.streams[0]` (msid): видеотрансивер, заведённый без дорожки (камера
    // выключена на момент negotiation), может прийти БЕЗ msid — тогда позже
    // включённая камера (replaceTrack без renegotiation) не попала бы в
    // отображаемый поток и плитка осталась бы чёрной. Дорожка-приёмник приходит
    // в ontrack уже на negotiation (sendrecv), кадры по ней начинают идти после
    // replaceTrack — `<video>` с этим потоком их подхватывает.
    pc.ontrack = () => {
      this.#scheduleStreamResync(socketId);
    };

    // Деградация без падения комнаты (задача 20, TDD §13): сбой ICE одной пары
    // (строгий NAT без TURN / STUN недоступен) переводит её connectionState в
    // 'failed'. Сообщаем UI для индикатора, но участника НЕ удаляем и остальные
    // соединения не трогаем — каждое pc независимо (TDD §14 TBD-1). ICE-restart
    // не делаем (TBD-3, PRD F-18: возврат только вручную).
    pc.onconnectionstatechange = () => {
      this.onPeerState?.(socketId, pc.connectionState);
      // После ICE/DTLS дорожки приёмника могут появиться без повторного ontrack
      // (sendrecv-трансивер с пустым sender при выключенной камере на старте).
      if (pc.connectionState === 'connected') {
        this.#scheduleStreamResync(socketId);
      }
    };

    if (shouldOffer) {
      // createOffer вызывается после добавления локальных дорожек/трансиверов,
      // чтобы m-секции попали в SDP. Ошибки не пробрасываем — не валим приложение.
      this.#makeOffer(socketId).catch((err) =>
        console.error(`[pcm] makeOffer failed for ${socketId}:`, err),
      );
    }

    return pc;
  }

  /**
   * Обрабатывает входящий offer: создаёт соединение при отсутствии (мы — не
   * initiator), ставит remote description, отвечает answer.
   * @param {string} socketId
   * @param {RTCSessionDescriptionInit} sdp
   */
  async handleOffer(socketId, sdp) {
    // Если pc ещё не создан (offer обогнал addPeer) — создаём как не-initiator.
    if (!this.peers.has(socketId)) {
      this.addPeer(socketId, { initiator: false });
    }
    const record = this.peers.get(socketId);
    if (!record) return;

    try {
      await record.pc.setRemoteDescription(sdp);
      await this.#flushCandidates(record);
      const answer = await record.pc.createAnswer();
      await record.pc.setLocalDescription(answer);
      this.#scheduleStreamResync(socketId);
      this.sendSignal('answer', socketId, { sdp: record.pc.localDescription });
    } catch (err) {
      console.error(`[pcm] handleOffer failed for ${socketId}:`, err);
    }
  }

  /**
   * Обрабатывает answer на наш offer.
   * @param {string} socketId
   * @param {RTCSessionDescriptionInit} sdp
   */
  async handleAnswer(socketId, sdp) {
    const record = this.peers.get(socketId);
    if (!record) return;
    try {
      await record.pc.setRemoteDescription(sdp);
      await this.#flushCandidates(record);
      this.#scheduleStreamResync(socketId);
    } catch (err) {
      console.error(`[pcm] handleAnswer failed for ${socketId}:`, err);
    }
  }

  /**
   * Добавляет удалённого ICE-кандидата. Кандидаты, пришедшие до установки remote
   * description, буферизуются и применяются после неё (частый порядок в mesh).
   * @param {string} socketId
   * @param {RTCIceCandidateInit} candidate
   */
  async handleIce(socketId, candidate) {
    const record = this.peers.get(socketId);
    if (!record || !candidate) return;

    if (record.pc.remoteDescription && record.pc.remoteDescription.type) {
      try {
        await record.pc.addIceCandidate(candidate);
      } catch (err) {
        console.error(`[pcm] addIceCandidate failed for ${socketId}:`, err);
      }
    } else {
      record.pendingCandidates.push(candidate);
    }
  }

  /**
   * Закрывает соединение с участником и уведомляет UI (`onPeerLeft`).
   * Идемпотентна. Вызывается в ответ на `room:peer-left` (задача 18).
   * @param {string} socketId
   */
  removePeer(socketId) {
    const record = this.peers.get(socketId);
    if (!record) return;

    this.#teardown(record.pc);
    this.peers.delete(socketId);
    this.onPeerLeft?.(socketId);
  }

  /**
   * Заменяет исходящую видеодорожку на всех соединениях. Пустой sendrecv-трансивер
   * (#attachLocalMedia) заменяем на addTrack + renegotiation — replaceTrack на
   * «пустой» m=video не размутит receiver у peer (US-6).
   * @param {MediaStreamTrack | null} track
   */
  replaceVideoTrack(track) {
    for (const [socketId, record] of this.peers) {
      if (track) {
        this.#enableOutboundVideo(socketId, record, track).catch((err) =>
          console.error('[pcm] replaceVideoTrack failed:', err),
        );
        continue;
      }
      this.#findOutboundVideoSender(record)
        ?.replaceTrack(null)
        .catch((err) => console.error('[pcm] replaceVideoTrack failed:', err));
    }
  }

  /**
   * Первое исходящее видео: addTrack + offer; далее — replaceTrack без renegotiation.
   * @param {string} socketId
   * @param {{ pc: RTCPeerConnection, videoSender: RTCRtpSender | null }} record
   * @param {MediaStreamTrack} track
   */
  async #enableOutboundVideo(socketId, record, track) {
    const stream = this.localStream;
    const outbound = this.#findOutboundVideoSender(record);
    if (outbound?.track) {
      await outbound.replaceTrack(track);
      return;
    }

    const emptyTx = record.pc
      .getTransceivers()
      .find((t) => t.kind === 'video' && !t.sender.track);
    if (emptyTx && stream) {
      emptyTx.stop();
      record.videoSender = record.pc.addTrack(track, stream);
      await this.#makeOffer(socketId);
      return;
    }

    const sender = this.#ensureOutboundVideoSender(record);
    await sender.replaceTrack(track);
  }

  /**
   * Заменяет исходящую аудиодорожку на всех соединениях без ре-negotiation
   * (смена устройства ввода — выбор микрофона). Используется при выборе другого
   * микрофона: новая дорожка подменяется в каждом sender.
   * @param {MediaStreamTrack | null} track
   */
  replaceAudioTrack(track) {
    for (const { audioSender } of this.peers.values()) {
      audioSender
        ?.replaceTrack(track)
        .catch((err) => console.error('[pcm] replaceAudioTrack failed:', err));
    }
  }

  /**
   * Включает/выключает исходящее аудио на всех соединениях через `track.enabled`
   * (mute без ре-negotiation, TDD §7.3 — задача 12). Все pc делят одну локальную
   * аудиодорожку, поэтому достаточно переключить её `enabled`.
   * @param {boolean} enabled
   */
  setAudioEnabled(enabled) {
    const audioTrack = this.localStream?.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = enabled;
    }
  }

  /** Закрывает все соединения (выход из комнаты, размонтирование — задача 17/18). */
  closeAll() {
    for (const { pc } of this.peers.values()) {
      this.#teardown(pc);
    }
    this.peers.clear();
  }

  // --- внутреннее ---

  /**
   * @param {RTCPeerConnection} pc
   * @returns {{ audioSender: RTCRtpSender | null, videoSender: RTCRtpSender | null }}
   */
  #attachLocalMedia(pc) {
    const stream = this.localStream;
    const audioTrack = stream?.getAudioTracks()[0] ?? null;
    const videoTrack = stream?.getVideoTracks()[0] ?? null;

    const audioSender = audioTrack
      ? pc.addTrack(audioTrack, stream)
      : pc.addTransceiver('audio', { direction: 'recvonly' }).sender;

    let videoSender = null;
    if (videoTrack) {
      videoSender = pc.addTrack(videoTrack, stream);
    } else {
      // sendrecv без дорожки: m=video в SDP с первого negotiation, позже replaceTrack
      // без renegotiation (TDD §7.3, US-6). recvonly ломает unmute receiver у peer.
      videoSender = pc.addTransceiver('video', { direction: 'sendrecv' }).sender;
    }

    return { audioSender, videoSender };
  }

  /**
   * Исходящий video-sender (sendrecv / addTrack). @param record
   * @returns {RTCRtpSender | null}
   */
  #findOutboundVideoSender(record) {
    const tx = record.pc.getTransceivers().find((t) => t.kind === 'video');
    if (tx) {
      return tx.sender;
    }
    if (record.videoSender) {
      return record.videoSender;
    }
    return null;
  }

  /**
   * Гарантирует sendrecv video-sender; при входе без камеры уже создан в #attachLocalMedia.
   * @param {{ pc: RTCPeerConnection, videoSender: RTCRtpSender | null }} record
   * @returns {RTCRtpSender}
   */
  #ensureOutboundVideoSender(record) {
    let outbound = this.#findOutboundVideoSender(record);
    if (!outbound) {
      outbound = record.pc.addTransceiver('video', { direction: 'sendrecv' }).sender;
    }
    record.videoSender = outbound;
    return outbound;
  }

  /**
   * Выбирает по одной актуальной входящей дорожке каждого kind из приёмников.
   * После renegotiation при позднем включении камеры может быть два video-receiver:
   * старый muted и новый с кадрами — оставляем unmuted.
   * @param {RTCPeerConnection} pc
   * @returns {MediaStreamTrack[]}
   */
  #pickReceiverTracks(pc) {
    /** @type {Map<string, MediaStreamTrack>} */
    const byKind = new Map();
    for (const { track } of pc.getReceivers()) {
      if (!track || track.readyState === 'ended') {
        continue;
      }
      const prev = byKind.get(track.kind);
      if (!prev || (prev.muted && !track.muted)) {
        byKind.set(track.kind, track);
      }
    }
    return [...byKind.values()];
  }

  /**
   * Собирает входящие дорожки всех RTCRtpReceiver в единый MediaStream участника.
   * Поток пересобирается целиком — без «залипших» muted-дорожек после renegotiation.
   * @param {string} socketId
   */
  #syncRemoteStreamTracks(socketId) {
    const record = this.peers.get(socketId);
    if (!record) return;

    this.#hookReceiverUnmute(socketId);

    const tracks = this.#pickReceiverTracks(record.pc);
    if (tracks.length === 0) return;

    const prevIds =
      record.remoteStream
        ?.getTracks()
        .map((t) => `${t.id}:${t.muted}`)
        .sort()
        .join(',') ?? '';
    const nextIds = tracks
      .map((t) => `${t.id}:${t.muted}`)
      .sort()
      .join(',');

    record.remoteStream = new MediaStream(tracks);

    if (prevIds !== nextIds) {
      this.onRemoteStream?.(socketId, record.remoteStream);
    }
  }

  /**
   * Повторный sync после renegotiation: unmuted receiver может появиться без
   * ontrack/onunmute (US-6, чёрная плитка при уже включённой камере у peer).
   * @param {string} socketId
   */
  #scheduleStreamResync(socketId) {
    const prev = this.#resyncTimers.get(socketId);
    if (prev) {
      clearTimeout(prev);
    }
    const run = () => this.#syncRemoteStreamTracks(socketId);
    run();
    queueMicrotask(run);
    this.#resyncTimers.set(
      socketId,
      setTimeout(() => {
        this.#resyncTimers.delete(socketId);
        run();
      }, 100),
    );
  }
  /**
   * Подписывает onunmute на все входящие дорожки приёмников (не только уже
   * попавшие в remoteStream). После renegotiation unmuted-трек может появиться
   * позже muted — без этого UI остаётся на чёрной плитке (US-6).
   * @param {string} socketId
   */
  #hookReceiverUnmute(socketId) {
    const record = this.peers.get(socketId);
    if (!record) return;

    for (const { track } of record.pc.getReceivers()) {
      if (!track || this.#unmuteHooked.has(track)) {
        continue;
      }
      this.#unmuteHooked.add(track);
      track.onunmute = () => {
        this.#syncRemoteStreamTracks(socketId);
      };
    }
  }

  /**
   * Создаёт и отправляет offer для соединения (мы — initiator).
   * @param {string} socketId
   */
  async #makeOffer(socketId) {
    const record = this.peers.get(socketId);
    if (!record) return;
    const { pc } = record;
    if (pc.signalingState && pc.signalingState !== 'stable') {
      console.warn(`[pcm] makeOffer skipped for ${socketId}: ${pc.signalingState}`);
      return;
    }
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.sendSignal('offer', socketId, { sdp: pc.localDescription });
  }

  /**
   * Применяет буферизованных ICE-кандидатов после установки remote description.
   * @param {{ pc: RTCPeerConnection, pendingCandidates: RTCIceCandidateInit[] }} record
   */
  async #flushCandidates(record) {
    const pending = record.pendingCandidates;
    record.pendingCandidates = [];
    for (const candidate of pending) {
      try {
        await record.pc.addIceCandidate(candidate);
      } catch (err) {
        console.error('[pcm] flush addIceCandidate failed:', err);
      }
    }
  }

  /**
   * Снимает обработчики и закрывает соединение (защита от утечек/коллбэков после close).
   * @param {RTCPeerConnection} pc
   */
  #teardown(pc) {
    pc.onicecandidate = null;
    pc.ontrack = null;
    pc.onconnectionstatechange = null;
    pc.close();
  }
}
