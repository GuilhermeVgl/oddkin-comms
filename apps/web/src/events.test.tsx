// @vitest-environment happy-dom
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventsProvider, useEvents, type DomainEvent } from "./events";

class FakeSocket {
  static all: FakeSocket[] = [];
  sent: string[] = [];
  closed = false;
  onmessage: ((message: MessageEvent<string>) => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(readonly url: string) {
    FakeSocket.all.push(this);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.closed = true;
  }
  receive(frame: unknown) {
    this.onmessage?.({
      data: typeof frame === "string" ? frame : JSON.stringify(frame),
    } as MessageEvent<string>);
  }
}

const event = (id: string, cursor: string, type = "work-item.changed") => ({
  type: "event",
  eventId: id,
  eventType: type,
  resourceId: "r1",
  cursor,
});

function Listener({ log }: { log: (event: DomainEvent | "resync") => void }) {
  useEvents(log);
  return null;
}

function mount() {
  const log = vi.fn();
  const view = render(
    <EventsProvider>
      <Listener log={log} />
    </EventsProvider>,
  );
  return { log, view };
}

beforeEach(() => {
  FakeSocket.all = [];
  vi.stubGlobal("WebSocket", FakeSocket);
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("EventsProvider", () => {
  it("opens one socket to the events endpoint", () => {
    mount();
    expect(FakeSocket.all).toHaveLength(1);
    expect(FakeSocket.all[0]?.url).toMatch(
      /^wss?:\/\/.*\/api\/v1\/events\/ws$/,
    );
  });

  it("resumes from the last cursor after the server says hello", () => {
    mount();
    const socket = FakeSocket.all[0]!;
    act(() => socket.receive({ type: "hello" }));
    expect(JSON.parse(socket.sent[0]!)).toEqual({ type: "resume", cursor: "" });
    act(() => socket.receive(event("e1", "c-7")));
    act(() => socket.receive({ type: "hello" }));
    expect(JSON.parse(socket.sent[1]!)).toEqual({
      type: "resume",
      cursor: "c-7",
    });
  });

  it("delivers each event once, even when it is replayed", () => {
    const { log } = mount();
    const socket = FakeSocket.all[0]!;
    act(() => socket.receive(event("e1", "1")));
    act(() => socket.receive(event("e1", "1")));
    act(() => socket.receive(event("e2", "2", "call.changed")));
    expect(log).toHaveBeenCalledTimes(2);
    expect(log.mock.calls[1]?.[0]).toMatchObject({ eventType: "call.changed" });
  });

  it("asks listeners to reload when the server needs a new snapshot", () => {
    const { log } = mount();
    const socket = FakeSocket.all[0]!;
    act(() => socket.receive(event("e1", "9")));
    act(() => socket.receive({ type: "sync_required" }));
    expect(log).toHaveBeenLastCalledWith("resync");
    act(() => socket.receive({ type: "hello" }));
    expect(JSON.parse(socket.sent.at(-1)!).cursor).toBe("");
  });

  it("ignores frames it does not understand", () => {
    const { log } = mount();
    const socket = FakeSocket.all[0]!;
    act(() => socket.receive("not json"));
    act(() => socket.receive({ type: "event", eventId: 5 }));
    act(() => socket.receive(null));
    expect(log).not.toHaveBeenCalled();
  });

  it("reconnects with a growing delay and stops when unmounted", () => {
    const { view } = mount();
    act(() => FakeSocket.all[0]!.onclose?.());
    expect(FakeSocket.all).toHaveLength(1);
    act(() => vi.advanceTimersByTime(1000));
    expect(FakeSocket.all).toHaveLength(2);
    view.unmount();
    expect(FakeSocket.all[1]?.closed).toBe(true);
    act(() => FakeSocket.all[1]?.onclose?.());
    act(() => vi.advanceTimersByTime(60_000));
    expect(FakeSocket.all).toHaveLength(2);
  });

  it("does nothing without a provider", () => {
    const log = vi.fn();
    render(<Listener log={log} />);
    expect(log).not.toHaveBeenCalled();
  });
});
