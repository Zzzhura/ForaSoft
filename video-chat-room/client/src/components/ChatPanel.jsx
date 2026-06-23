import { useEffect, useRef, useState } from 'react';

/**
 * @typedef {object} ChatMessage
 * @property {string} id - уникальный идентификатор сообщения.
 * @property {'user'|'system'} type - пользовательское или системное (PRD F-15).
 * @property {string} [name] - имя отправителя (для `type: 'user'`).
 * @property {string} text - текст сообщения (уже экранирован сервером).
 * @property {number} ts - метка времени, Unix-ms.
 */

/** Время сообщения в HH:MM по локали клиента (PRD F-13). */
const formatTime = (ts) =>
  new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

/** Иконка чата (lucide message-square). */
const ChatBubbleIcon = () => (
  <svg
    viewBox="0 0 24 24"
    width="18"
    height="18"
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

/** Иконка закрытия панели (lucide x). */
const CloseIcon = () => (
  <svg
    viewBox="0 0 24 24"
    width="18"
    height="18"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />
  </svg>
);

/** Иконка отправки (lucide send). */
const SendIcon = () => (
  <svg
    viewBox="0 0 24 24"
    width="18"
    height="18"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z" />
    <path d="m21.854 2.147-10.94 10.939" />
  </svg>
);

/**
 * Панель чата (референс chat.forasoft.com): хедер с заголовком и кнопкой закрытия,
 * лента сообщений с автоскроллом (или пустое состояние) и поле ввода с кнопкой
 * отправки (PRD F-12/F-13/F-14, US-8). Пустые/пробельные сообщения не отправляются
 * (PRD п. 24). Текст рендерится React'ом как текст, без `dangerouslySetInnerHTML` —
 * защита от XSS (PRD п. 39, TDD §10); сервер экранирует дополнительно.
 *
 * Кнопка отправки неактивна (серая) при пустом вводе и становится акцентной
 * (синей) при наличии текста.
 *
 * @param {{ messages: ChatMessage[], onSend: (text: string) => void, onClose?: () => void }} props
 * @returns {JSX.Element}
 */
export default function ChatPanel({ messages, onSend, onClose }) {
  const [text, setText] = useState('');
  const bottomRef = useRef(null);
  const canSend = text.trim().length > 0;

  // Автоскролл к последнему сообщению при изменении ленты (PRD F-14, US-8).
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages]);

  const handleSubmit = (event) => {
    event.preventDefault();
    if (!canSend) {
      return;
    }
    onSend(text.trim());
    setText('');
  };

  return (
    <section className="chat">
      <header className="chat__header">
        <span className="chat__header-icon">
          <ChatBubbleIcon />
        </span>
        <h2 className="chat__title">Чат</h2>
        {onClose && (
          <button
            type="button"
            className="chat__close"
            onClick={onClose}
            aria-label="Скрыть чат"
            title="Скрыть чат"
          >
            <CloseIcon />
          </button>
        )}
      </header>

      <div className="chat__list">
        {messages.length === 0 ? (
          <div className="chat__empty">
            <span className="chat__empty-icon">
              <ChatBubbleIcon />
            </span>
            <p className="chat__empty-title">Пока нет сообщений</p>
            <p className="chat__empty-text">Отправьте сообщение, чтобы начать общение</p>
          </div>
        ) : (
          messages.map((message) =>
            message.type === 'system' ? (
              <p key={message.id} className="chat__system">
                {message.text}
              </p>
            ) : (
              <div key={message.id} className="chat__message">
                <div className="chat__meta">
                  <span className="chat__author">{message.name}</span>
                  <span className="chat__time">{formatTime(message.ts)}</span>
                </div>
                <p className="chat__text">{message.text}</p>
              </div>
            ),
          )
        )}
        <div ref={bottomRef} />
      </div>

      <form className="chat__form" onSubmit={handleSubmit}>
        <input
          className="field chat__input"
          type="text"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Написать сообщение…"
          autoComplete="off"
        />
        <button className="chat__send" type="submit" disabled={!canSend} aria-label="Отправить">
          <SendIcon />
        </button>
      </form>
    </section>
  );
}
