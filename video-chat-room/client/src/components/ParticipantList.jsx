/**
 * @typedef {object} Participant
 * @property {string} socketId - внутренний идентификатор участника (не в UI).
 * @property {string} name - отображаемое имя (может повторяться, PRD п. 30).
 */

/**
 * Список участников комнаты в реальном времени (PRD F-16, US-9). Обновляется
 * при изменении `members` родителем (`RoomScreen`, задача 18). Собственная
 * запись помечается «(Вы)»; одинаковые имена допускаются — ключ по `socketId`.
 *
 * @param {{ members: Participant[], selfId?: string }} props
 * @returns {JSX.Element}
 */
export default function ParticipantList({ members, selfId }) {
  return (
    <section className="participants" aria-label="Участники комнаты">
      <h2 className="participants__title">Участники ({members.length})</h2>
      <ul className="participants__list">
        {members.map((member) => (
          <li key={member.socketId} className="participants__item">
            <span className="participants__name">{member.name}</span>
            {member.socketId === selfId && <span className="participants__self"> (Вы)</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}
