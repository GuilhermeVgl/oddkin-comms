import { MILESTONES } from "./gamify";

/**
 * The sprint's shared progress: a bar with a marker at each milestone that
 * lights up once the team gets there. No one is compared with anyone.
 */
export function MissionBar({ done, total }: { done: number; total: number }) {
  const share = total > 0 ? Math.min(100, (done / total) * 100) : 0;
  const left = Math.max(0, total - done);
  return (
    <div className="mission">
      <div
        aria-label={`${done} de ${total} concluídas`}
        aria-valuemax={total}
        aria-valuemin={0}
        aria-valuenow={done}
        className="mission-bar"
        role="progressbar"
      >
        <i style={{ width: `${share}%` }} />
        {MILESTONES.map((milestone) => (
          <b
            className={share >= milestone ? "hit" : ""}
            key={milestone}
            style={{ left: `${milestone}%` }}
          />
        ))}
      </div>
      <span className="xs muted">
        {total === 0
          ? "Sem atividades na sprint ainda."
          : left === 0
            ? "Missão cumprida."
            : `Faltam ${left} ${left === 1 ? "atividade" : "atividades"} para cumprir a missão.`}
      </span>
    </div>
  );
}
