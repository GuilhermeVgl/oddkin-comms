import {
  ApiStatusError,
  getExternalPolicy,
  updateExternalPolicy,
  type ExternalPolicy,
} from "@crewstead/api-client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { blip } from "../../design/sound";
import { toast, toastError } from "../../design/toast";
import { describeError } from "../../errors";
import { useWorkspace, type ProjectState } from "../../workspace";
import {
  normalizePermissions,
  policyDirty,
  togglePermission,
  type Permission,
} from "./teamRules";

/** The shared permission profile of a project's externals, with an editable draft. */
export function useExternalPolicy(current: ProjectState) {
  const { client, reload } = useWorkspace();
  const [policy, setPolicy] = useState<ExternalPolicy | null>(null);
  const [draft, setDraft] = useState<Permission[]>([]);
  const [rotation, setRotation] = useState<"" | "pending" | "done">("");

  const loadPolicy = useCallback(async () => {
    if (!current.project.isManager) {
      setPolicy(null);
      return;
    }
    try {
      const value = await getExternalPolicy(client, current.project.id);
      setPolicy(value);
      setDraft([...value.permissions]);
    } catch {
      setPolicy(null);
    }
  }, [client, current]);

  useEffect(() => {
    void loadPolicy();
    setRotation("");
  }, [loadPolicy]);

  const normalized = useMemo(() => normalizePermissions(draft), [draft]);
  const dirty = policyDirty(policy?.permissions ?? null, normalized);

  function toggle(permission: Permission) {
    setDraft((value) => togglePermission(value, permission));
  }

  function discard() {
    if (policy !== null) setDraft([...policy.permissions]);
  }

  async function save() {
    if (policy === null) return;
    const reduced = policy.permissions.some(
      (permission) => !normalized.has(permission),
    );
    try {
      const saved = await updateExternalPolicy(client, current.project.id, {
        permissions: [...normalized],
        version: policy.version,
      });
      setPolicy(saved);
      setDraft([...saved.permissions]);
      blip("ok");
      toast(
        `Política v${saved.version} salva. Vale para todos os externos agora.`,
        {
          icon: "shieldOk",
        },
      );
      if (reduced) {
        setRotation("pending");
        await reload();
        setRotation("done");
      }
    } catch (error) {
      toastError(
        error instanceof ApiStatusError && error.status === 400
          ? "Combinação inválida: as demais permissões exigem ver atividades."
          : describeError(error),
      );
      await loadPolicy();
    }
  }

  return { policy, normalized, dirty, rotation, toggle, discard, save };
}
