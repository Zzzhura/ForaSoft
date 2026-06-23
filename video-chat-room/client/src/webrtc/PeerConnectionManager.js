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
   * @param {RTCConfiguration} [options.rtcConfig]  Переопределение ICE-конфига (тесты/env).
   */
  constructor({ selfId, localStream, sendSignal, onRemoteStream, onPeerLeft, rtcConfig }) {
    this.selfId = selfId;
    this.localStream = localStream ?? null;
    this.sendSignal = sendSignal;
    this.onRemoteStream = onRemoteStream;
    this.onPeerLeft = onPeerLeft;
    this.rtcConfig = rtcConfig ?? DEFAULT_RTC_CONFIG;

    /**
     * socketId → запись о соединении.
     * @type {Map<string, { pc: RTCPeerConnection, videoSender: RTCRtpSender | null,
     *                      pendingCandidates: RTCIceCandidateInit[] }>}
     */
    this.peers = new Map();
  }

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
    const videoSender = this.#attachLocalMedia(pc);
    const record = { pc, videoSender, pendingCandidates: [] };
    this.peers.set(socketId, record);

    // Локальные ICE-кандидаты → удалённому участнику через relay сервера.
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendSignal('ice', socketId, { candidate: event.candidate });
      }
    };

    // Удалённый поток → UI. ontrack может прийти на каждую дорожку, поток один
    // и тот же (event.streams[0]); UI дедуплицирует по socketId.
    pc.ontrack = (event) => {
      const [stream] = event.streams;
      if (stream) {
        this.onRemoteStream?.(socketId, stream);
      }
    };

    const shouldOffer = initiator ?? this.isInitiator(socketId);
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
   * Заменяет исходящую видеодорожку на всех соединениях без ре-negotiation
   * (TDD §7.3, тумблер камеры — задача 12). `track = null` — перестаём слать видео.
   * @param {MediaStreamTrack | null} track
   */
  replaceVideoTrack(track) {
    for (const { videoSender } of this.peers.values()) {
      videoSender
        ?.replaceTrack(track)
        .catch((err) => console.error('[pcm] replaceVideoTrack failed:', err));
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
   * Добавляет локальные дорожки в соединение. Видео всегда заводится как
   * sendrecv-трансивер (даже без камеры), чтобы тумблер камеры (задача 12) мог
   * включить её позже через `replaceTrack` без ре-negotiation. Аудио: если
   * микрофона нет — recvonly (участник без устройств всё равно слышит других, US-12).
   * @param {RTCPeerConnection} pc
   * @returns {RTCRtpSender | null} sender видеодорожки (для replaceVideoTrack).
   */
  #attachLocalMedia(pc) {
    const stream = this.localStream;
    const audioTrack = stream?.getAudioTracks()[0] ?? null;
    const videoTrack = stream?.getVideoTracks()[0] ?? null;

    if (audioTrack) {
      pc.addTrack(audioTrack, stream);
    } else {
      pc.addTransceiver('audio', { direction: 'recvonly' });
    }

    if (videoTrack) {
      return pc.addTrack(videoTrack, stream);
    }
    // Нет камеры сейчас — заводим отправляющий трансивер «про запас».
    const transceiver = pc.addTransceiver('video', { direction: 'sendrecv' });
    return transceiver.sender;
  }

  /**
   * Создаёт и отправляет offer для соединения (мы — initiator).
   * @param {string} socketId
   */
  async #makeOffer(socketId) {
    const record = this.peers.get(socketId);
    if (!record) return;
    const offer = await record.pc.createOffer();
    await record.pc.setLocalDescription(offer);
    this.sendSignal('offer', socketId, { sdp: record.pc.localDescription });
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
    pc.close();
  }
}
