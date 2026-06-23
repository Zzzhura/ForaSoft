/**
 * @typedef {object} NoticeScreenProps
 * @property {string} title - заголовок состояния.
 * @property {string} text - пояснение для пользователя.
 * @property {string} [actionLabel] - текст кнопки действия; без него кнопка не показывается.
 * @property {() => void} [onAction] - обработчик кнопки действия.
 */

/**
 * Полноэкранное уведомление для крайних/ошибочных состояний окружения
 * (задача 19, TDD §8/§13): «Комната заполнена» (PRD п. 8, US-5), сервер
 * недоступен (PRD п. 35, US-13), браузер не поддерживает WebRTC (PRD п. 36,
 * US-13). Кнопка действия опциональна — у части состояний (нет поддержки
 * WebRTC) осмысленного действия нет.
 *
 * @param {NoticeScreenProps} props
 * @returns {JSX.Element}
 */
export default function NoticeScreen({ title, text, actionLabel, onAction }) {
  return (
    <main className="room-notice">
      <h1 className="room-notice__title">{title}</h1>
      <p className="room-notice__text">{text}</p>
      {actionLabel && (
        <button className="btn btn--primary" type="button" onClick={onAction}>
          {actionLabel}
        </button>
      )}
    </main>
  );
}
