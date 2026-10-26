import { dayLine, streakLabel } from "../../design/gamify";
import { Icon } from "../../design/icons";
import { Sprite } from "../../design/Sprite";
import { useStats } from "../../shell/stats";

/** The person's own day: what is still open today, what is done, and the streak. */
export function DayCard({ open, quiet }: { open: number; quiet: boolean }) {
  const { stats } = useStats();
  const finished = stats?.completedToday ?? 0;
  const streak = stats?.currentStreak ?? 0;
  return (
    <section aria-label="Seu dia" className="card dayc">
      <span aria-hidden="true" className="dayc-sp">
        <Sprite
          pose={open === 0 && finished > 0 ? "cheer" : "idle"}
          scale={3}
          who="capuz"
        />
      </span>
      <div className="col grow">
        <span className="dayc-line">
          {quiet && finished === 0
            ? "Nada com prazo para hoje. Pegue a próxima da fila."
            : dayLine(open, finished)}
        </span>
        <div className="dayc-chips">
          {streak > 0 ? (
            <span className="tag lime">
              <Icon name="bell" size="sm" />
              {streakLabel(streak)}
            </span>
          ) : null}
          {stats !== null && stats.bestStreak > streak ? (
            <span className="tag mute">Recorde: {stats.bestStreak} dias</span>
          ) : null}
          {stats !== null && stats.completedTotal > 0 ? (
            <span className="tag mute">
              {stats.completedTotal}{" "}
              {stats.completedTotal === 1 ? "entrega" : "entregas"} no total
            </span>
          ) : null}
        </div>
      </div>
    </section>
  );
}
