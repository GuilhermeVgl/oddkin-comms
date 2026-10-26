import type {
  Device,
  RecoveryAuditEntry,
  RecoveryGap,
} from "@crewstead/api-client";
import type { CallCrypto } from "./callCrypto";
import type { ContentCrypto, Scope } from "./projectCrypto";

export type Phase =
  | "loading"
  | "not_configured" // the organization has no trust root yet
  | "needs_device" // trust root exists, this browser has no device
  | "pending_approval"
  | "locked"
  | "unlocked"
  | "not_enabled" // this person chose (or was invited without) access to history
  | "revoked"
  | "error";

export type PendingApproval = {
  deviceId: string;
  accountId: string;
  email: string;
  name: string;
  signPublicKey: string;
  boxPublicKey: string;
  fingerprint: string;
  /** Present when the device registered through an invitation that carries history. */
  proof?: string;
};

export type E2EEApi = {
  phase: Phase;
  error: string;
  persistent: boolean;
  rootFingerprint: string | null;
  deviceFingerprint: string | null;
  devices: Device[];
  approvals: PendingApproval[];
  canApproveWithRoot: boolean;
  /** An earlier activation stopped half way; the same passphrase finishes it. */
  setupInterrupted: boolean;
  /** This browser was set up by an invitation: no passphrase to type. */
  autoManaged: boolean;
  /**
   * Prepares an invitation that includes history. Null when this browser cannot
   * vouch for it (not the administrator's, or locked).
   */
  beginHistoryInvite(): Promise<{ linkExtra: string; secret: string } | null>;
  rememberHistoryInvite(
    invitationId: string,
    email: string,
    secret: string,
  ): Promise<void>;
  /** Asks to be shown the key step after all (for accounts that chose not to). */
  requestHistoryAccess(): Promise<void>;
  setupOrganization(): Promise<void>;
  setupDevice(): Promise<void>;
  unlock(passphrase: string, remember?: boolean): Promise<boolean>;
  lock(): void;
  approve(approval: PendingApproval): Promise<void>;
  revoke(deviceId: string): Promise<void>;
  /** Makes an offline recovery copy; the key that opens it is returned once, for the person to keep. */
  createBackup(): { content: string; recoveryKey: string } | null;
  /** True when this browser can make a backup. */
  canBackup: boolean;
  resetThisBrowser(): Promise<void>;
  openScope(
    scope: Scope,
    options?: { maintain?: boolean },
  ): Promise<ContentCrypto | null>;
  openProject(
    projectId: string,
    options?: { maintain?: boolean },
  ): Promise<ContentCrypto | null>;
  openConversation(
    conversationId: string,
    options?: { maintain?: boolean },
  ): Promise<ContentCrypto | null>;
  openOrganization(options?: {
    maintain?: boolean;
  }): Promise<ContentCrypto | null>;
  openCall(callId: string): Promise<CallCrypto | null>;
  hasRecoveryIdentity: boolean;
  /** Administrative recovery; only the recovery administrator, only while unlocked. */
  recoveryGaps(): Promise<RecoveryGap[]>;
  restoreAccess(): Promise<{ granted: number; failed: number }>;
  rotateRecoveryIdentity(): Promise<void>;
  recoveryAudit(): Promise<RecoveryAuditEntry[]>;
};
