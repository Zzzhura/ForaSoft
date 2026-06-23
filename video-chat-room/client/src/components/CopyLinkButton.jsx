import { useToast } from './Toast.jsx';

/** Иконка-ссылка (lucide link-2). */
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
    <path d="M9 17H7A5 5 0 0 1 7 7h2" />
    <path d="M15 7h2a5 5 0 1 1 0 10h-2" />
    <line x1="8" x2="16" y1="12" y2="12" />
  </svg>
);

/**
 * Кнопка-иконка «Скопировать ссылку» (PRD F-03, US-3). Копирует текущий URL
 * комнаты — он же ссылка-приглашение (PRD F-02/F-04) — в буфер обмена и
 * показывает тост-подтверждение. Недоступность буфера (нет secure context/отказ)
 * не валит UI.
 *
 * @returns {JSX.Element}
 */
export default function CopyLinkButton() {
  const { showToast } = useToast();

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
    } catch {
      console.error('[ui] Не удалось скопировать ссылку');
      return;
    }
    showToast({ type: 'success', text: 'Ссылка скопирована' });
  };

  return (
    <button
      type="button"
      className="ctrl-btn"
      onClick={handleCopy}
      aria-label="Скопировать ссылку"
      title="Скопировать ссылку"
    >
      <LinkIcon />
    </button>
  );
}
