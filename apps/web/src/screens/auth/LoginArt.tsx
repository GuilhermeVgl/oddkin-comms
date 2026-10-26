import { useEffect, useState } from "react";
import { isReduced } from "../../design/prefs";
import { useDuoVisible } from "../../design/duoVisibility";
import { Duo, type DuoRef } from "../../design/Sprite";
import { ArtPanel, ArtStage } from "./AuthLayout";
import { LOGIN_LINES, poseForLine } from "./rules";
import { Typewriter } from "./Typewriter";

const LINE_MS = 3800;

/** The sign-in art: the mascots chat while the lines rotate. */
export function LoginArt({ duo }: { duo: React.RefObject<DuoRef | null> }) {
  const showDuo = useDuoVisible();
  const [line, setLine] = useState(0);
  useEffect(() => {
    if (!showDuo) return;
    const timer = window.setInterval(() => {
      setLine((value) => {
        const next = (value + 1) % LOGIN_LINES.length;
        duo.current?.set(poseForLine(next));
        return next;
      });
    }, LINE_MS);
    return () => window.clearInterval(timer);
  }, [duo, showDuo]);
  return (
    <ArtPanel
      ariaHidden={false}
      headline={
        <>
          Pequenos passos.
          <br />
          <em>Grandes entregas.</em>
        </>
      }
    >
      {showDuo ? (
        <div>
          <div className="pdlg">
            <span id="lt">
              <Typewriter text={LOGIN_LINES[line] ?? ""} />
            </span>
          </div>
          <ArtStage rise={!isReduced()}>
            <Duo gap={24} pose="idle" ref={duo} scale={6} />
          </ArtStage>
        </div>
      ) : null}
    </ArtPanel>
  );
}
