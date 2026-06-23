import { useEffect, useRef } from 'react';

/**
 * @typedef {object} VideoTileProps
 * @property {MediaStream | null} [stream] - медиапоток участника (audio+video).
 * @property {string} name - отображаемое имя (оверлеем, PRD F-08).
 * @property {boolean} [isSelf] - self-view: playback заглушён (анти-эхо), видео зеркалится.
 * @property {boolean} [audioEnabled] - false → иконка перечёркнутого микрофона (PRD п. 16, US-7).
 * @property {boolean} [videoEnabled] - false → заглушка-силуэт поверх видео (PRD п. 18, US-12).
 */

/**
 * Плитка одного участника: `<video>` + оверлей имени + индикатор mute +
 * заглушка-силуэт при отсутствии видео (TDD §4.5, задача 15).
 *
 * `<video>` рендерится всегда (даже при выключенной камере), чтобы у удалённого
 * участника продолжал воспроизводиться звук; силуэт показывается оверлеем сверху.
 *
 * @param {VideoTileProps} props
 * @returns {JSX.Element}
 */
export default function VideoTile({
  stream = null,
  name,
  isSelf = false,
  audioEnabled = true,
  videoEnabled = true,
}) {
  const videoRef = useRef(null);

  // srcObject нельзя задать атрибутом — присваиваем императивно (TDD §4.3).
  useEffect(() => {
    const el = videoRef.current;
    if (el && el.srcObject !== stream) {
      el.srcObject = stream;
    }
  }, [stream]);

  return (
    <div className="tile">
      <video
        ref={videoRef}
        className={`tile__video${isSelf ? ' tile__video--self' : ''}`}
        autoPlay
        playsInline
        muted={isSelf}
      />

      {!videoEnabled && (
        <div className="tile__placeholder">
          {/* Силуэт человека (lucide user) при отсутствии видео (PRD п. 18). */}
          <svg
            className="tile__silhouette"
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

      <div className="tile__overlay">
        {!audioEnabled && (
          <svg
            className="tile__mic-off"
            viewBox="0 0 24 24"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            role="img"
            aria-label="Микрофон выключен"
          >
            <line x1="2" x2="22" y1="2" y2="22" />
            <path d="M18.89 13.23A7.12 7.12 0 0 0 19 12v-2" />
            <path d="M5 10v2a7 7 0 0 0 12 5" />
            <path d="M15 9.34V5a3 3 0 0 0-5.68-1.33" />
            <path d="M9 9v3a3 3 0 0 0 5.12 2.12" />
            <line x1="12" x2="12" y1="19" y2="22" />
          </svg>
        )}
        <span className="tile__name">{name}</span>
      </div>
    </div>
  );
}
