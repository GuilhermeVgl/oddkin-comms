import { setInvitePolicy, type InvitePolicy } from "@crewstead/api-client";
import { toast, toastError } from "../../design/toast";
import { describeError } from "../../errors";
import { useWorkspace, type ProjectState } from "../../workspace";
import { INVITE_POLICIES } from "./teamRules";

export function InvitePolicyCard({
  current,
  invitePolicy,
}: {
  current: ProjectState;
  invitePolicy: InvitePolicy;
}) {
  const { client, reload } = useWorkspace();

  async function changePolicy(policy: InvitePolicy) {
    if (policy === invitePolicy) return;
    try {
      await setInvitePolicy(client, current.project.id, policy);
      toast("Regra de convites atualizada.", { icon: "check" });
      await reload();
    } catch (error) {
      toastError(describeError(error));
    }
  }

  return (
    <section className="card pad col gap8">
      <h2 className="h2">Quem pode convidar</h2>
      <p className="xs muted">
        A administração sempre pode. Gestores e membros só convidam pessoas
        externas para este projeto; quem é de dentro da organização entra pelo
        convite da administração.
      </p>
      <div aria-label="Quem pode convidar" className="seg" role="group">
        {INVITE_POLICIES.map(([value, label]) => (
          <button
            aria-pressed={invitePolicy === value}
            key={value}
            onClick={() => void changePolicy(value)}
            type="button"
          >
            {label}
          </button>
        ))}
      </div>
    </section>
  );
}
