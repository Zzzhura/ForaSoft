import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Хук локальных медиаустройств (TDD §4.4, §7.3, §8; PRD F-06/F-09/F-10,
 * п. 13/14/16/18/19/20/33, US-6/US-7/US-12).
 *
 * Запрашивает камеру и микрофон через `getUserMedia` при монтировании (нативный
 * prompt на каждом входе) и держит состояние устройств. Камера и микрофон
 * ВЫКЛЮЧЕНЫ по умолчанию у каждого нового участника: микрофон глушим
 * (`enabled=false`), видеодорожку сразу освобождаем (`stop()`+`removeTrack`,
 * лампочка не горит). Доступ запрашиваем только чтобы показать prompt и узнать
 * наличие устройств — включает их пользователь тумблерами. Если
 * устройства физически нет или в доступе отказано — пользователь всё равно
 * остаётся в комнате с выключенными устройствами (п. 14/33, US-12), приложение
 * не «вылетает».
 *
 * Тумблеры (задача 12, TDD §7.3):
 *  - `toggleAudio` — `audioTrack.enabled = !enabled` (мгновенно, без
 *    ре-negotiation; дорожку не останавливаем — п. 16, US-7);
 *  - `toggleVideo` — при выключении `track.stop()` + `removeTrack` физически
 *    освобождает камеру (лампочка гаснет, п. 19), при включении заново
 *    захватывает дорожку через `getUserMedia`.
 *
 * Замена видеодорожки на peer-соединениях идёт не из хука, а через колбэк
 * `onVideoTrackChanged` (его прокидывает `RoomScreen` в задаче 18 на
 * `PeerConnectionManager.replaceVideoTrack`). Аудио переключается прямо на
 * общей дорожке: все `RTCRtpSender` ссылаются на тот же объект, поэтому смена
 * `enabled` доходит до всех peer без дополнительных вызовов.
 *
 * Потеря устройства во время звонка (`track.onended`, п. 20, US-7) переводит
 * соответствующее устройство в выключенное состояние и показывает заглушку.
 *
 * @typedef {'denied'|'notfound'|'unsupported'} MediaError
 *
 * Выбор устройства ввода (`selectAudioDevice`/`selectVideoDevice`): заново
 * захватывает дорожку с нужным `deviceId` и подменяет её в потоке и на peer
 * через `replaceTrack` (колбэки `onAudioTrackChanged`/`onVideoTrackChanged`).
 * Списки устройств (`audioDevices`/`videoDevices`) перечисляются после выдачи
 * доступа и обновляются по событию `devicechange`.
 *
 * @typedef {{ deviceId: string, label: string }} MediaDevice
 *
 * @param {{
 *   onVideoTrackChanged?: (track: MediaStreamTrack | null) => void,
 *   onAudioTrackChanged?: (track: MediaStreamTrack | null) => void,
 * }} [options]
 *        Колбэки вызываются при появлении/снятии/замене локальной дорожки
 *        (тумблеры, потеря устройства, смена устройства ввода) — для проброса в mesh.
 * @returns {{
 *   localStream: MediaStream | null,
 *   audioEnabled: boolean,
 *   videoEnabled: boolean,
 *   hasMic: boolean,
 *   hasCam: boolean,
 *   ready: boolean,
 *   error: MediaError | null,
 *   audioDevices: MediaDevice[],
 *   videoDevices: MediaDevice[],
 *   outputDevices: MediaDevice[],
 *   currentAudioId: string | null,
 *   currentVideoId: string | null,
 *   currentOutputId: string | null,
 *   outputEnabled: boolean,
 *   toggleAudio: () => void,
 *   toggleVideo: () => Promise<void>,
 *   selectAudioDevice: (deviceId: string) => Promise<void>,
 *   selectVideoDevice: (deviceId: string) => Promise<void>,
 *   selectOutputDevice: (deviceId: string) => void,
 *   toggleOutput: () => void,
 * }}
 */
