import {
  ApiStatusError,
  listAttachments,
  type Attachment,
  type UploadContext,
} from "@crewstead/api-client";
import { useCallback, useEffect, useState } from "react";
import { useOptionalE2EE } from "../e2ee/E2EE";
import { resources, type ContentCrypto } from "../e2ee/projectCrypto";
import { useReloadOn } from "../events";
import type { Client } from "../e2ee/runtime";
import { nameDomainKind, nameSource } from "./rules";

/**
 * The attachments of a work item or conversation, with their readable names
 * (decrypted when this browser can) and the crypto for the context.
 */
export function useAttachmentList(client: Client, context: UploadContext) {
  const [items, setItems] = useState<Attachment[] | null>(null);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [allowed, setAllowed] = useState(true);
  const e2ee = useOptionalE2EE();

  const { contextType, contextId } = context;
  const cryptoFor = useCallback(
    async (maintain: boolean): Promise<ContentCrypto | null> => {
      if (e2ee === null) return null;
      if (contextType === "work_item") {
        return context.projectId === undefined
          ? null
          : e2ee.openProject(context.projectId, { maintain });
      }
      return e2ee.openConversation(contextId, { maintain });
    },
    [context.projectId, contextId, contextType, e2ee],
  );

  const domainKind = useCallback(
    (crypto: ContentCrypto) =>
      nameDomainKind(contextType, crypto.domain("dm") !== undefined),
    [contextType],
  );

  const displayNames = useCallback(
    async (rows: Attachment[], crypto: ContentCrypto | null) => {
      const next = new Map<string, string>();
      for (const item of rows) {
        const source = nameSource(item, crypto !== null);
        if ("text" in source || crypto === null) {
          next.set(item.id, "text" in source ? source.text : item.name);
          continue;
        }
        const result = await crypto.decrypt(domainKind(crypto), {
          resource: resources.attachment(item.id),
          revision: 1,
          ...source.decrypt,
        });
        next.set(
          item.id,
          result.ok ? result.text : "Nome cifrado indisponível",
        );
      }
      return next;
    },
    [domainKind],
  );

  const reload = useCallback(async () => {
    try {
      const rows = await listAttachments(client, { contextType, contextId });
      setItems(rows);
      setNames(await displayNames(rows, await cryptoFor(false)));
      setAllowed(true);
    } catch (error) {
      setAllowed(!(error instanceof ApiStatusError && error.status === 403));
      setItems([]);
    }
  }, [client, contextType, contextId, cryptoFor, displayNames]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Only a resync reloads: uploads and removals reload the list themselves.
  useReloadOn([], () => void reload());

  return { items, names, allowed, reload, cryptoFor, domainKind };
}
