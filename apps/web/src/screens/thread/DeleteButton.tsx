import { confirmDialog } from "../../design/confirm";
import { Icon } from "../../design/icons";
import { toast } from "../../design/toast";

/** Asks for confirmation, then deletes; moderators get a different label. */
export function DeleteButton({
  moderate = false,
  onDelete,
}: {
  moderate?: boolean;
  onDelete: () => Promise<void>;
}) {
  return (
    <button
      aria-label={moderate ? "Moderar: remover mensagem" : "Apagar"}
      onClick={() => {
        void confirmDialog({
          title: "Apagar mensagem?",
          body: (
            <p className="muted">
              Ela vira um tombstone: respostas que a citavam passam a mostrar
              “Mensagem indisponível”, sem trecho residual. Cópias em backups
              expiram conforme a retenção.
            </p>
          ),
          ok: "Apagar",
          danger: true,
        }).then(async (ok) => {
          if (ok !== true) return;
          await onDelete();
          toast("Mensagem apagada.", { icon: "trash" });
        });
      }}
      type="button"
    >
      <Icon name="trash" size="sm" />
    </button>
  );
}
