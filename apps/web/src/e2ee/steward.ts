import {
  getConversationKeyDomain,
  getSprintKeyDomain,
  listDirectConversations,
  listKeyDomains,
  listProjects,
  type KeyDomain,
} from "@crewstead/api-client";
import type { Client } from "./runtime";

/** A domain that has keys but whose recipients or generation are out of date. */
export function needsMaintenance(
  domain: Pick<KeyDomain, "currentGeneration" | "state">,
): boolean {
  return domain.currentGeneration !== 0 && domain.state !== "ok";
}

/**
 * Every key domain this device can see: each project's, each direct
 * conversation's and the sprint domain. A list that fails to load is skipped;
 * the next event looks again.
 */
export async function listReadableDomains(
  client: Client,
): Promise<KeyDomain[]> {
  const domains: KeyDomain[] = [];
  for (const project of await listProjects(client).catch(() => [])) {
    domains.push(...(await listKeyDomains(client, project.id).catch(() => [])));
  }
  for (const dm of await listDirectConversations(client).catch(() => [])) {
    const domain = await getConversationKeyDomain(client, dm.id).catch(
      () => null,
    );
    if (domain !== null) domains.push(domain);
  }
  const sprint = await getSprintKeyDomain(client).catch(() => null);
  if (sprint !== null) domains.push(sprint);
  return domains;
}
