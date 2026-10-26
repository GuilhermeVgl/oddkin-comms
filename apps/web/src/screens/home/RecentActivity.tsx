import { rel } from "../../design/format";
import { Avatar, NoAvatar } from "../../design/primitives";
import { useWorkspace } from "../../workspace";
import type { Entry } from "../work/workRules";

export function RecentActivity({ feed }: { feed: Entry[] }) {
  const { people } = useWorkspace();
  return (
    <section className="card pad">
      <h2 className="h2">Atividade recente</h2>
      {feed.length === 0 ? (
        <p className="muted sm hm-mt8">Sem novidades por aqui.</p>
      ) : (
        <ul className="feed hm-mt6">
          {feed.map(({ item, state }) => {
            const owner =
              item.assigneeId === undefined
                ? undefined
                : people.get(item.assigneeId);
            return (
              <li key={item.id}>
                {owner === undefined ? (
                  <NoAvatar size="sm" />
                ) : (
                  <Avatar email={owner.email} id={owner.id} size="sm" />
                )}
                <span className="grow">
                  <b>{item.title}</b> foi atualizada · {state.project.name}
                </span>
                <time className="xs muted">{rel(item.updatedAt)}</time>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
