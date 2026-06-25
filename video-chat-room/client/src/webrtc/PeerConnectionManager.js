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
     *                      remoteStream: MediaStream | null,
     *                      remoteStreamSig: string, makingOffer: boolean }>}
     */
    this.peers = new Map();
  }

  /** @type {WeakSet<MediaStreamTrack>} дорожки с подписанным onunmute. */
  #unmuteHooked = new WeakSet();
  /** @type {Map<string, ReturnType<typeof setTimeout>[]>} resync-таймеры по socketId. */
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
   * Создаёт соединение с участником. Идемпотентна: повторный вызов для уже
   * известного peer — no-op (защищает от гонки room:joined/room:peer-joined).
   *
   * Первичный offer порождает браузер через `onnegotiationneeded` (после добавления
   * локальных дорожек/трансиверов), но шлёт его ТОЛЬКО initiator пары — peer с
   * лексикографически меньшим `socketId` (детерминированный анти-glare, 10.1). Второй
   * конец лишь отвечает. Камера согласуется как прогретый sendrecv-трансивер заранее,
   * поэтому её включение в звонке — replaceTrack без renegotiation, без повторных
   * offer'ов и без glare (US-5/US-6, §7.1).
   *
   * @param {string} socketId
   * @returns {RTCPeerConnection}
   */
  addPeer(socketId) {
    const existing = this.peers.get(socketId);
    if (existing) {
      return existing.pc;
    }

    const pc = new RTCPeerConnection(this.rtcConfig);
    const { audioSender, videoSender } = this.#attachLocalMedia(pc);
    const record = {
      pc,
      audioSender,
      videoSender,
      pendingCandidates: [],
      remoteStream: null,
      // Сигнатура набора входящих дорожек — чтобы пересоздавать стрим только при его
      // смене (а не на каждом resync/мигании muted).
      remoteStreamSig: '',
      // Наш offer в полёте — для детекта glare при renegotiation (включение камеры).
      makingOffer: false,
    };
    this.peers.set(socketId, record);

    // Локальные ICE-кандидаты → удалённому участнику через relay сервера.
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendSignal('ice', socketId, { candidate: event.candidate });
      }
    };

    // Браузер сам сигналит, что нужна negotiation (добавлены локальные дорожки на
    // входе). Offer шлёт ТОЛЬКО initiator пары (меньший socketId) — детерминированный
    // анти-glare (10.1): второй конец лишь отвечает, его медиа уезжает в answer (все
    // m-секции sendrecv). Тумблер камеры идёт через replaceTrack по уже согласованной
    // m=video БЕЗ renegotiation, поэтому повторных offer'ов и glare нет вовсе.
    pc.onnegotiationneeded = async () => {
      if (!this.isInitiator(socketId)) return;
      if (pc.signalingState !== 'stable') return;
      try {
        await pc.setLocalDescription();
        this.sendSignal('offer', socketId, { sdp: pc.localDescription });
      } catch (err) {
        console.error(`[pcm] negotiation failed for ${socketId}:`, err);
      }
    };

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
      if (pc.connectionState === 'connected') {
        this.#scheduleStreamResync(socketId);
      }
    };

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
        this.#scheduleStreamResync(socketId);
      }
    };

    return pc;
  }

  /**
   * Обрабатывает входящий offer: ставит remote description и отвечает answer.
   * Первичный offer всегда приходит в stable (шлёт только initiator). Renegotiation
   * при включении камеры может инициировать любая сторона — на редкий glare включается
   * правило polite/impolite: impolite (initiator) игнорирует встречный offer (его
   * победит), polite принимает чужой (современный SRD неявно откатывает наш) и
   * отвечает. Так видео доезжает в обе стороны.
   * @param {string} socketId
   * @param {RTCSessionDescriptionInit} sdp
   */
  async handleOffer(socketId, sdp) {
    // Если pc ещё не создан (offer обогнал addPeer) — создаём соединение.
    if (!this.peers.has(socketId)) {
      this.addPeer(socketId);
    }
    const record = this.peers.get(socketId);
    if (!record) return;
    const { pc } = record;

    const collision = record.makingOffer || (pc.signalingState && pc.signalingState !== 'stable');
    if (collision && this.isInitiator(socketId)) {
      // impolite (initiator): игнорируем встречный offer — наш победит (glare).
      return;
    }

    try {
      // polite при коллизии: SRD(offer) из have-local-offer неявно откатывает наш offer.
      await pc.setRemoteDescription(sdp);
      await this.#flushCandidates(record);
      await pc.setLocalDescription();
      this.#scheduleStreamResync(socketId);
      this.sendSignal('answer', socketId, { sdp: pc.localDescription });
    } catch (err) {
      console.error(`[pcm] handleOffer failed for ${socketId}:`, err);
    }
  }

  /**
   * Обрабатывает answer на наш offer. Применяем, только если у нас есть свой offer
   * в полёте (`have-local-offer`) — иначе это устаревший answer (наш offer был
   * откатан при glare), его игнорируем.
   * @param {string} socketId
   * @param {RTCSessionDescriptionInit} sdp
   */
  async handleAnswer(socketId, sdp) {
    const record = this.peers.get(socketId);
    if (!record) return;
    if (record.pc.signalingState !== 'have-local-offer') return;
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

    const timers = this.#resyncTimers.get(socketId);
    if (timers) {
      for (const id of timers) clearTimeout(id);
      this.#resyncTimers.delete(socketId);
    }

    this.#teardown(record.pc);
    this.peers.delete(socketId);
    this.onPeerLeft?.(socketId);
  }

  /**
   * Включает/выключает/меняет исходящую видеодорожку на всех соединениях.
   *
   * - `track`: первое включение камеры переводит recvonly-трансивер в sendrecv
   *   (смена direction триггерит onnegotiationneeded → renegotiation), что надёжно
   *   начинает отправку видео; далее смена устройства — лёгкий replaceTrack.
   * - `null` (выключение): replaceTrack(null) — гасим кадры без renegotiation,
   *   m-секция остаётся, удалённый receiver mute'ится (силуэт по media:state).
   *
   * Главное отличие от прежней схемы: первое видео доезжает через полноценный
   * renegotiation, а не через replaceTrack на «холодном» m=video — это и убирало
   * чёрную плитку у части участников (US-5/US-6, §7.1/§7.3).
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
   * Включение/смена исходящего видео: replaceTrack по прогретому sendrecv
   * video-sender, ЗАТЕМ обязательная renegotiation. Один лишь replaceTrack на
   * «холодной» (никогда не отправлявшей) m=video в Chromium НЕ всегда запускает
   * энкодер — у второй стороны чёрная плитка (US-6). Renegotiation после подмены
   * дорожки надёжно стартует отправку. Смена камеры на уже отправляющем sender —
   * лёгкая (renegotiation ничего не ломает, состояние просто подтверждается).
   * @param {string} socketId
   * @param {{ pc: RTCPeerConnection, videoSender: RTCRtpSender | null }} record
   * @param {MediaStreamTrack} track
   */
  async #enableOutboundVideo(socketId, record, track) {
    const sender = this.#findOutboundVideoSender(record);
    if (sender) {
      // «Холодный» sender (ещё не отправлял видео) — после подмены дорожки нужна
      // renegotiation, чтобы Chromium гарантированно запустил энкодер. Смена камеры
      // на уже отправляющем sender — просто replaceTrack, без лишнего обмена SDP.
      const wasCold = !sender.track;
      await sender.replaceTrack(track);
      record.videoSender = sender;
      if (wasCold) await this.#renegotiate(socketId, record);
      return;
    }
    if (this.localStream) {
      // Запасной путь (sender'а нет): addTrack сам инициирует negotiation у initiator.
      record.videoSender = record.pc.addTrack(track, this.localStream);
    }
  }

  /**
   * Принудительная renegotiation после включения камеры (надёжный старт отправки).
   * Любая сторона может инициировать; редкий glare (оба включили камеру разом)
   * разрешается в `handleOffer` по роли polite/impolite. Если соединение занято
   * (не stable) — пропускаем: текущий обмен и так включит новую дорожку в SDP.
   * @param {string} socketId
   * @param {{ pc: RTCPeerConnection }} record
   */
  async #renegotiate(socketId, record) {
    const { pc } = record;
    if (pc.signalingState !== 'stable') return;
    try {
      record.makingOffer = true;
      await pc.setLocalDescription();
      this.sendSignal('offer', socketId, { sdp: pc.localDescription });
    } catch (err) {
      console.error(`[pcm] renegotiate failed for ${socketId}:`, err);
    } finally {
      record.makingOffer = false;
    }
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

  /**
   * Пересобирает remoteStream участника (после media:state / позднего появления кадров).
   * @param {string} socketId
   */
  refreshPeerStream(socketId) {
    this.#scheduleStreamResync(socketId);
  }

  /** Закрывает все соединения (выход из комнаты, размонтирование — задача 17/18). */
  closeAll() {
    for (const timers of this.#resyncTimers.values()) {
      for (const id of timers) clearTimeout(id);
    }
    this.#resyncTimers.clear();
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
      // Камера выключена на входе: «прогретый» sendrecv video-трансивер без дорожки.
      // m=video согласована sendrecv с первого negotiation, поэтому включение камеры
      // позже — это просто replaceTrack по уже согласованной секции, без renegotiation,
      // и видео сразу доходит до второй стороны. recvonly здесь ломал отправку (US-6).
      videoSender = pc.addTransceiver('video', { direction: 'sendrecv' }).sender;
    }

    return { audioSender, videoSender };
  }

  /**
   * Исходящий video-sender (для выключения камеры — replaceTrack(null)).
   * @param {{ pc: RTCPeerConnection, videoSender: RTCRtpSender | null }} record
   * @returns {RTCRtpSender | null}
   */
  #findOutboundVideoSender(record) {
    const videoTxs = record.pc.getTransceivers().filter((t) => {
      if (t.kind !== 'video') return false;
      const dir = t.direction ?? t.currentDirection ?? '';
      return dir !== 'stopped';
    });
    const withTrack = videoTxs.find((t) => t.sender.track);
    if (withTrack) return withTrack.sender;
    if (videoTxs.length > 0) return videoTxs[videoTxs.length - 1].sender;
    return record.videoSender;
  }

  /**
   * Выбирает по одной актуальной входящей дорожке каждого kind из приёмников.
   *
   * Видео берём ВСЕГДА, как только есть живой receiver-track — даже пока он
   * `muted` (кадры ещё не пошли). Иначе плитка нового участника остаётся чёрной:
   * пока дорожки нет в `MediaStream`, появление видео целиком зависит от окна
   * resync-таймеров (≤3000 мс) и события `onunmute`, а на медленном пути (строгий
   * NAT/без TURN, mesh 3–4) размьют приходит позже и плитка не оживает (US-5/US-6).
   * Держа дорожку в потоке заранее, `<video>` сам отрисует кадры в момент unmute,
   * без пересборки стрима. Из нескольких video-receiver предпочитаем размьюченный
   * (актуальные кадры после renegotiation), иначе — последний живой.
   * @param {RTCPeerConnection} pc
   * @returns {MediaStreamTrack[]}
   */
  #pickReceiverTracks(pc) {
    /** @type {Map<string, MediaStreamTrack>} */
    const byKind = new Map();
    /** @type {MediaStreamTrack[]} */
    const videoCandidates = [];

    for (const { track } of pc.getReceivers()) {
      if (!track || track.readyState === 'ended') {
        continue;
      }
      if (track.kind === 'video') {
        videoCandidates.push(track);
        continue;
      }
      const prev = byKind.get(track.kind);
      if (!prev || (prev.muted && !track.muted)) {
        byKind.set(track.kind, track);
      }
    }

    if (videoCandidates.length > 0) {
      const unmutedVideo = videoCandidates.find((t) => !t.muted);
      byKind.set('video', unmutedVideo ?? videoCandidates[videoCandidates.length - 1]);
    }

    return [...byKind.values()];
  }

  /**
   * Сводит входящие дорожки RTCRtpReceiver в MediaStream участника и отдаёт его UI.
   *
   * Пересобираем стрим и дёргаем `onRemoteStream` только когда меняется СИГНАТУРА
   * дорожек: их набор (по id) ИЛИ состояние muted. Переход muted→unmuted (пошли
   * кадры при включении камеры) обязан дать новый объект стрима — иначе VideoTile
   * не перезапустит `play()` и плитка останется чёрной (US-5/US-6). При этом
   * сигнатура меняется лишь на реальных переходах (≈ дважды на дорожку), а не на
   * каждом resync, поэтому `srcObject` не «дёргается» вхолостую.
   * @param {string} socketId
   */
  #syncRemoteStreamTracks(socketId) {
    const record = this.peers.get(socketId);
    if (!record) return;

    this.#hookReceiverUnmute(socketId);

    const desired = this.#pickReceiverTracks(record.pc);
    if (desired.length === 0) return;

    const signature = desired
      .map((t) => `${t.kind}:${t.id}:${t.muted ? 'm' : 'u'}`)
      .sort()
      .join(',');
    if (signature === record.remoteStreamSig) return;

    record.remoteStreamSig = signature;
    record.remoteStream = new MediaStream(desired);
    this.onRemoteStream?.(socketId, record.remoteStream);
  }

  /**
   * Повторный sync после renegotiation: unmuted receiver может появиться без
   * ontrack/onunmute (US-6, чёрная плитка при уже включённой камере у peer).
   * @param {string} socketId
   */
  #scheduleStreamResync(socketId) {
    const prev = this.#resyncTimers.get(socketId);
    if (prev) {
      for (const id of prev) clearTimeout(id);
    }
    const run = () => this.#syncRemoteStreamTracks(socketId);
    run();
    queueMicrotask(run);
    const timers = [100, 300, 750, 1500, 3000].map((ms) => setTimeout(run, ms));
    this.#resyncTimers.set(socketId, timers);
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
    pc.oniceconnectionstatechange = null;
    pc.close();
  }
}
