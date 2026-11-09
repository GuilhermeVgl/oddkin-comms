// @vitest-environment happy-dom
import type { Attachment } from "@crewstead/api-client";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { expect, it, vi } from "vitest";
import { renderApp } from "../testing/AppHarness";
import { AttachmentMessageRow } from "./AttachmentRows";

const attachment: Attachment = {
  id: "a1",
  name: "brief.pdf",
  encrypted: false,
  contentType: "application/pdf",
  size: 1200,
  uploaderId: "acc-ana",
  uploaderEmail: "ana@crewstead.test",
  createdAt: "2026-10-26T10:00:00.000Z",
};

it("renders an uploaded file as an authored row in the message stream", async () => {
  const remove = vi.fn();
  await renderApp(
    <AttachmentMessageRow
      item={attachment}
      me={{ id: "acc-ana", email: "ana@crewstead.test" }}
      moderator={false}
      name="brief.pdf"
      onDownload={vi.fn()}
      onRemove={remove}
    />,
  );
  expect(
    screen.getByRole("article", { name: /ana enviou brief.pdf/i }),
  ).toBeTruthy();
  expect(screen.getByRole("button", { name: /baixar/i })).toBeTruthy();
  screen.getByRole("button", { name: /remover brief.pdf/i }).click();
  expect(remove).toHaveBeenCalledOnce();
});

it("does not offer removal for another person's file to a regular member", async () => {
  await renderApp(
    <AttachmentMessageRow
      item={{
        ...attachment,
        uploaderId: "acc-other",
        uploaderEmail: "bia@crewstead.test",
      }}
      me={{ id: "acc-ana", email: "ana@crewstead.test" }}
      moderator={false}
      name="brief.pdf"
      onDownload={vi.fn()}
      onRemove={vi.fn()}
    />,
  );
  expect(screen.queryByRole("button", { name: /remover/i })).toBeNull();
});

it("injects an uploaded image into the message stream", async () => {
  const download = vi.fn();
  await renderApp(
    <AttachmentMessageRow
      item={{ ...attachment, contentType: "image/png", name: "mood.png" }}
      me={{ id: "acc-ana", email: "ana@crewstead.test" }}
      moderator={false}
      name="mood.png"
      onDownload={download}
      onPreview={async () => "https://cdn.crewstead.test/mood.png"}
      onRemove={vi.fn()}
    />,
  );
  await waitFor(() =>
    expect(screen.getByRole("img", { name: "mood.png" })).toBeTruthy(),
  );
  screen.getByRole("button", { name: "Abrir imagem mood.png" }).click();
  expect(download).toHaveBeenCalledOnce();
});

it("does not reload the image when the conversation rerenders", async () => {
  const preview = vi.fn(async () => "https://cdn.crewstead.test/mood.png");
  function Conversation() {
    const [, rerender] = useState(0);
    return (
      <>
        <button onClick={() => rerender((value) => value + 1)}>
          Atualizar
        </button>
        <AttachmentMessageRow
          item={{ ...attachment, contentType: "image/png" }}
          me={{ id: "acc-ana", email: "ana@crewstead.test" }}
          moderator={false}
          name="mood.png"
          onDownload={vi.fn()}
          onPreview={() => preview()}
          onRemove={vi.fn()}
        />
      </>
    );
  }
  await renderApp(<Conversation />);
  await waitFor(() =>
    expect(screen.getByRole("img", { name: "mood.png" })).toBeTruthy(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Atualizar" }));
  expect(preview).toHaveBeenCalledTimes(1);
});
