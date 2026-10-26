import { describe, expect, it } from "vitest";
import {
  callTitle,
  elapsedSeconds,
  formatClock,
  orderParticipants,
  participantsCount,
  prejoinSubtitle,
  rotationNotice,
  splitDevices,
  tileLabel,
} from "./callView";

const channels = [{ id: "c1", name: "geral" }];
const dms = [{ id: "d1", peerEmail: "ana.souza@example.test" }];

describe("callTitle", () => {
  it("is generic while the call loads", () => {
    expect(callTitle(null, channels, dms)).toBe("Chamada");
  });

  it("names a channel with a hash and a direct conversation by the peer", () => {
    expect(callTitle({ conversationId: "c1" }, channels, dms)).toBe("#geral");
    expect(callTitle({ conversationId: "d1" }, channels, dms)).toBe(
      "Ana Souza",
    );
  });

  it("falls back for a conversation the person cannot list", () => {
    expect(callTitle({ conversationId: "zz" }, channels, dms)).toBe(
      "Conversa direta",
    );
  });
});

describe("orderParticipants", () => {
  it("keeps the order when nobody shares", () => {
    expect(orderParticipants(["a", "b"], undefined)).toEqual(["a", "b"]);
  });

  it("puts the presenter first", () => {
    expect(orderParticipants(["a", "b", "c"], "c")).toEqual(["c", "a", "b"]);
  });

  it("does not change the list it was given", () => {
    const list = ["a", "b"];
    orderParticipants(list, "b");
    expect(list).toEqual(["a", "b"]);
  });
});

describe("clock", () => {
  it("pads minutes and seconds", () => {
    expect(formatClock(0)).toBe("00:00");
    expect(formatClock(65)).toBe("01:05");
    expect(formatClock(3600)).toBe("60:00");
  });

  it("never goes negative when the clocks disagree", () => {
    expect(elapsedSeconds(1_000, 5_000)).toBe(0);
    expect(elapsedSeconds(6_999, 1_000)).toBe(5);
  });
});

describe("tileLabel", () => {
  it("speaks the state of the participant", () => {
    expect(tileLabel("ana@x.test", { muted: false, speaking: false })).toBe(
      "Ana",
    );
    expect(tileLabel("ana@x.test", { muted: true, speaking: false })).toBe(
      "Ana, microfone desligado",
    );
    expect(tileLabel("ana@x.test", { muted: false, speaking: true })).toBe(
      "Ana, falando",
    );
  });
});

describe("notices", () => {
  it("tells a rotation from a wait for the key", () => {
    expect(
      rotationNotice({ keyState: "rotation_required", keyGeneration: 3 }),
    ).toBe(
      "Rotacionando chave de mídia… publicação bloqueada até confirmar a chave v3",
    );
    expect(rotationNotice({ keyState: "pending_keys", keyGeneration: 2 })).toBe(
      "Aguardando a chave… publicação bloqueada até confirmar a chave v2",
    );
  });

  it("counts participants out of the limit, five by default", () => {
    expect(participantsCount(2, 5)).toBe("2 de 5 participantes");
    expect(participantsCount(1, undefined)).toBe("1 de 5 participantes");
  });

  it("summarises the call before joining", () => {
    expect(prejoinSubtitle(null)).toBe("Carregando a chamada…");
    expect(
      prejoinSubtitle({
        participants: [{ accountId: "a", email: "a@x.test", state: "joined" }],
        maxParticipants: 5,
      }),
    ).toBe("1/5 participantes agora. Até 5 pessoas.");
  });
});

describe("splitDevices", () => {
  it("separates microphones from cameras and drops speakers", () => {
    const device = (kind: MediaDeviceKind) => ({ kind });
    const { microphones, cameras } = splitDevices([
      device("audioinput"),
      device("videoinput"),
      device("audiooutput"),
      device("videoinput"),
    ]);
    expect(microphones).toHaveLength(1);
    expect(cameras).toHaveLength(2);
  });
});
