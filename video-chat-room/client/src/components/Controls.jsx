import DeviceMenu from './DeviceMenu.jsx';
import {
  MicIcon,
  MicOffIcon,
  CamIcon,
  CamOffIcon,
  SpeakerIcon,
  SpeakerOffIcon,
} from './MediaIcons.jsx';

/**
 * @typedef {{ deviceId: string, label: string }} MediaDevice
 *
 * @typedef {object} ControlsProps
 * @property {boolean} audioEnabled - микрофон включён.
 * @property {boolean} videoEnabled - камера включена.
 * @property {boolean} [chatOpen] - панель чата открыта.
 * @property {MediaDevice[]} [audioDevices] - доступные микрофоны (для меню выбора).
 * @property {MediaDevice[]} [videoDevices] - доступные камеры (для меню выбора).
 * @property {MediaDevice[]} [outputDevices] - устройства вывода звука (для меню).
 * @property {string | null} [currentAudioId] - deviceId активного микрофона.
 * @property {string | null} [currentVideoId] - deviceId активной камеры.
 * @property {string | null} [currentOutputId] - deviceId активного вывода звука.
 * @property {boolean} [outputEnabled] - вывод звука включён (иначе — мьют, off-состояние).
 * @property {() => void} onToggleAudio - тумблер микрофона (PRD F-09).
 * @property {() => void} onToggleVideo - тумблер камеры (PRD F-10).
 * @property {() => void} [onToggleOutput] - тумблер вывода звука (мьют динамиков).
 * @property {(deviceId: string) => void} [onSelectAudioDevice] - выбор микрофона.
 * @property {(deviceId: string) => void} [onSelectVideoDevice] - выбор камеры.
 * @property {(deviceId: string) => void} [onSelectOutputDevice] - выбор вывода звука.
 * @property {() => void} onToggleChat - показать/скрыть панель чата.
 * @property {() => void} [onCopyLink] - копировать ссылку-приглашение (PRD F-03, US-3).
 * @property {() => void} onLeave - выход из комнаты (PRD F-17, US-10).
 */

/** Иконка чата (lucide message-square). */
const ChatIcon = () => (
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
    <path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z" />
  </svg>
);

/** Иконка ссылки-приглашения (lucide link). */
const LinkIcon = () => (
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
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  </svg>
);

/** Иконка выхода из комнаты (lucide log-out). */
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
    <path d="m16 17 5-5-5-5" />
    <path d="M21 12H9" />
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
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
  chatOpen = true,
  audioDevices = [],
  videoDevices = [],
  outputDevices = [],
  currentAudioId = null,
  currentVideoId = null,
  currentOutputId = null,
  outputEnabled = true,
  onToggleAudio,
  onToggleVideo,
  onToggleOutput,
  onSelectAudioDevice,
  onSelectVideoDevice,
  onSelectOutputDevice,
  onToggleChat,
  onCopyLink,
  onLeave,
}) {
  return (
    <div className="controls">
      {/* Группа микрофона: тумблер + меню выбора устройства (когда включён). */}
      <div className="ctrl-group">
        <button
          type="button"
          className={`ctrl-btn${audioEnabled ? '' : ' ctrl-btn--off'}`}
          onClick={onToggleAudio}
          aria-pressed={audioEnabled}
          aria-label={audioEnabled ? 'Выключить микрофон' : 'Включить микрофон'}
          title={audioEnabled ? 'Выключить микрофон' : 'Включить микрофон'}
        >
          {audioEnabled ? <MicIcon /> : <MicOffIcon />}
        </button>
        {audioEnabled && (
          <DeviceMenu
            devices={audioDevices}
            currentId={currentAudioId}
            onSelect={onSelectAudioDevice}
            label="Выбрать микрофон"
          />
        )}
      </div>

      {/* Группа камеры: тумблер + меню выбора устройства (когда включена). */}
      <div className="ctrl-group">
        <button
          type="button"
          className={`ctrl-btn${videoEnabled ? '' : ' ctrl-btn--off'}`}
          onClick={onToggleVideo}
          aria-pressed={videoEnabled}
          aria-label={videoEnabled ? 'Выключить камеру' : 'Включить камеру'}
          title={videoEnabled ? 'Выключить камеру' : 'Включить камеру'}
        >
          {videoEnabled ? <CamIcon /> : <CamOffIcon />}
        </button>
        {videoEnabled && (
          <DeviceMenu
            devices={videoDevices}
            currentId={currentVideoId}
            onSelect={onSelectVideoDevice}
            label="Выбрать камеру"
          />
        )}
      </div>

      {/* Вывод звука: тумблер мьюта динамиков + меню выбора устройства. */}
      <div className="ctrl-group">
        <button
          type="button"
          className={`ctrl-btn${outputEnabled ? '' : ' ctrl-btn--off'}`}
          onClick={onToggleOutput}
          aria-pressed={outputEnabled}
          aria-label={outputEnabled ? 'Выключить звук' : 'Включить звук'}
          title={outputEnabled ? 'Выключить звук' : 'Включить звук'}
        >
          {outputEnabled ? <SpeakerIcon /> : <SpeakerOffIcon />}
        </button>
        {outputDevices.length > 0 && (
          <DeviceMenu
            devices={outputDevices}
            currentId={currentOutputId}
            onSelect={onSelectOutputDevice}
            label="Выбрать устройство вывода звука"
          />
        )}
      </div>

      <button
        type="button"
        className="ctrl-btn"
        onClick={onToggleChat}
        aria-pressed={chatOpen}
        aria-label={chatOpen ? 'Скрыть чат' : 'Показать чат'}
        title={chatOpen ? 'Скрыть чат' : 'Показать чат'}
      >
        <ChatIcon />
      </button>

      <button
        type="button"
        className="ctrl-btn"
        onClick={onCopyLink}
        aria-label="Скопировать ссылку-приглашение"
        title="Скопировать ссылку-приглашение"
      >
        <LinkIcon />
      </button>

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
