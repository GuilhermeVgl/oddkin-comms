import type { WorkItem } from "@crewstead/api-client";
import { Icon } from "../../design/icons";
import { Menu } from "../../design/Menu";
import { toast, toastError } from "../../design/toast";
import { can, type ProjectState } from "../../workspace";
import { useItemActions } from "../itemActions";

/** Copy the link to the activity, or archive it with an undo. */
export function MoreMenu({
  anchor,
  item,
  state,
  onClose,
  onArchived,
}: {
  anchor: HTMLElement;
  item: WorkItem;
  state: ProjectState;
  onClose: () => void;
  onArchived: () => void;
}) {
  const { patch } = useItemActions();

  return (
    <Menu anchor={anchor} onClose={onClose} right>
      <button
        onClick={() => {
          onClose();
          void navigator.clipboard
            ?.writeText(`${window.location.origin}/#/work/${item.id}`)
            .then(() =>
              toast("Link copiado. Só abre para quem tem acesso.", {
                icon: "link",
              }),
            )
            .catch(() => toastError("Não foi possível copiar o link."));
        }}
        role="menuitem"
        type="button"
      >
        <Icon name="link" size="sm" />
        Copiar link
      </button>
      {can(state, "work.archive") ? (
        <>
          <hr />
          <button
            onClick={() => {
              onClose();
              void patch(item, { archived: true }).then((result) => {
                if (result === undefined) return;
                onArchived();
                toast("Atividade arquivada.", {
                  act: [
                    "Desfazer",
                    () => void patch(result, { archived: false }),
                  ],
                });
              });
            }}
            role="menuitem"
            type="button"
          >
            <Icon name="trash" size="sm" />
            Arquivar
          </button>
        </>
      ) : null}
    </Menu>
  );
}
