import { useEffect, useState } from "react";
import { blip } from "../../design/sound";
import { toast, toastError } from "../../design/toast";
import { saveItem } from "../../e2ee/content";
import { csrfToken } from "../../errors";
import { useWorkspace } from "../../workspace";
import { isVersionConflict, itemEdit, textSaveAction } from "./derive";
import type { TextField } from "./derive";
import type { Conflict, DrawerEntry } from "./types";

/** The title and description being edited, their save-on-blur and the 409 conflict flow. */
export function useItemText({ item, state }: DrawerEntry, canEdit: boolean) {
  const { client, run } = useWorkspace();
  const [title, setTitle] = useState(item.title);
  const [description, setDescription] = useState(item.description);
  const [conflict, setConflict] = useState<Conflict | null>(null);

  useEffect(() => {
    setTitle(item.title);
    setDescription(item.description);
  }, [item.id, item.version, item.title, item.description]);

  async function saveText(field: TextField, value: string) {
    if (!canEdit) return;
    const action = textSaveAction(item, field, value);
    if (action === "restore-title") setTitle(item.title);
    if (action !== "save") return;
    try {
      await saveItem(
        client,
        csrfToken(),
        state.crypto,
        item,
        itemEdit(item, field, value),
      );
      toast("Salvo.", { ms: 1400 });
      await run(async () => undefined);
    } catch (error) {
      if (isVersionConflict(error)) {
        await run(async () => undefined);
        setConflict({
          field,
          mine: value,
          theirs: field === "title" ? item.title : item.description,
        });
        blip("err");
      } else {
        await run(async () => {
          throw error;
        });
      }
    }
  }

  /** Saves the person's text over the newer version. */
  function keepMine() {
    if (conflict === null) return;
    const kept = conflict;
    setConflict(null);
    void saveItem(
      client,
      csrfToken(),
      state.crypto,
      item,
      itemEdit(item, kept.field, kept.mine),
    )
      .then(() => toast("Sua versão foi salva sobre a mais recente."))
      .catch(() => toastError("Não foi possível salvar."))
      .finally(() => void run(async () => undefined));
  }

  return {
    title,
    setTitle,
    description,
    setDescription,
    conflict,
    dismissConflict: () => setConflict(null),
    keepMine,
    saveText,
  };
}