export function useLocalMedia({ onVideoTrackChanged, onAudioTrackChanged } = {}) {
  const [localStream, setLocalStream] = useState(null);
  // Выключены по умолчанию у каждого нового участника, даже с тем же устройством:
  // включает пользователь тумблерами.
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [videoEnabled, setVideoEnabled] = useState(false);
  const [hasMic, setHasMic] = useState(false);
  const [hasCam, setHasCam] = useState(false);
  // ready=true → попытка захвата завершена (успешно или с ошибкой). UI может
  // показать комнату/баннер и снять «загрузку», не дожидаясь повторных попыток.
  const [ready, setReady] = useState(false);
  /** @type {[MediaError|null, Function]} */
  const [error, setError] = useState(null);
  /** @type {[MediaDevice[], Function]} Доступные микрофоны (audioinput). */
  const [audioDevices, setAudioDevices] = useState([]);
  /** @type {[MediaDevice[], Function]} Доступные камеры (videoinput). */
  const [videoDevices, setVideoDevices] = useState([]);
  /** @type {[MediaDevice[], Function]} Доступные устройства вывода звука (audiooutput). */
  const [outputDevices, setOutputDevices] = useState([]);
  // deviceId активной дорожки — отмечаем выбранный пункт в меню.
  const [currentAudioId, setCurrentAudioId] = useState(null);
  const [currentVideoId, setCurrentVideoId] = useState(null);
  // Выбранное устройство вывода звука (применяется к плиткам через setSinkId).
  const [currentOutputId, setCurrentOutputId] = useState(null);
  // Вывод звука включён (по умолчанию). Выключение глушит звук всех удалённых
  // плиток (мьют воспроизведения, через `muted` у <video>).
  const [outputEnabled, setOutputEnabled] = useState(true);

  // Императивный доступ к текущему потоку из тумблеров/onended без пересоздания
  // колбэков. Поток мутируется (add/removeTrack) — ссылка остаётся стабильной.
  const localStreamRef = useRef(null);
  // Колбэк проброса видеодорожки в mesh держим в ref: меняется между рендерами,
  // но не должен пересоздавать тумблеры или перезапускать эффект захвата.
  const onVideoTrackChangedRef = useRef(onVideoTrackChanged);
  onVideoTrackChangedRef.current = onVideoTrackChanged;
  const onAudioTrackChangedRef = useRef(onAudioTrackChanged);
  onAudioTrackChangedRef.current = onAudioTrackChanged;
  // Защита от перекрытия асинхронных переключений камеры (быстрые клики).
  const videoBusyRef = useRef(false);
  // Предпочтённые устройства: при включении камеры/смене микрофона захватываем
  // именно их (а не «дефолт»). Держим в ref — не должны пересоздавать тумблеры.
  const preferredAudioIdRef = useRef(null);
  const preferredVideoIdRef = useRef(null);

  // Потеря микрофона во время звонка (п. 20, US-7): дорожку не пересоздаём,
  // помечаем устройство отсутствующим и выключенным.
  const handleAudioEnded = useCallback(() => {
    setAudioEnabled(false);
    setHasMic(false);
  }, []);

  // Потеря камеры во время звонка (п. 20, US-7): снимаем дорожку из потока,
  // гасим видео у себя и на всех peer (заглушка-силуэт у остальных, п. 18).
  const handleVideoEnded = useCallback((track) => {
    const stream = localStreamRef.current;
    if (stream && stream.getVideoTracks().includes(track)) {
      stream.removeTrack(track);
    }
    onVideoTrackChangedRef.current?.(null);
    setVideoEnabled(false);
    setHasCam(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    /** @type {MediaStream | null} */
    let stream = null;

    (async () => {
      const result = await acquireMedia();

      // Компонент размонтирован, пока шёл асинхронный запрос (в т.ч. StrictMode
      // dev double-invoke) — освобождаем захваченные дорожки, состояние не трогаем.
      if (cancelled) {
        result.stream?.getTracks().forEach((track) => track.stop());
        return;
      }

      if (result.stream) {
        stream = result.stream;
        const audioTrack = stream.getAudioTracks()[0] ?? null;
        const videoTrack = stream.getVideoTracks()[0] ?? null;
        // Микрофон выключен по умолчанию: дорожку держим (для мгновенного unmute
        // без renegotiation), но глушим. Реакция на потерю устройства — onended.
        if (audioTrack) {
          audioTrack.enabled = false;
          audioTrack.onended = handleAudioEnded;
        }
        // Запоминаем выбранные устройства (для меню и повторного захвата) до того,
        // как отпустим видеодорожку.
        const audioId = trackDeviceId(audioTrack);
        const videoId = trackDeviceId(videoTrack);
        preferredAudioIdRef.current = audioId;
        preferredVideoIdRef.current = videoId;
        setCurrentAudioId(audioId);
        setCurrentVideoId(videoId);
        // Камера выключена по умолчанию: физически отпускаем устройство, чтобы
        // лампочка не горела (stop + removeTrack). При включении тумблером
        // дорожка захватывается заново через getUserMedia (toggleVideo).
        if (videoTrack) {
          videoTrack.stop();
          stream.removeTrack(videoTrack);
        }
        localStreamRef.current = stream;
        setLocalStream(stream);
        setHasMic(!!audioTrack);
        setHasCam(!!videoTrack);
        setAudioEnabled(false);
        setVideoEnabled(false);
      }
      // Перечисляем устройства: метки доступны только после выдачи доступа.
      refreshDevices(setAudioDevices, setVideoDevices, setOutputDevices);
      // error может прийти вместе с null-потоком (denied/notfound/unsupported)
      // либо отсутствовать при успешном частичном захвате.
      setError(result.error ?? null);
      setReady(true);
    })();

    return () => {
      cancelled = true;
      // Освобождаем устройства при выходе из комнаты/размонтировании
      // (камера физически отпускается, лампочка гаснет).
      stream?.getTracks().forEach((track) => {
        track.onended = null;
        track.stop();
      });
      localStreamRef.current = null;
    };
  }, [handleAudioEnded, handleVideoEnded]);

  /**
   * Тумблер микрофона (12.1, п. 16/US-7): переключает `enabled` общей
   * аудиодорожки — звук перестаёт/возобновляет передаваться всем peer без
   * ре-negotiation. Дорожку не останавливаем. No-op при отсутствии микрофона.
   */
  const toggleAudio = useCallback(() => {
    const audioTrack = localStreamRef.current?.getAudioTracks()[0];
    if (!audioTrack) return;
    const next = !audioTrack.enabled;
    audioTrack.enabled = next;
    setAudioEnabled(next);
  }, []);

  /**
   * Тумблер камеры (12.2, п. 19/US-7). Выключение: `stop()` + `removeTrack`
   * физически освобождает устройство (лампочка гаснет) и снимает дорожку с peer
   * через `onVideoTrackChanged(null)`. Включение: заново захватывает камеру и
   * прокидывает новую дорожку в mesh. Ошибку захвата не валим — остаёмся с
   * выключенной камерой.
   * @returns {Promise<void>}
   */
  const toggleVideo = useCallback(async () => {
    if (videoBusyRef.current) return;
    videoBusyRef.current = true;
    try {
      const stream = localStreamRef.current;
      if (!stream) return;
      const current = stream.getVideoTracks()[0] ?? null;

      if (current) {
        // Выключаем: освобождаем аппаратную камеру (п. 19).
        current.onended = null;
        current.stop();
        stream.removeTrack(current);
        onVideoTrackChangedRef.current?.(null);
        setVideoEnabled(false);
        return;
      }

      // Включаем: пересоздаём видеодорожку (getUserMedia заново — п. 19),
      // предпочитая ранее выбранную камеру.
      const fresh = await navigator.mediaDevices.getUserMedia({
        video: videoConstraint(preferredVideoIdRef.current),
      });
      const track = fresh.getVideoTracks()[0] ?? null;
      const liveStream = localStreamRef.current;
      // Пока ждали getUserMedia, могли размонтироваться — освобождаем дорожку.
      if (!track || !liveStream) {
        track?.stop();
        return;
      }
      track.onended = () => handleVideoEnded(track);
      liveStream.addTrack(track);
      onVideoTrackChangedRef.current?.(track);
      const id = trackDeviceId(track) ?? preferredVideoIdRef.current;
      preferredVideoIdRef.current = id;
      setCurrentVideoId(id);
      setVideoEnabled(true);
      setHasCam(true);
    } catch (err) {
      console.error('[pcm] toggleVideo failed:', err);
      setVideoEnabled(false);
    } finally {
      videoBusyRef.current = false;
    }
  }, [handleVideoEnded]);

  /**
   * Выбор микрофона (смена устройства ввода): захватывает новую аудиодорожку с
   * заданным `deviceId`, сохраняет текущее состояние mute (`enabled`), подменяет
   * её в потоке и на всех peer (`onAudioTrackChanged`). No-op, если микрофона нет.
   * @param {string} deviceId
   * @returns {Promise<void>}
   */
  const selectAudioDevice = useCallback(
    async (deviceId) => {
      const liveStream = localStreamRef.current;
      if (!liveStream || deviceId === preferredAudioIdRef.current) return;
      try {
        const fresh = await navigator.mediaDevices.getUserMedia({
          audio: { deviceId: { exact: deviceId } },
        });
        const track = fresh.getAudioTracks()[0] ?? null;
        const stream = localStreamRef.current;
        if (!track || !stream) {
          track?.stop();
          return;
        }
        const old = stream.getAudioTracks()[0] ?? null;
        // Переносим текущее состояние mute на новую дорожку.
        track.enabled = old ? old.enabled : false;
        track.onended = handleAudioEnded;
        if (old) {
          old.onended = null;
          old.stop();
          stream.removeTrack(old);
        }
        stream.addTrack(track);
        onAudioTrackChangedRef.current?.(track);
        const id = trackDeviceId(track) ?? deviceId;
        preferredAudioIdRef.current = id;
        setCurrentAudioId(id);
        setHasMic(true);
      } catch (err) {
        console.error('[pcm] selectAudioDevice failed:', err);
      }
    },
    [handleAudioEnded],
  );

  /**
   * Выбор камеры (смена устройства ввода). Запоминает предпочтение; если камера
   * сейчас включена — заменяет дорожку немедленно (`onVideoTrackChanged`), иначе
   * устройство применится при следующем включении камеры. No-op при занятом
   * переключении камеры.
   * @param {string} deviceId
   * @returns {Promise<void>}
   */
  const selectVideoDevice = useCallback(
    async (deviceId) => {
      if (deviceId === preferredVideoIdRef.current && videoEnabled) return;
      preferredVideoIdRef.current = deviceId;
      setCurrentVideoId(deviceId);
      // Камера выключена — применим выбор при следующем включении.
      if (!videoEnabled || videoBusyRef.current) return;
      videoBusyRef.current = true;
      try {
        const fresh = await navigator.mediaDevices.getUserMedia({
          video: { deviceId: { exact: deviceId } },
        });
        const track = fresh.getVideoTracks()[0] ?? null;
        const stream = localStreamRef.current;
        if (!track || !stream) {
          track?.stop();
          return;
        }
        const old = stream.getVideoTracks()[0] ?? null;
        if (old) {
          old.onended = null;
          old.stop();
          stream.removeTrack(old);
        }
        track.onended = () => handleVideoEnded(track);
        stream.addTrack(track);
        onVideoTrackChangedRef.current?.(track);
        const id = trackDeviceId(track) ?? deviceId;
        preferredVideoIdRef.current = id;
        setCurrentVideoId(id);
      } catch (err) {
        console.error('[pcm] selectVideoDevice failed:', err);
      } finally {
        videoBusyRef.current = false;
      }
    },
    [videoEnabled, handleVideoEnded],
  );

  // Обновление списков при подключении/отключении устройств (PRD п. 20).
  useEffect(() => {
    const md = navigator.mediaDevices;
    if (!md?.addEventListener) return undefined;
    const handler = () => refreshDevices(setAudioDevices, setVideoDevices, setOutputDevices);
    md.addEventListener('devicechange', handler);
    return () => md.removeEventListener('devicechange', handler);
  }, []);

  // По умолчанию — первое устройство вывода (обычно «default»), пока пользователь
  // не выбрал другое. Не затираем уже выбранное.
  useEffect(() => {
    setCurrentOutputId((prev) => prev ?? outputDevices[0]?.deviceId ?? null);
  }, [outputDevices]);

  /**
   * Выбор устройства вывода звука. Само переключение применяется к плиткам через
   * `HTMLMediaElement.setSinkId` (в `VideoTile`) — здесь только запоминаем выбор.
   * @param {string} deviceId
   */
  const selectOutputDevice = useCallback((deviceId) => setCurrentOutputId(deviceId), []);

  /** Тумблер вывода звука: глушит/возобновляет звук удалённых плиток. */
  const toggleOutput = useCallback(() => setOutputEnabled((v) => !v), []);

  return {
    localStream,
    audioEnabled,
    videoEnabled,
    hasMic,
    hasCam,
    ready,
    error,
    audioDevices,
    videoDevices,
    outputDevices,
    currentAudioId,
    currentVideoId,
    currentOutputId,
    outputEnabled,
    toggleAudio,
    toggleVideo,
    selectAudioDevice,
    selectVideoDevice,
    selectOutputDevice,
    toggleOutput,
  };
}

/**
 * Безопасно читает `deviceId` дорожки (в т.ч. в окружениях без `getSettings`).
 * @param {MediaStreamTrack | null} track
 * @returns {string | null}
 */
function trackDeviceId(track) {
  return typeof track?.getSettings === 'function' ? (track.getSettings().deviceId ?? null) : null;
}

/**
 * Ограничение `video` для `getUserMedia`: конкретное устройство, если выбрано,
 * иначе любое (`true`).
 * @param {string | null} deviceId
 * @returns {MediaTrackConstraints | boolean}
 */
function videoConstraint(deviceId) {
  return deviceId ? { deviceId: { exact: deviceId } } : true;
}

/**
 * Перечисляет устройства ввода и раскладывает по спискам микрофонов/камер.
 * Метки доступны только после выдачи доступа (`getUserMedia`). Ошибки гасим —
 * меню просто останется пустым.
 * @param {Function} setAudioDevices
 * @param {Function} setVideoDevices
 */
async function refreshDevices(setAudioDevices, setVideoDevices, setOutputDevices) {
  if (!navigator.mediaDevices?.enumerateDevices) return;
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const pick = (kind, fallback) =>
      devices
        .filter((d) => d.kind === kind && d.deviceId)
        .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `${fallback} ${i + 1}` }));
    setAudioDevices(pick('audioinput', 'Микрофон'));
    setVideoDevices(pick('videoinput', 'Камера'));
    setOutputDevices(pick('audiooutput', 'Динамики'));
  } catch (err) {
    console.error('[pcm] enumerateDevices failed:', err);
  }
}

