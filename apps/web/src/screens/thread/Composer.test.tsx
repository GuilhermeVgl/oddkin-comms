// @vitest-environment happy-dom
import { fireEvent, screen } from "@testing-library/react";
import { createRef } from "react";
import { expect, it, vi } from "vitest";
import { renderApp } from "../../testing/AppHarness";
import { Composer } from "./Composer";

it("uploads a file dropped onto the composer", async () => {
  const onFiles = vi.fn();
  await renderApp(
    <Composer
      areaRef={createRef()}
      draft=""
      meEmail="ana@crewstead.test"
      mentionPool={[]}
      onAttach={vi.fn()}
      onCancelReply={vi.fn()}
      onDraft={vi.fn()}
      onEmoji={vi.fn()}
      onFiles={onFiles}
      onSend={vi.fn()}
      replyTo={null}
      title="Geral"
    />,
  );
  const file = new File(["image"], "mood.png", { type: "image/png" });
  fireEvent.drop(screen.getByRole("form"), {
    dataTransfer: { files: [file] },
  });
  expect(onFiles).toHaveBeenCalledWith(expect.objectContaining({ 0: file }));
});
