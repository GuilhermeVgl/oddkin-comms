import type { WorkItem } from "@crewstead/api-client";
import { Banner } from "../../design/primitives";
import type { Conflict } from "./types";

/** Shown when someone else saved the same activity first: compare both texts and choose. */
export function ConflictBanner({
  conflict,
  item,
  onUseCurrent,
  onKeepMine,
}: {
  conflict: Conflict;
  item: WorkItem;
  onUseCurrent: () => void;
  onKeepMine: () => void;
}) {
  return (
    <Banner kind="warn" role="alert">
      <div className="col gap8">
        <div>
          <b>Outra pessoa alterou este item enquanto você editava.</b> Sua
          alteração não foi aplicada (versão v{item.version}). Compare e
          escolha.
        </div>
        <div className="row gap12 wrap">
          <div className="card pad grow dr-conflict-card">
            <span className="xs muted">Atual</span>
            <div>
              {conflict.field === "title" ? item.title : item.description}
            </div>
          </div>
          <div className="card pad grow dr-conflict-card">
            <span className="xs muted">Sua versão</span>
            <div>{conflict.mine}</div>
          </div>
        </div>
        <div className="row gap8">
          <button className="btn sm" onClick={onUseCurrent} type="button">
            Recarregar e usar a atual
          </button>
          <button className="btn sm primary" onClick={onKeepMine} type="button">
            Manter a minha por cima
          </button>
        </div>
      </div>
    </Banner>
  );
}