/**
 * Классифицирует ошибку `getUserMedia` в одну из понятных категорий.
 * @param {unknown} err
 * @returns {'denied'|'notfound'}
 */
function classifyMediaError(err) {
  const name = err && typeof err === 'object' ? /** @type {any} */ (err).name : '';
  // Отказ в доступе/блокировка по безопасности (не secure context и т.п.).
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') {
    return 'denied';
  }
  // Устройство отсутствует, занято другим приложением или не отдаёт поток.
  // Для UX трактуем как «нет устройства» — заглушка-силуэт, вход без него.
  return 'notfound';
}

/**
 * Захватывает медиапотоки максимально устойчиво (PRD п. 14, US-6/US-12):
 *  1. проверка поддержки `getUserMedia` (иначе `unsupported`);
 *  2. попытка получить аудио+видео одним запросом (один prompt — лучший UX);
 *  3. при отказе в доступе — `denied`, вход без устройств;
 *  4. если часть устройств отсутствует/занята — повторный захват по отдельности,
 *     чтобы доступное устройство всё же заработало.
 *
 * @returns {Promise<{ stream?: MediaStream, error?: 'denied'|'notfound'|'unsupported' }>}
 */
async function acquireMedia() {
  if (!navigator.mediaDevices?.getUserMedia) {
    return { error: 'unsupported' };
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
    return { stream };
  } catch (err) {
    if (classifyMediaError(err) === 'denied') {
      // Доступ запрещён — остаёмся в комнате с выключенными устройствами.
      return { error: 'denied' };
    }
    // Одно из устройств отсутствует/занято: запрашиваем их по отдельности,
    // чтобы доступное (например, только микрофон) всё равно подключилось.
    return acquireIndividually();
  }
}

/**
 * Резервный захват аудио и видео независимыми запросами. Возвращает поток с теми
 * дорожками, что удалось получить; если не получено ничего — категория ошибки
 * (`denied`, если хоть один запрос отклонён по доступу, иначе `notfound`).
 *
 * @returns {Promise<{ stream?: MediaStream, error?: 'denied'|'notfound' }>}
 */
async function acquireIndividually() {
  const stream = new MediaStream();
  let denied = false;

  for (const constraints of [{ audio: true }, { video: true }]) {
    try {
      const partial = await navigator.mediaDevices.getUserMedia(constraints);
      partial.getTracks().forEach((track) => stream.addTrack(track));
    } catch (err) {
      if (classifyMediaError(err) === 'denied') {
        denied = true;
      }
    }
  }

  if (stream.getTracks().length > 0) {
    return { stream };
  }
  return { error: denied ? 'denied' : 'notfound' };
}
