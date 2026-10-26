import { ApiStatusError } from "@crewstead/api-client";
import { describe, expect, it } from "vitest";
import {
  attachmentDetail,
  describeDownloadError,
  describeUploadError,
  isUploadSizeAllowed,
  MAX_BYTES,
  mustEncryptBody,
  nameDomainKind,
  nameSource,
  sealFileName,
} from "./rules";

describe("isUploadSizeAllowed", () => {
  it("accepts 1 byte up to 500 MB and nothing else", () => {
    expect(isUploadSizeAllowed(0)).toBe(false);
    expect(isUploadSizeAllowed(1)).toBe(true);
    expect(isUploadSizeAllowed(MAX_BYTES)).toBe(true);
    expect(isUploadSizeAllowed(MAX_BYTES + 1)).toBe(false);
  });
});

describe("describeUploadError", () => {
  it("explains each status the upload can end with", () => {
    expect(describeUploadError(new ApiStatusError(503, "u"))).toContain(
      "não está configurado",
    );
    expect(describeUploadError(new ApiStatusError(507, "u"))).toContain("cota");
    expect(describeUploadError(new ApiStatusError(409, "u"))).toContain(
      "em andamento",
    );
    expect(describeUploadError(new ApiStatusError(403, "u"))).toContain(
      "perfil",
    );
  });

  it("asks to try again for anything else", () => {
    expect(describeUploadError(new ApiStatusError(500, "u"))).toBe(
      "Não foi possível enviar o arquivo. Tente novamente.",
    );
    expect(describeUploadError(new Error("x"))).toContain("Tente novamente");
  });
});

describe("describeDownloadError", () => {
  it("gives each failure its own advice", () => {
    expect(describeDownloadError("unsupported")).toContain("Chromium");
    expect(describeDownloadError("locked")).toContain("Desbloqueie");
    expect(describeDownloadError("invalid")).toContain("nada foi salvo");
    expect(describeDownloadError("network")).toBe(
      "Não foi possível baixar o arquivo agora.",
    );
  });
});

describe("nameDomainKind", () => {
  it("uses work for tasks and chat or dm for conversations", () => {
    expect(nameDomainKind("work_item", true)).toBe("work");
    expect(nameDomainKind("conversation", false)).toBe("chat");
    expect(nameDomainKind("conversation", true)).toBe("dm");
  });
});

describe("nameSource", () => {
  const sealed = {
    encrypted: true,
    name: "x.bin",
    nameEnc: "blob",
    contentAuthorId: "a",
    signerDeviceId: "d",
  };

  it("shows a plain name as it is", () => {
    expect(
      nameSource({ ...sealed, encrypted: false, name: "a.txt" }, false),
    ).toEqual({ text: "a.txt" });
  });

  it("asks to unlock when the name is sealed and the browser cannot open it", () => {
    expect(nameSource(sealed, false)).toEqual({
      text: "Nome cifrado (desbloqueie este navegador)",
    });
    const incomplete = {
      encrypted: true,
      name: "x.bin",
      contentAuthorId: "a",
      signerDeviceId: "d",
    };
    expect(nameSource(incomplete, true)).toEqual({
      text: "Nome cifrado (desbloqueie este navegador)",
    });
  });

  it("hands over what decrypting needs when everything is there", () => {
    expect(nameSource(sealed, true)).toEqual({
      decrypt: { authorId: "a", signerDeviceId: "d", envelope: "blob" },
    });
  });
});

describe("attachmentDetail", () => {
  const format = (size: number) => `${size} B`;
  const base = { size: 10, uploaderEmail: "a@b.co", encrypted: false };

  it("shows the original size when the body is encrypted", () => {
    expect(
      attachmentDetail(
        { ...base, contentSize: 7, bodyEncrypted: true },
        format,
      ),
    ).toBe("7 B · a@b.co · cifrado de ponta a ponta");
  });

  it("flags a sealed name with an open body", () => {
    expect(attachmentDetail({ ...base, encrypted: true }, format)).toBe(
      "10 B · a@b.co · nome cifrado, conteúdo sem cifra",
    );
  });

  it("says nothing extra for a plain file", () => {
    expect(attachmentDetail(base, format)).toBe("10 B · a@b.co");
  });
});

describe("sealFileName", () => {
  const resource = (id: string) => `attachment:${id}`;
  function sealer(options: { encrypted: boolean; writable: boolean }) {
    const calls: unknown[][] = [];
    return {
      calls,
      isEncrypted: () => options.encrypted,
      canWrite: () => options.writable,
      encrypt: (...args: unknown[]) => {
        calls.push(args);
        return { envelope: "env", signerDeviceId: "dev" };
      },
    };
  }

  it("leaves names plain without a crypto or while the domain has no key", () => {
    expect(
      sealFileName(null, "work", resource, "a", () => "id"),
    ).toBeUndefined();
    const plain = sealer({ encrypted: false, writable: true });
    expect(
      sealFileName(plain, "work", resource, "a", () => "id"),
    ).toBeUndefined();
    expect(plain.calls).toEqual([]);
  });

  it("encrypts the name under a fresh id bound to the attachment", () => {
    const ready = sealer({ encrypted: true, writable: true });
    expect(sealFileName(ready, "dm", resource, "a.pdf", () => "id-1")).toEqual({
      id: "id-1",
      nameEnc: "env",
      signerDeviceId: "dev",
    });
    expect(ready.calls).toEqual([["dm", "attachment:id-1", 1, "a.pdf"]]);
  });

  it("refuses to fall back to plaintext when this device cannot write", () => {
    const stuck = sealer({ encrypted: true, writable: false });
    expect(() => sealFileName(stuck, "dm", resource, "a", () => "id")).toThrow(
      "encryption unavailable",
    );
  });
});

describe("mustEncryptBody", () => {
  const crypto = (encrypted: boolean, writable: boolean) => ({
    fileKind: () => "files" as const,
    isEncrypted: () => encrypted,
    canWrite: () => writable,
  });

  it("is false without a crypto or before the files domain has a key", () => {
    expect(mustEncryptBody(null)).toBe(false);
    expect(mustEncryptBody(crypto(false, true))).toBe(false);
  });

  it("is true once the domain has a key and this device can write", () => {
    expect(mustEncryptBody(crypto(true, true))).toBe(true);
  });

  it("throws instead of sending plaintext when it cannot write", () => {
    expect(() => mustEncryptBody(crypto(true, false))).toThrow(
      "encryption unavailable",
    );
  });
});
