import type { WorkItem } from "@crewstead/api-client";
import { useEffect, useRef } from "react";
import { Attachments } from "../Attachments";
import { isDone } from "../columns";
import { Banner } from "../design/primitives";
import { useMenu } from "../design/Menu";
import { can, useWorkspace, type ProjectState } from "../workspace";
import { CommentSection } from "./drawer/CommentSection";
import { ConflictBanner } from "./drawer/ConflictBanner";
import { DrawerFooter } from "./drawer/DrawerFooter";
import { DrawerHeader } from "./drawer/DrawerHeader";
import { HistorySection } from "./drawer/HistorySection";
import { MoreMenu } from "./drawer/MoreMenu";
import { PropertyTiles } from "./drawer/PropertyTiles";
import { SubtaskList } from "./drawer/SubtaskList";
import { useDrawerClose } from "./drawer/useDrawerClose";
import { useFollowing } from "./drawer/useFollowing";
import { useItemText } from "./drawer/useItemText";

/** The detail of one activity: every field, subtasks, files and comments. */
export function Drawer({
  entry,
  meId,
  onClose,
}: {
  entry: { item: WorkItem; state: ProjectState };
  meId: string;
  onClose: () => void;
}) {
  const { item, state } = entry;
  const { client, sprints, people } = useWorkspace();
  const close = useRef<HTMLButtonElement>(null);
  const more = useMenu();
  const { leaving, closeSoon } = useDrawerClose(onClose);
  const { following, toggle: toggleFollow } = useFollowing(item.id);

  const status = state.status.get(item.id) ?? "plain";
  const readable = status === "plain" || status === "ok";
  const canEdit = can(state, "work.edit") && readable;
  const canComment = can(state, "work.comment");
  const canMove = can(state, "work.move");
  const canPlan = can(state, "planning.edit");
  const done = isDone(state.columns, item.columnId);
  const encrypted = item.encrypted || state.keyed;
  const text = useItemText(entry, canEdit);

  useEffect(() => close.current?.focus(), [item.id]);

  const sprint = sprints.find((value) => value.id === item.sprintId);
  const assignee =
    item.assigneeId === undefined ? undefined : people.get(item.assigneeId);

  return (
    <>
      <div className="scrim dscrim" onClick={closeSoon} />
      <aside
        aria-label={`Detalhe da atividade: ${item.title}`}
        aria-modal="true"
        className={`itemdlg${leaving ? " out" : ""}`}
        role="dialog"
      >
        <DrawerHeader
          closeRef={close}
          following={following}
          itemId={item.id}
          onClose={closeSoon}
          onMore={(anchor) => more.toggle(anchor, undefined)}
          onToggleFollow={toggleFollow}
          project={state.project}
        />
        <div className="im-body">
          <div>
            <input
              aria-label="Título"
              className="titleinp"
              maxLength={200}
              onBlur={() => void text.saveText("title", text.title)}
              onChange={(event) => text.setTitle(event.target.value)}
              readOnly={!canEdit}
              value={text.title}
            />
          </div>
          {text.conflict === null ? null : (
            <ConflictBanner
              conflict={text.conflict}
              item={item}
              onKeepMine={text.keepMine}
              onUseCurrent={text.dismissConflict}
            />
          )}
          {!canEdit ? (
            <Banner icon="lock">
              {readable ? (
                <>
                  Seu perfil neste projeto permite{" "}
                  <b>{canComment ? "ler e comentar" : "apenas ler"}</b>. Campos
                  de edição estão bloqueados.
                </>
              ) : (
                <>
                  Este conteúdo está cifrado e não pôde ser lido neste
                  navegador; a edição está desativada.
                </>
              )}
            </Banner>
          ) : null}
          <PropertyTiles
            canEdit={canEdit}
            canMove={canMove}
            canPlan={canPlan}
            done={done}
            entry={entry}
          />
          <div className="im-cols">
            <div className="im-left">
              <div className="field">
                <label htmlFor="ds">Descrição</label>
                <textarea
                  className="inp"
                  id="ds"
                  maxLength={50000}
                  onBlur={() =>
                    void text.saveText("description", text.description)
                  }
                  onChange={(event) => text.setDescription(event.target.value)}
                  placeholder="Sem descrição"
                  readOnly={!canEdit}
                  rows={4}
                  value={text.description}
                />
                <span className="hint">
                  Até 50 mil caracteres
                  {encrypted ? " · cifrado neste dispositivo" : ""}
                </span>
              </div>
              <SubtaskList
                canMove={canMove}
                entry={entry}
                readable={readable}
              />
              <Attachments
                canUpload={can(state, "files.upload")}
                client={client}
                context={{
                  contextType: "work_item",
                  contextId: item.id,
                  projectId: item.projectId,
                }}
              />
            </div>
            <div className="im-right">
              <CommentSection canComment={canComment} entry={entry} />
              <HistorySection assignee={assignee} item={item} sprint={sprint} />
            </div>
          </div>
        </div>
        <DrawerFooter
          canMove={canMove}
          done={done}
          encrypted={encrypted}
          entry={entry}
          meId={meId}
        />
      </aside>
      {more.state === null ? null : (
        <MoreMenu
          anchor={more.state.anchor}
          item={item}
          onArchived={closeSoon}
          onClose={more.close}
          state={state}
        />
      )}
    </>
  );
}
