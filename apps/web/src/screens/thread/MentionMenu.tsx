import type { ProjectMember } from "@crewstead/api-client";
import { Menu } from "../../design/Menu";
import { nameOf } from "../../design/people";
import { Avatar } from "../../design/primitives";

/** People matching what was typed after "@"; picking one completes the mention. */
export function MentionMenu({
  anchor,
  members,
  onClose,
  onPick,
}: {
  anchor: HTMLElement;
  members: ProjectMember[];
  onClose: () => void;
  onPick: (member: ProjectMember) => void;
}) {
  if (members.length === 0) return null;
  return (
    <Menu anchor={anchor} focusFirst={false} onClose={onClose} up>
      <div className="mh">Mencionar</div>
      {members.map((member) => (
        <button
          key={member.accountId}
          onClick={() => onPick(member)}
          role="menuitem"
          type="button"
        >
          <Avatar email={member.email} id={member.accountId} size="sm" />
          {nameOf(member.email)}
        </button>
      ))}
    </Menu>
  );
}
