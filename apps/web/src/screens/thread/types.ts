import type { ProjectMember } from "@crewstead/api-client";
import type { ContentCrypto } from "../../e2ee/projectCrypto";

export type ThreadTarget =
  | {
      kind: "chat";
      id: string;
      title: string;
      subtitle: string;
      members: ProjectMember[];
      crypto: ContentCrypto | null;
      moderator: boolean;
      canSend: boolean;
      canCall: boolean;
      canReact: boolean;
      canUpload: boolean;
    }
  | {
      kind: "dm";
      id: string;
      title: string;
      subtitle: string;
      peerEmail: string;
      peerId: string;
    };
