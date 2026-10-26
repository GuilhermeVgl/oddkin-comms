import { getFollowing, setFollowing } from "@crewstead/api-client";
import { useCallback, useEffect, useState } from "react";
import { toast, toastError } from "../../design/toast";
import { csrfToken } from "../../errors";
import { useWorkspace } from "../../workspace";

/** Whether the person follows an activity, with an optimistic toggle that rolls back on failure. */
export function useFollowing(itemId: string) {
  const { client } = useWorkspace();
  const [following, setFollowingState] = useState(false);

  useEffect(() => {
    let alive = true;
    getFollowing(client, itemId)
      .then((value) => alive && setFollowingState(value))
      .catch(() => alive && setFollowingState(false));
    return () => {
      alive = false;
    };
  }, [client, itemId]);

  const toggle = useCallback(() => {
    const next = !following;
    setFollowingState(next);
    setFollowing(client, csrfToken(), itemId, next)
      .then(() =>
        toast(
          next
            ? "Você receberá eventos deste item dentro do app."
            : "Você deixou de seguir.",
          { icon: "bell" },
        ),
      )
      .catch(() => {
        setFollowingState(!next);
        toastError("Não foi possível alterar agora.");
      });
  }, [client, itemId, following]);

  return { following, toggle };
}
