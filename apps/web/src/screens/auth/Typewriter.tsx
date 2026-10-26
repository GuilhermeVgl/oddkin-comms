import { useEffect, useState } from "react";
import { isReduced } from "../../design/prefs";

/** Types a line out one letter at a time (instantly when motion is reduced). */
export function Typewriter({
  text,
  speed = 28,
}: {
  text: string;
  speed?: number;
}) {
  const [shown, setShown] = useState(isReduced() ? text : "");
  useEffect(() => {
    if (isReduced()) {
      setShown(text);
      return;
    }
    setShown("");
    let index = 0;
    const timer = window.setInterval(() => {
      index += 1;
      setShown(text.slice(0, index));
      if (index >= text.length) window.clearInterval(timer);
    }, speed);
    return () => window.clearInterval(timer);
  }, [text, speed]);
  return <>{shown}</>;
}
