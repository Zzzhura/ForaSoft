import { useState } from 'react';
import { NAME_MAX_LEN, sanitizeNameInput, normalizeName } from '../lib/name.js';

/**
 * @typedef {object} EntryScreenProps
 * @property {string} title - заголовок под логотипом.
 * @property {string} byline - подпись под заголовком.
 * @property {string} caption - пояснительный текст под карточкой.
 * @property {string} placeholder - плейсхолдер поля имени.
 * @property {string} submitLabel - текст кнопки отправки.
 * @property {(name: string) => void} onSubmit - вызывается с нормализованным именем
 *           (при `optionalName` может прийти пустая строка — имя необязательно).
 * @property {boolean} [optionalName] - ввод имени необязателен (пустое разрешено).
 * @property {React.ReactNode} [mediaPreview] - превью-плитка с видео участника и
 *           кнопками устройств; показывается над формой при входе в комнату.
 */

/**
 * Общий экран ввода имени для стартового экрана (задача 13) и входа по
 * ссылке-приглашению (задача 14). Раскладка/стили повторяют референс
 * chat.forasoft.com. Валидация имени (≤30, без спецсимволов, запрет пустого) —
 * PRD п. 38, US-1; источник истины на сервере (`validation.js`).
 *
 * @param {EntryScreenProps} props
 * @returns {JSX.Element}
 */
export default function EntryScreen({
  title,
  byline,
  caption,
  placeholder,
  submitLabel,
  onSubmit,
  optionalName = false,
  mediaPreview = null,
}) {
  const [name, setName] = useState('');

  // При необязательном имени форма валидна всегда (пустое допустимо).
  const isValid = optionalName || normalizeName(name).length > 0;
  // Вариант формы входа в комнату (с превью): шире, без фона/тени у карточки.
  const withPreview = Boolean(mediaPreview);

  // Спецсимволы и переполнение не попадают в поле — фильтруем на вводе (PRD п. 38).
  const handleChange = (event) => setName(sanitizeNameInput(event.target.value));

  const handleSubmit = (event) => {
    event.preventDefault();
    const cleanName = normalizeName(name);
    // Обязательное имя: пустое не отправляем. Необязательное: пустую строку
    // отдаём наверх — там подставится гостевое имя.
    if (!optionalName && cleanName.length === 0) {
      return;
    }
    onSubmit(cleanName);
  };

  return (
    <main className={`start${withPreview ? ' start--join' : ''}`}>
      <div className="start__col">
        <div className="start__hero">
          {/* На форме подключения (с превью) логотип не показываем. */}
          {!withPreview && (
            <img
              className="start__logo"
              src="/forasoft-logo.svg"
              alt="Fora Soft"
              width="48"
              height="48"
            />
          )}
          <div className="start__heading">
            <h1 className="start__title">{title}</h1>
            <a
              className="start__byline"
              href="https://www.forasoft.com/"
              target="_blank"
              rel="noreferrer"
            >
              <span>{byline}</span>
            </a>
          </div>
        </div>

        {/* Превью участника с кнопками устройств — над формой (вход в комнату). */}
        {mediaPreview}

        <section className={`card start__card${withPreview ? ' start__card--bare' : ''}`}>
          <form className="start-form" onSubmit={handleSubmit} noValidate>
            <label className="visually-hidden" htmlFor="name">
              Ваше имя
            </label>
            <div className="start-form__field">
              {/* Иконка камеры — декоративный префикс по образцу демо. */}
              <svg
                className="start-form__icon"
                viewBox="0 0 24 24"
                width="16"
                height="16"
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
              <input
                id="name"
                className="field field--with-icon"
                type="text"
                value={name}
                onChange={handleChange}
                placeholder={placeholder}
                maxLength={NAME_MAX_LEN}
                autoComplete="off"
                autoFocus
              />
            </div>
            <button className="btn btn--primary btn--block" type="submit" disabled={!isValid}>
              {submitLabel}
            </button>
          </form>
        </section>

        {caption && <p className="start__caption">{caption}</p>}
      </div>

      <footer className="start__footer">
        <span>Разработано</span>
        <a
          className="start__footer-link"
          href="https://www.forasoft.com/"
          target="_blank"
          rel="noreferrer"
        >
          <img className="start__footer-logo" src="/forasoft-logo-full.svg" alt="Fora Soft" />
        </a>
      </footer>
    </main>
  );
}
