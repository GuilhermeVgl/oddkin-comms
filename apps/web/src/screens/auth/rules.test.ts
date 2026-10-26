import { describe, expect, it } from "vitest";
import {
  accountMatchesInvitation,
  fingerprintCells,
  invitationRejection,
  LOGIN_LINES,
  loginFailure,
  MIN_PASSWORD,
  parseInviteForm,
  passwordsMismatch,
  poseForLine,
  resetConfirmFailure,
  resetRequestOutcome,
} from "./rules";

const TOKEN = "A".repeat(43);

describe("loginFailure", () => {
  it("warns about throttling and outages but blames credentials otherwise", () => {
    expect(loginFailure("rate-limited").kind).toBe("warn");
    expect(loginFailure("rate-limited").text).toContain("Muitas tentativas");
    expect(loginFailure("unavailable")).toEqual({
      kind: "warn",
      text: "O serviço está temporariamente indisponível.",
    });
    expect(loginFailure("invalid-credentials")).toEqual({
      kind: "err",
      text: "E-mail ou senha incorretos. Confira os dados e tente de novo.",
    });
  });
});

describe("resetRequestOutcome", () => {
  it("answers the same way for any address once accepted", () => {
    expect(resetRequestOutcome("accepted")).toEqual({
      message: "Se existir uma conta, o link foi enviado.",
      failed: false,
    });
  });

  it("reports throttling and unavailable mail as failures", () => {
    expect(resetRequestOutcome("rate-limited")).toEqual({
      message: "Muitas tentativas. Aguarde um instante.",
      failed: true,
    });
    expect(resetRequestOutcome("unavailable")).toEqual({
      message: "O envio de e-mails não está disponível agora.",
      failed: true,
    });
  });
});

describe("resetConfirmFailure", () => {
  it("names the minimum length for a weak password", () => {
    expect(resetConfirmFailure("weak")).toBe(
      `Use pelo menos ${MIN_PASSWORD} caracteres.`,
    );
  });

  it("separates throttling from a link that cannot be used", () => {
    expect(resetConfirmFailure("rate-limited")).toBe(
      "Muitas tentativas. Aguarde um instante.",
    );
    expect(resetConfirmFailure("invalid")).toContain("inválido");
  });
});

describe("passwordsMismatch", () => {
  it("is empty only when both match", () => {
    expect(passwordsMismatch("abc", "abc")).toBe("");
    expect(passwordsMismatch("abc", "abd")).toBe("As senhas não são iguais.");
  });
});

describe("parseInviteForm", () => {
  it("accepts the bare code", () => {
    expect(parseInviteForm(` ${TOKEN} `, " a@b.co ")).toEqual({
      email: "a@b.co",
      token: TOKEN,
    });
  });

  it("takes the code out of a pasted link", () => {
    expect(
      parseInviteForm(
        `https://app.example.test/?x=1&token=${TOKEN}#k=abc`,
        "a@b.co",
      ),
    ).toEqual({ email: "a@b.co", token: TOKEN });
  });

  it("rejects a short code or a malformed e-mail", () => {
    expect(parseInviteForm("short", "a@b.co")).toBeNull();
    expect(parseInviteForm(TOKEN, "not-an-email")).toBeNull();
    expect(parseInviteForm(TOKEN, "a b@c.co")).toBeNull();
  });
});

describe("invitationRejection", () => {
  it("tells an unusable invitation from an outage", () => {
    expect(invitationRejection("invalid")).toContain("Já tenho uma conta");
    expect(invitationRejection("unavailable")).toBe(
      "O serviço está temporariamente indisponível.",
    );
  });
});

describe("accountMatchesInvitation", () => {
  it("lets a signed-out visitor through", () => {
    expect(accountMatchesInvitation(undefined, { email: "a@b.co" })).toBe(true);
  });

  it("compares e-mails case-insensitively", () => {
    expect(
      accountMatchesInvitation({ email: "Ana@B.co" }, { email: "ana@b.CO" }),
    ).toBe(true);
    expect(
      accountMatchesInvitation({ email: "x@b.co" }, { email: "ana@b.co" }),
    ).toBe(false);
  });
});

describe("fingerprintCells", () => {
  it("draws sixteen on/off cells, the same for the same text", () => {
    const cells = fingerprintCells("AB CD EF");
    expect(cells).toHaveLength(16);
    expect(cells.every((cell) => cell === 0 || cell === 1)).toBe(true);
    expect(fingerprintCells("AB CD EF")).toEqual(cells);
  });

  it("differs for different fingerprints", () => {
    expect(fingerprintCells("AB CD EF")).not.toEqual(
      fingerprintCells("12 34 56"),
    );
  });
});

describe("poseForLine", () => {
  it("thinks on the second line, waves on the third", () => {
    expect(LOGIN_LINES).toHaveLength(3);
    expect([0, 1, 2].map(poseForLine)).toEqual(["idle", "think", "wave"]);
  });
});
