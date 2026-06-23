import { createContext, useCallback, useContext, useState } from 'react';

/** Время автозакрытия тоста, мс. */
const TOAST_MS = 4000;

let toastSeq = 0;

/** @type {React.Context<{ showToast: (t: { type?: 'success'|'warning', text: string }) => void } | null>} */
const ToastContext = createContext(null);

/** Иконка-галочка (успех). */
const CheckIcon = () => (
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
    <path d="M21.801 10A10 10 0 1 1 17 3.335" />
    <path d="m9 11 3 3L22 4" />
  </svg>
);

/** Иконка-предупреждение. */
const WarnIcon = () => (
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
    <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
    <path d="M12 9v4" />
    <path d="M12 17h.01" />
  </svg>
);

/**
 * Хук доступа к тостам. Должен использоваться внутри `ToastProvider`.
 * @returns {{ showToast: (t: { type?: 'success'|'warning', text: string }) => void }}
 */
export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast должен использоваться внутри <ToastProvider>');
  }
  return ctx;
}

/**
 * Провайдер тостов: всплывающие уведомления в правом верхнем углу
 * (подтверждение копирования ссылки — PRD F-03/US-3; отказ в доступе к
 * устройствам — PRD п. 33/US-12). Автозакрытие через `TOAST_MS`.
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
    ({ type = 'success', text }) => {
      const id = ++toastSeq;
      setToasts((prev) => [...prev, { id, type, text }]);
      setTimeout(() => removeToast(id), TOAST_MS);
    },
    [removeToast],
  );

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="toasts">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast toast--${toast.type}`} role="status">
            <span className="toast__icon">
              {toast.type === 'warning' ? <WarnIcon /> : <CheckIcon />}
            </span>
            <span className="toast__text">{toast.text}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
