import { Sprite } from "../../design/Sprite";

/** The call dropped or its encryption failed: try again or close. */
export function CallError({
  message,
  onRetry,
  onClose,
}: {
  message: string;
  onRetry: () => void;
  onClose: () => void;
}) {
  return (
    <div className="prejoin single">
      <div className="col gap16 call-error">
        <Sprite pose="oops" scale={6} who="tela" />
        <h1 className="call-heading">A conexão com a chamada foi perdida</h1>
        {message === "" ? null : <p className="call-dim">{message}</p>}
        <div className="row">
          <button className="btn primary lg" onClick={onRetry} type="button">
            Tentar entrar de novo
          </button>
          <button className="btn ghost" onClick={onClose} type="button">
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
