import { Banner } from "../../design/primitives";

/** Tells a DM's reader what is missing: unlock this browser, or turn encryption on. */
export function DmBanner({
  dm,
  enable,
  status,
}: {
  dm: { keyed: boolean; unlocked: boolean };
  enable: () => void;
  status: string;
}) {
  if (dm.keyed && dm.unlocked) return null;
  if (dm.keyed)
    return (
      <Banner icon="lock" kind="warn" style={{ margin: "10px 20px 0" }}>
        Esta conversa é cifrada. Libere a criptografia deste navegador para ler
        e escrever.
      </Banner>
    );
  if (dm.unlocked)
    return (
      <Banner kind="warn" style={{ margin: "10px 20px 0" }}>
        <b>
          As mensagens desta conversa ainda ficam em texto claro no servidor.
        </b>{" "}
        {status}{" "}
        <button className="btn sm" onClick={enable} type="button">
          Ativar criptografia nesta conversa
        </button>
      </Banner>
    );
  return null;
}
