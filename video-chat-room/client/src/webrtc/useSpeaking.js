import { useEffect, useRef, useState } from 'react';

/**
 * Детекция активного говорящего по уровню звука (звуковая индикация плитки).
 *
 * Анализирует аудиодорожку потока через Web Audio API (`AnalyserNode`): по
 * времянной развёртке считает RMS и сравнивает с порогом. Чтобы рамка не
 * «мигала» на паузах между словами, держим её ещё `SILENCE_HOLD_MS` после
 * последнего громкого кадра. `AnalyserNode` не подключаем к `destination` —
 * локальный звук не воспроизводится (анти-эхо), анализ работает и так.
 *
 * @param {MediaStream | null} stream  Поток участника (self или удалённый).
 * @param {boolean} [active]  Анализировать ли (например, false при выключенном
 *        микрофоне) — экономит работу и гарантированно гасит рамку.
 * @returns {boolean} true, пока участник говорит.
 */
export function useSpeaking(stream, active = true) {
  const [speaking, setSpeaking] = useState(false);
  // Текущее значение в ref, чтобы не дёргать setState каждый кадр без изменения.
  const speakingRef = useRef(false);

  useEffect(() => {
    if (!stream || !active) {
      speakingRef.current = false;
      setSpeaking(false);
      return undefined;
    }
    const audioTrack = stream.getAudioTracks()[0];
    if (!audioTrack) {
      speakingRef.current = false;
      setSpeaking(false);
      return undefined;
    }

    const ctx = getAudioContext();
    if (!ctx) return undefined;
    // Autoplay-политика могла оставить контекст приостановленным — будим его
    // (вызов идёт после пользовательского жеста входа в комнату).
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});

    let source;
    try {
      source = ctx.createMediaStreamSource(stream);
    } catch (err) {
      console.error('[pcm] createMediaStreamSource failed:', err);
      return undefined;
    }
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);

    const data = new Uint8Array(analyser.fftSize);
    let raf = 0;
    let lastLoud = 0;

    const tick = () => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i += 1) {
        const v = (data[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / data.length);
      const now = performance.now();
      if (rms > SPEAKING_THRESHOLD) lastLoud = now;
      const next = now - lastLoud < SILENCE_HOLD_MS;
      if (next !== speakingRef.current) {
        speakingRef.current = next;
        setSpeaking(next);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      source.disconnect();
      analyser.disconnect();
      speakingRef.current = false;
    };
  }, [stream, active]);

  return speaking;
}

/** Порог RMS, выше которого считаем, что участник говорит (нормировано к [-1,1]). */
const SPEAKING_THRESHOLD = 0.02;
/** Удержание рамки после последнего громкого кадра — гасит мигание на паузах. */
const SILENCE_HOLD_MS = 600;

/** @type {AudioContext | null} Один общий контекст на вкладку. */
let sharedAudioContext = null;

/**
 * Лениво создаёт и переиспользует единый `AudioContext` (по одному на каждую
 * плитку контекст плодить незачем).
 * @returns {AudioContext | null} null, если Web Audio API недоступен.
 */
function getAudioContext() {
  if (sharedAudioContext) return sharedAudioContext;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  sharedAudioContext = new Ctx();
  return sharedAudioContext;
}
