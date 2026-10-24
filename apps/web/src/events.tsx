import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from "react";

export type DomainEvent = {
  eventId: string;
  eventType: string;
  resourceId: string;
  contextId?: string;
  cursor: string;
};

type Listener = (event: DomainEvent | "resync") => void;

const EventsContext = createContext<{
  subscribe: (listener: Listener) => () => void;
} | null>(null);

const MIN_DELAY_MS = 500;
const MAX_DELAY_MS = 30_000;
const SEEN_LIMIT = 200;

function isDomainEvent(
  value: unknown,
): value is DomainEvent & { type: string } {
  if (typeof value !== "object" || value === null) return false;
  const frame = value as Record<string, unknown>;
  return (
    frame["type"] === "event" &&
    typeof frame["eventId"] === "string" &&
    typeof frame["eventType"] === "string" &&
    typeof frame["resourceId"] === "string" &&
    typeof frame["cursor"] === "string"
  );
}

/**
 * Keeps one authenticated WebSocket open, resumes from the last applied
 * cursor after reconnects, de-duplicates by eventId and tells listeners to
 * refetch when the server asks for a new snapshot.
 */
export function EventsProvider({ children }: { children: React.ReactNode }) {
  const listeners = useRef(new Set<Listener>());

  useEffect(() => {
    let stopped = false;
    let socket: WebSocket | null = null;
    let timer: number | undefined;
    let attempt = 0;
    let cursor = "";
    const seen: string[] = [];

    const emit = (event: DomainEvent | "resync") => {
      for (const listener of listeners.current) listener(event);
    };

    const connect = () => {
      if (stopped) return;
      const scheme = window.location.protocol === "https:" ? "wss" : "ws";
      socket = new WebSocket(
        `${scheme}://${window.location.host}/api/v1/events/ws`,
      );
      socket.onmessage = (message: MessageEvent<string>) => {
        let frame: unknown;
        try {
          frame = JSON.parse(message.data) as unknown;
        } catch {
          return;
        }
        const type =
          typeof frame === "object" && frame !== null
            ? (frame as Record<string, unknown>)["type"]
            : undefined;
        if (type === "hello") {
          attempt = 0;
          socket?.send(JSON.stringify({ type: "resume", cursor }));
        } else if (type === "sync_required") {
          cursor = "";
          emit("resync");
        } else if (isDomainEvent(frame)) {
          cursor = frame.cursor;
          if (seen.includes(frame.eventId)) return;
          seen.push(frame.eventId);
          if (seen.length > SEEN_LIMIT) seen.shift();
          emit(frame);
        }
      };
      socket.onclose = () => {
        if (stopped) return;
        const delay = Math.min(MAX_DELAY_MS, MIN_DELAY_MS * 2 ** attempt);
        attempt += 1;
        timer = window.setTimeout(connect, delay * (0.5 + Math.random() / 2));
      };
    };

    connect();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      socket?.close();
    };
  }, []);

  const value = useMemo(
    () => ({
      subscribe: (listener: Listener) => {
        listeners.current.add(listener);
        return () => {
          listeners.current.delete(listener);
        };
      },
    }),
    [],
  );
  return (
    <EventsContext.Provider value={value}>{children}</EventsContext.Provider>
  );
}

/** Calls `handler` for every event (or "resync") while the component is mounted. */
export function useEvents(handler: Listener) {
  const context = useContext(EventsContext);
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => {
    if (context === null) return undefined;
    return context.subscribe((event) => latest.current(event));
  }, [context]);
}
