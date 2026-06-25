import { useEffect, useRef, useState } from 'react';

/**
 * @typedef {{ deviceId: string, label: string }} MediaDevice
 */

/** Иконка-шеврон, открывающая меню устройств. */
const ChevronIcon = () => (
  <svg
    viewBox="0 0 24 24"
    width="18"
    height="18"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="m18 15-6-6-6 6" />
  </svg>
);

/**
 * Отдельный компонент выбора устройства: кнопка-стрелка 24×24 раскрывает список
 * устройств; выбранный пункт помечен точкой. Стрелка при открытии поворачивается
 * на 180°. Закрывается по клику вне меню и по Escape. Презентационный: список и
 * колбэк приходят из `RoomScreen`. Кнопка-тумблер устройства (микрофон/камера/
 * вывод звука) рендерится рядом отдельно (в `Controls`).
 *
 * @param {{
 *   devices: MediaDevice[],
 *   currentId: string | null,
 *   onSelect: (deviceId: string) => void,
 *   label: string,
 * }} props
 * @returns {JSX.Element | null}
 */
export default function DeviceMenu({ devices, currentId, onSelect, label }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  // Закрытие по клику вне меню и по Escape.
  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Нечего выбирать — меню не показываем.
  if (devices.length === 0) return null;

  const toggle = () => setOpen((v) => !v);

  return (
    <div className="device-menu" ref={rootRef}>
      <button
        type="button"
        className="device-menu__trigger"
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
      >
        <span className={`device-menu__chevron${open ? ' device-menu__chevron--open' : ''}`}>
          <ChevronIcon />
        </span>
      </button>

      {open && (
        <ul className="device-menu__list" role="menu">
          {devices.map((device) => {
            const selected = device.deviceId === currentId;
            return (
              <li key={device.deviceId} role="presentation">
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={selected}
                  className={`device-menu__item${selected ? ' device-menu__item--selected' : ''}`}
                  onClick={() => {
                    onSelect(device.deviceId);
                    setOpen(false);
                  }}
                >
                  <span className="device-menu__dot" aria-hidden="true" />
                  <span className="device-menu__label">{device.label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
