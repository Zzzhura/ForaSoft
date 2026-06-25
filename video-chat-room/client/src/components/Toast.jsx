import { createContext, useCallback, useContext, useState } from 'react';

/** Время автозакрытия тоста, мс. */
const TOAST_MS = 4000;
/** Сколько верхних тостов в стопке видно (остальные скрыты). */
const STACK_VISIBLE = 3;

let toastSeq = 0;

/** @typedef {'success'|'warning'} ToastType */
/** @typedef {'copy'|'no-device'} ToastIcon */

/** @type {React.Context<{ showToast: (t: { type?: ToastType, text: string, icon?: ToastIcon }) => void } | null>} */
const ToastContext = createContext(null);

/**
 * Хук доступа к тостам. Должен использоваться внутри `ToastProvider`.
 * @returns {{ showToast: (t: { type?: ToastType, text: string, icon?: ToastIcon }) => void }}
 */
export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast должен использоваться внутри <ToastProvider>');
  }
  return ctx;
}

/** Иконка успешного копирования (lucide copy). */
const CopyIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" {...iconProps}>
    <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
    <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
  </svg>
);

/** Иконка «нет доступных устройств / нет доступа» (lucide ban). */
const NoDeviceIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" {...iconProps}>
    <circle cx="12" cy="12" r="10" />
    <path d="m4.9 4.9 14.2 14.2" />
  </svg>
);

/** Иконка успеха по умолчанию (lucide check). */
const CheckIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" {...iconProps}>
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

/** Иконка предупреждения по умолчанию (lucide alert-triangle). */
const AlertIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" {...iconProps}>
    <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
    <path d="M12 9v4" />
    <path d="M12 17h.01" />
  </svg>
);

/** Общие атрибуты SVG-иконок тоста. */
const iconProps = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
};

/**
 * Возвращает иконку тоста: по явному `icon`, иначе — по типу.
 * @param {{ type: ToastType, icon?: ToastIcon }} toast
 * @returns {JSX.Element}
 */
function toastIcon({ type, icon }) {
  if (icon === 'copy') return <CopyIcon />;
  if (icon === 'no-device') return <NoDeviceIcon />;
  return type === 'warning' ? <AlertIcon /> : <CheckIcon />;
}

/**
 * Провайдер тостов: всплывающие уведомления в правом верхнем углу
 * (подтверждение копирования ссылки — PRD F-03/US-3; отказ в доступе к
 * устройствам — PRD п. 33/US-12). Тосты складываются стопкой друг на друга
 * (новый — сверху, предыдущие выглядывают позади). Автозакрытие через `TOAST_MS`.
 *
 * @param {{ children: React.ReactNode }} props
 * @returns {JSX.Element}
 */
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const showToast = useCallback(
    ({ type = 'success', text, icon }) => {
      const id = ++toastSeq;
      setToasts((prev) => [...prev, { id, type, text, icon }]);
      setTimeout(() => removeToast(id), TOAST_MS);
    },
    [removeToast],
  );

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="toasts">
        {toasts.map((toast, idx) => {
          // depth: 0 — самый новый (спереди), дальше — глубже в стопке.
          const depth = toasts.length - 1 - idx;
          return (
            <div
              key={toast.id}
              className={`toast toast--${toast.type}`}
              role="status"
              style={{
                transform: `translateY(${depth * 10}px) scale(${1 - depth * 0.05})`,
                zIndex: toasts.length - depth,
                opacity: depth >= STACK_VISIBLE ? 0 : 1,
              }}
            >
              <span className="toast__icon" aria-hidden="true">
                {toastIcon(toast)}
              </span>
              <span className="toast__text">{toast.text}</span>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
