import { listComments } from "@crewstead/api-client";
import { useCallback, useEffect, useState } from "react";
import { blip } from "../../design/sound";
import { createCommentContent, decryptComments } from "../../e2ee/content";
import { useWorkspace } from "../../workspace";
import type { ContentCrypto } from "../../e2ee/projectCrypto";
import type { Comment } from "./types";

/** The comments of an activity, decrypted when this browser can, and a way to post one. */
export function useComments(itemId: string, crypto: ContentCrypto | null) {
  const { client, run } = useWorkspace();
  const [comments, setComments] = useState<Comment[] | null>(null);

  const load = useCallback(async () => {
    try {
      setComments(
        await decryptComments(crypto, await listComments(client, itemId)),
      );
    } catch {
      setComments([]);
    }
  }, [client, itemId, crypto]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Posts a comment; `onPosted` runs once the server has it, before the list reloads. */
  const post = useCallback(
    (body: string, onPosted: () => void) =>
      run(async () => {
        await createCommentContent(client, crypto, itemId, body);
        onPosted();
        await load();
        blip("ok");
      }),
    [client, run, crypto, itemId, load],
  );

  return { comments, post };
}
