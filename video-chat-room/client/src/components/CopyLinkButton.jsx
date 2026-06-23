import { useEffect, useRef, useState } from 'react';

/** Длительность показа подтверждения «скопировано», мс. */
const CONFIRM_MS = 2000;

/**
 * Кнопка «Скопировать ссылку» (PRD F-03, US-3). Копирует текущий URL комнаты —
 * он же ссылка-приглашение (PRD F-02/F-04) — в буфер обмена и показывает
 * подтверждение. Недоступность буфера (нет secure context/отказ) не валит UI.
 *
 * @returns {JSX.Element}
 */
export default function CopyLinkButton() {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef(null);

  // Снимаем таймер при размонтировании.
  useEffect(() => () => clearTimeout(timerRef.current), []);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
    } catch {
      console.error('[ui] Не удалось скопировать ссылку');
      return;
    }
    setCopied(true);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCopied(false), CONFIRM_MS);
  };

  return (
    <button
      type="button"
      className={`btn btn--secondary${copied ? ' is-copied' : ''}`}
      onClick={handleCopy}
    >
      {copied ? 'Ссылка скопирована' : 'Скопировать ссылку'}
    </button>
  );
}
