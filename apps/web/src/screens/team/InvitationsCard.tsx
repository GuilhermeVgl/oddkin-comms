import type { InvitationStatus } from "@crewstead/api-client";
import { rel } from "../../design/format";
import { Avatar } from "../../design/primitives";
import { invitationDetail, invitationTag } from "./teamRules";

export function InvitationsCard({
  invitations,
}: {
  invitations: InvitationStatus[];
}) {
  return (
    <section className="card pad">
      <h2 className="h2 tm-h2-tight">Convites</h2>
      {invitations.map((entry) => {
        const tag = invitationTag(entry.state);
        return (
          <div className="list-i" key={entry.id}>
            <Avatar email={entry.email} id={entry.id} size="lg" />
            <div className="grow col">
              <b>{entry.email}</b>
              <span className="xs muted">{invitationDetail(entry, rel)}</span>
            </div>
            <span className={`tag ${tag.kind}`}>{tag.label}</span>
          </div>
        );
      })}
    </section>
  );
}
