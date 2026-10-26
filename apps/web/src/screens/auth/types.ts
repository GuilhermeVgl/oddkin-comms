export type PendingInvitation = {
  email: string;
  token: string;
  /** Present when the invitation includes history: the secret and the root fingerprint from the link. */
  historyKey?: string;
  rootFingerprint?: string;
};
