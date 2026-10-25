/** A readable first name from an e-mail address (accounts carry no display name yet). */
export function nameOf(email: string): string {
  const local = email.split("@")[0]?.replace(/[._-]+/g, " ") ?? "equipe";
  return local.replace(/\b\p{L}/gu, (letter) =>
    letter.toLocaleUpperCase("pt-BR"),
  );
}

export function firstNameOf(email: string): string {
  return nameOf(email).split(" ")[0] ?? "";
}

/** A stable colour slot (1 to 6) for an avatar. */
export function colorOf(id: string): number {
  let hash = 0;
  for (const character of id)
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return (hash % 6) + 1;
}
