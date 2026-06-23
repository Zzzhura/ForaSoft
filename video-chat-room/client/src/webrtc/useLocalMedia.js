import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Хук локальных медиаустройств (TDD §4.4, §7.3, §8; PRD F-06/F-09/F-10,
 * п. 13/14/16/18/19/20/33, US-6/US-7/US-12).
 *
 * Запрашивает камеру и микрофон через `getUserMedia` при монтировании и держит
 * состояние устройств. Камера и микрофон включены по умолчанию (п. 13). Если
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
 * @param {{ onVideoTrackChanged?: (track: MediaStreamTrack | null) => void }} [options]
 *        `onVideoTrackChanged` вызывается при появлении/снятии локальной
 *        видеодорожки (тумблер камеры, потеря устройства) — для проброса в mesh.
 * @returns {{
 *   localStream: MediaStream | null,
 *   audioEnabled: boolean,
 *   videoEnabled: boolean,
 *   hasMic: boolean,
 *   hasCam: boolean,
 *   ready: boolean,
 *   error: MediaError | null,
 *   toggleAudio: () => void,
 *   toggleVideo: () => Promise<void>,
 * }}
 */
export function useLocalMedia({ onVideoTrackChanged } = {}) {
  const [localStream, setLocalStream] = useState(null);
  // Включены по умолчанию при наличии устройства (п. 13); false, если устройства нет.
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [videoEnabled, setVideoEnabled] = useState(false);
  const [hasMic, setHasMic] = useState(false);
  const [hasCam, setHasCam] = useState(false);
  // ready=true → попытка захвата завершена (успешно или с ошибкой). UI может
  // показать комнату/баннер и снять «загрузку», не дожидаясь повторных попыток.
  const [ready, setReady] = useState(false);
  /** @type {[MediaError|null, Function]} */
  const [error, setError] = useState(null);

  // Императивный доступ к текущему потоку из тумблеров/onended без пересоздания
  // колбэков. Поток мутируется (add/removeTrack) — ссылка остаётся стабильной.
  const localStreamRef = useRef(null);
  // Колбэк проброса видеодорожки в mesh держим в ref: меняется между рендерами,
  // но не должен пересоздавать тумблеры или перезапускать эффект захвата.
  const onVideoTrackChangedRef = useRef(onVideoTrackChanged);
  onVideoTrackChangedRef.current = onVideoTrackChanged;
  // Защита от перекрытия асинхронных переключений камеры (быстрые клики).
  const videoBusyRef = useRef(false);

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
        // Реакция на потерю устройства во время звонка (п. 20, US-7).
        if (audioTrack) audioTrack.onended = handleAudioEnded;
        if (videoTrack) videoTrack.onended = () => handleVideoEnded(videoTrack);
        localStreamRef.current = stream;
        setLocalStream(stream);
        setHasMic(!!audioTrack);
        setHasCam(!!videoTrack);
        setAudioEnabled(!!audioTrack);
        setVideoEnabled(!!videoTrack);
      }
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

      // Включаем: пересоздаём видеодорожку (getUserMedia заново — п. 19).
      const fresh = await navigator.mediaDevices.getUserMedia({ video: true });
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
      setVideoEnabled(true);
      setHasCam(true);
    } catch (err) {
      console.error('[pcm] toggleVideo failed:', err);
      setVideoEnabled(false);
    } finally {
      videoBusyRef.current = false;
    }
  }, [handleVideoEnded]);

  return {
    localStream,
    audioEnabled,
    videoEnabled,
    hasMic,
    hasCam,
    ready,
    error,
    toggleAudio,
    toggleVideo,
  };
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
