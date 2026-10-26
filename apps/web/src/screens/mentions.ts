import { firstNameOf } from "../design/people";

type Mentionable = { accountId: string; email: string };

/** The first names that turn into a highlighted @mention in rendered text. */
export function mentionNames(members: { email: string }[]): Set<string> {
  return new Set(members.map((member) => firstNameOf(member.email)));
}

/** The accounts a text mentions, by `@FirstName`. */
export function mentionedAccountIds(
  members: Mentionable[],
  body: string,
): string[] {
  return members
    .filter((member) => body.includes(`@${firstNameOf(member.email)}`))
    .map((member) => member.accountId);
}
