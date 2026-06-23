import { createContext, useCallback, useContext, useState } from 'react';

/** Время автозакрытия тоста, мс. */
const TOAST_MS = 4000;

let toastSeq = 0;

/** @type {React.Context<{ showToast: (t: { type?: 'success'|'warning', text: string }) => void } | null>} */
const ToastContext = createContext(null);

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
            <span className="toast__text">{toast.text}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
