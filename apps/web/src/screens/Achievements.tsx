import { ACHIEVEMENTS } from "../design/gamify";
import { Icon } from "../design/icons";
import { useStats } from "../shell/stats";

/** Personal badges: earned ones in colour, the rest with how far there is to go. */
export function Achievements() {
  const { stats } = useStats();
  if (stats === null) return null;
  const earned = ACHIEVEMENTS.filter(
    (entry) => entry.progress(stats) >= entry.goal,
  ).length;
  return (
    <section aria-labelledby="ach-h" className="card pad col gap16">
      <div className="row">
        <h2 className="h2 grow" id="ach-h">
          Conquistas
        </h2>
        <span className="xs muted num">
          {earned} de {ACHIEVEMENTS.length}
        </span>
      </div>
      <ul className="ach-grid">
        {ACHIEVEMENTS.map((entry) => {
          const value = Math.min(entry.goal, entry.progress(stats));
          const got = value >= entry.goal;
          return (
            <li
              aria-label={`${entry.title}: ${got ? "conquistada" : `${value} de ${entry.goal}`}`}
              className={`ach${got ? " got" : ""}`}
              key={entry.id}
            >
              <span aria-hidden="true" className="ach-ic">
                <Icon name={got ? entry.icon : "lock"} />
              </span>
              <b>{entry.title}</b>
              <span className="xs muted">{entry.hint}</span>
              {got ? null : (
                <span aria-hidden="true" className="ach-bar">
                  <i style={{ width: `${(value / entry.goal) * 100}%` }} />
                </span>
              )}
            </li>
          );
        })}
      </ul>
      <p className="xs muted">
        Só você vê suas conquistas. Elas contam entregas, chamadas, foco e
        agradecimentos, nunca o conteúdo do trabalho.
      </p>
    </section>
  );
}
