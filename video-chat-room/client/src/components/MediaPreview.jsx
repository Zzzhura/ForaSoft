import { useEffect, useRef } from 'react';
import DeviceToggles from './DeviceToggles.jsx';

/**
 * @typedef {object} MediaPreviewProps
 * @property {MediaStream | null} localStream - локальный поток для превью.
 * @property {boolean} audioEnabled - микрофон включён.
 * @property {boolean} videoEnabled - камера включена.
 * @property {() => void} onToggleAudio - тумблер микрофона.
 * @property {() => void} onToggleVideo - тумблер камеры.
 * @property {boolean} [ready] - захват устройств завершён; до этого кнопки
 *           устройств заблокированы (наличие микрофона/камеры ещё неизвестно).
 */

/**
 * Превью-плитка участника на экране входа: собственное видео с кнопками
 * микрофона/камеры внутри плитки снизу (камера и микрофон включены по умолчанию,
 * PRD п. 13 — видно своё видео). Размещается над формой ввода имени. Превью заглушено
 * (`muted`) — анти-эхо; зеркалится только при включённой камере (как self-view).
 *
 * @param {MediaPreviewProps} props
 * @returns {JSX.Element}
 */
export default function MediaPreview({
  localStream,
  audioEnabled,
  videoEnabled,
  onToggleAudio,
  onToggleVideo,
  ready = true,
}) {
  const videoRef = useRef(null);

  // srcObject задаём императивно (TDD §4.3).
  useEffect(() => {
    const el = videoRef.current;
    if (el && el.srcObject !== localStream) el.srcObject = localStream;
  }, [localStream]);

  return (
    <div className={`preview${videoEnabled ? '' : ' preview--no-video'}`}>
      <video
        ref={videoRef}
        className="preview__video"
        autoPlay
        playsInline
        muted
        style={videoEnabled ? { transform: 'scaleX(-1)' } : undefined}
      />

      {!videoEnabled && (
        <div className="preview__placeholder">
          {/* Силуэт (lucide user) при выключенной камере. */}
          <svg
            viewBox="0 0 24 24"
            width="64"
            height="64"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
        </div>
      )}

      {/* Кнопки устройств — внутри плитки снизу по центру. */}
      <div className="preview__bar">
        <DeviceToggles
          audioEnabled={audioEnabled}
          videoEnabled={videoEnabled}
          onToggleAudio={onToggleAudio}
          onToggleVideo={onToggleVideo}
          disabled={!ready}
        />
      </div>
    </div>
  );
}
