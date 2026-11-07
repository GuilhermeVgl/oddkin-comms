// @vitest-environment happy-dom
import type { Attachment } from "@crewstead/api-client";
import { screen } from "@testing-library/react";
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
