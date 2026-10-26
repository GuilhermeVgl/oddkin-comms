import { Banner } from "../../design/primitives";

export function SkeletonBoard() {
  return (
    <>
      <div className="wk-note">
        <Banner kind="ok" role="status">
          <b>Descriptografando neste dispositivo…</b> Títulos e descrições só
          existem em claro aqui.
        </Banner>
      </div>
      <div className="board">
        {[0, 1, 2, 3].map((column) => (
          <div className="colm" key={column}>
            <div className="colh">
              <span className="skel wk-sk-dot" />
              <span className="skel wk-sk-name" />
            </div>
            {Array.from({ length: 3 - (column % 2) }, (_, index) => (
              <div className="wi wk-sk-card" key={index}>
                <span className="skel wk-sk-tag" />
                <span className="skel wk-sk-title" />
                <span className="skel wk-sk-body" />
                <span className="skel wk-sk-foot" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}
