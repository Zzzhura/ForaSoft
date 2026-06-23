import { useEffect, useState } from 'react';

/**
 * Хук локальных медиаустройств (TDD §4.4, §8; PRD F-06, п. 13/14/33, US-6/US-12).
 *
 * Запрашивает камеру и микрофон через `getUserMedia` при монтировании и держит
 * состояние устройств. Камера и микрофон включены по умолчанию (п. 13). Если
 * устройства физически нет или в доступе отказано — пользователь всё равно
 * остаётся в комнате с выключенными устройствами (п. 14/33, US-12), приложение
 * не «вылетает».
 *
 * Тумблеры (`toggleAudio` / `toggleVideo`) и реакция на `track.onended`
 * добавляются в задаче 12 (TDD §7.3).
 *
 * @typedef {'denied'|'notfound'|'unsupported'} MediaError
 *
 * @returns {{
 *   localStream: MediaStream | null,
 *   audioEnabled: boolean,
 *   videoEnabled: boolean,
 *   hasMic: boolean,
 *   hasCam: boolean,
 *   ready: boolean,
 *   error: MediaError | null,
 * }}
 */
export function useLocalMedia() {
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
        const mic = stream.getAudioTracks().length > 0;
        const cam = stream.getVideoTracks().length > 0;
        setLocalStream(stream);
        setHasMic(mic);
        setHasCam(cam);
        setAudioEnabled(mic);
        setVideoEnabled(cam);
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
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  return { localStream, audioEnabled, videoEnabled, hasMic, hasCam, ready, error };
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
