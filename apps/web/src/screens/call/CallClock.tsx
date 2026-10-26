import { useEffect, useState } from "react";
import { elapsedSeconds, formatClock } from "./callView";

/** Time since the call was joined, ticking every second. */
export function CallClock({ since }: { since: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <span className="mono xs call-dim">
      {formatClock(elapsedSeconds(now, since))}
    </span>
  );
}
