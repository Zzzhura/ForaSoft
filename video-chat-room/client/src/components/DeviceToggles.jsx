import { MicIcon, MicOffIcon, CamIcon, CamOffIcon } from './MediaIcons.jsx';

/**
 * @typedef {object} DeviceTogglesProps
 * @property {boolean} audioEnabled - микрофон включён.
 * @property {boolean} videoEnabled - камера включена.
 * @property {() => void} onToggleAudio - тумблер микрофона.
 * @property {() => void} onToggleVideo - тумблер камеры.
 * @property {boolean} [disabled] - блокирует кнопки, пока захват устройств не
 *           завершён (`ready`): до этого `hasMic`/`hasCam` ещё неизвестны и клик
 *           ушёл бы в no-op (гонка на форме входа).
 */

/**
 * Кнопки управления устройствами (микрофон/камера) для превью на экране входа
 * (`MediaPreview`). Камера и микрофон включены по умолчанию (PRD п. 13). Кнопки
 * маленькие и круглые (стиль `.device-toggles`); выбор устройства ввода здесь не
 * нужен — он доступен уже в звонке (`Controls`).
 *
 * @param {DeviceTogglesProps} props
 * @returns {JSX.Element}
 */
export default function DeviceToggles({
  audioEnabled,
  videoEnabled,
  onToggleAudio,
  onToggleVideo,
  disabled = false,
}) {
  return (
    <div className="device-toggles">
      <button
        type="button"
        className={`ctrl-btn${audioEnabled ? '' : ' ctrl-btn--off'}`}
        onClick={onToggleAudio}
        disabled={disabled}
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
        disabled={disabled}
        aria-pressed={videoEnabled}
        aria-label={videoEnabled ? 'Выключить камеру' : 'Включить камеру'}
        title={videoEnabled ? 'Выключить камеру' : 'Включить камеру'}
      >
        {videoEnabled ? <CamIcon /> : <CamOffIcon />}
      </button>
    </div>
  );
}
