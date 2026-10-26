import {
  getWorkItemEngagement,
  setKudos,
  type WorkItemEngagement,
} from "@crewstead/api-client";
import { useCallback, useEffect, useState } from "react";
import { blip } from "../../design/sound";
import { toast, toastError } from "../../design/toast";
import { useStats } from "../../shell/stats";
import { useWorkspace } from "../../workspace";

/** Focus time and thanks on an activity; reloads when the column changes or a focus block ends. */
export function useEngagement(
  itemId: string,
  columnId: string,
  focusActive: boolean,
) {
  const { client } = useWorkspace();
  const { refresh: refreshStats } = useStats();
  const [engagement, setEngagement] = useState<WorkItemEngagement | null>(null);

  const load = useCallback(async () => {
    try {
      setEngagement(await getWorkItemEngagement(client, itemId));
    } catch {
      setEngagement(null);
    }
  }, [client, itemId]);

  useEffect(() => {
    void load();
  }, [load, columnId]);

  // Time recorded by a focus block that just ended shows up here too.
  useEffect(() => {
    if (!focusActive) void load();
  }, [focusActive, load]);

  async function thank() {
    if (engagement === null) return;
    const next = !engagement.kudosMine;
    setEngagement({
      ...engagement,
      kudosMine: next,
      kudosCount: engagement.kudosCount + (next ? 1 : -1),
    });
    try {
      await setKudos(client, itemId, next);
      if (next) {
        blip("ok");
        toast("Agradecimento enviado.", { icon: "smile" });
      }
      void refreshStats();
    } catch {
      toastError("Não foi possível agradecer agora.");
    }
    await load();
  }

  return { engagement, thank };
}
