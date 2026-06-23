import CopyLinkButton from './CopyLinkButton.jsx';

/**
 * @typedef {object} ControlsProps
 * @property {boolean} audioEnabled - микрофон включён.
 * @property {boolean} videoEnabled - камера включена.
 * @property {boolean} [hasMic] - микрофон физически доступен (PRD п. 14).
 * @property {boolean} [hasCam] - камера физически доступна (PRD п. 14).
 * @property {() => void} onToggleAudio - тумблер микрофона (PRD F-09).
 * @property {() => void} onToggleVideo - тумблер камеры (PRD F-10).
 * @property {() => void} onLeave - выход из комнаты (PRD F-17, US-10).
 */

/** Иконка микрофона (включён). */
const MicIcon = () => (
  <svg
    viewBox="0 0 24 24"
    width="20"
    height="20"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
    <line x1="12" x2="12" y1="19" y2="22" />
  </svg>
);

/** Иконка перечёркнутого микрофона (выключен). */
const MicOffIcon = () => (
  <svg
    viewBox="0 0 24 24"
    width="20"
    height="20"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <line x1="2" x2="22" y1="2" y2="22" />
    <path d="M18.89 13.23A7.12 7.12 0 0 0 19 12v-2" />
    <path d="M5 10v2a7 7 0 0 0 12 5" />
    <path d="M15 9.34V5a3 3 0 0 0-5.68-1.33" />
    <path d="M9 9v3a3 3 0 0 0 5.12 2.12" />
    <line x1="12" x2="12" y1="19" y2="22" />
  </svg>
);

/** Иконка камеры (включена). */
const CamIcon = () => (
  <svg
    viewBox="0 0 24 24"
    width="20"
    height="20"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5" />
    <rect x="2" y="6" width="14" height="12" rx="2" />
  </svg>
);

/** Иконка перечёркнутой камеры (выключена). */
const CamOffIcon = () => (
  <svg
    viewBox="0 0 24 24"
    width="20"
    height="20"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M10.66 6H14a2 2 0 0 1 2 2v2.5l5.248-3.062A.5.5 0 0 1 22 7.87v8.196" />
    <path d="M16 16a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2" />
    <line x1="2" x2="22" y1="2" y2="22" />
  </svg>
);

/** Иконка выхода из комнаты. */
const LeaveIcon = () => (
  <svg
    viewBox="0 0 24 24"
    width="20"
    height="20"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <polyline points="16 17 21 12 16 7" />
    <line x1="21" x2="9" y1="12" y2="12" />
  </svg>
);

/**
 * Панель управления комнатой (TDD §4.5, задача 17): тумблеры микрофона и камеры
 * (PRD F-09/F-10), копирование ссылки-приглашения (PRD F-03) и выход (PRD F-17).
 * Презентационный компонент — действия приходят колбэками из `RoomScreen`
 * (задача 18). Закрытие вкладки приравнивается к выходу через socket-disconnect
 * на сервере (PRD п. 28, задача 6), отдельный обработчик здесь не нужен.
 *
 * @param {ControlsProps} props
 * @returns {JSX.Element}
 */
export default function Controls({
  audioEnabled,
  videoEnabled,
  hasMic = true,
  hasCam = true,
  onToggleAudio,
  onToggleVideo,
  onLeave,
}) {
  return (
    <div className="controls">
      <button
        type="button"
        className={`ctrl-btn${audioEnabled ? '' : ' ctrl-btn--off'}`}
        onClick={onToggleAudio}
        disabled={!hasMic}
        aria-pressed={audioEnabled}
        aria-label={audioEnabled ? 'Выключить микрофон' : 'Включить микрофон'}
        title={audioEnabled ? 'Выключить микрофон' : 'Включить микрофон'}
      >
        {audioEnabled ? <MicIcon /> : <MicOffIcon />}
      </button>

      <button
        type="button"
        className={`ctrl-btn${videoEnabled ? '' : ' ctrl-btn--off'}`}
        onClick={onToggleVideo}
        disabled={!hasCam}
        aria-pressed={videoEnabled}
        aria-label={videoEnabled ? 'Выключить камеру' : 'Включить камеру'}
        title={videoEnabled ? 'Выключить камеру' : 'Включить камеру'}
      >
        {videoEnabled ? <CamIcon /> : <CamOffIcon />}
      </button>

      <CopyLinkButton />

      <button
        type="button"
        className="ctrl-btn ctrl-btn--danger"
        onClick={onLeave}
        aria-label="Выйти из комнаты"
        title="Выйти из комнаты"
      >
        <LeaveIcon />
      </button>
    </div>
  );
}
