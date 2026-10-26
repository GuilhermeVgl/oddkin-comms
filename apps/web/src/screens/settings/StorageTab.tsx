import { getStorageUsage } from "@crewstead/api-client";
import { useEffect, useState } from "react";
import { bytes } from "../../design/format";
import { Pbar } from "../../design/primitives";
import { useWorkspace } from "../../workspace";
import { STORAGE_BLOCKS, storageBlocks } from "./settingsRules";

const RULES: [string, string][] = [
  ["Tamanho máximo por arquivo", "500.000.000 bytes"],
  ["Transferências ativas por usuário", "1 (2 partes em paralelo)"],
  ["Sessão de upload abandonada", "expira em 24 h"],
  ["Objetos desligados", "eliminação física 30 dias após apagar"],
  ["URL de download", "60 s, objeto opaco, bucket privado"],
];

export function StorageTab({ isAdmin }: { isAdmin: boolean }) {
  const { client } = useWorkspace();
  const [usage, setUsage] = useState<{
    quota: number;
    reserved: number;
  } | null>(null);
  useEffect(() => {
    if (!isAdmin) return;
    getStorageUsage(client)
      .then((value) =>
        setUsage({
          quota: Number(value.quotaBytes),
          reserved: Number(value.reservedBytes),
        }),
      )
      .catch(() => setUsage(null));
  }, [client, isAdmin]);
  return (
    <div className="stack">
      {isAdmin ? (
        <section className="card pad col gap12">
          <div className="row">
            <h2 className="h2 grow">Cota da organização</h2>
            <span className="mono sm">
              {usage === null
                ? "—"
                : `${bytes(usage.reserved)} de ${bytes(usage.quota)}`}
            </span>
          </div>
          <Pbar
            label="Espaço reservado"
            on={storageBlocks(usage)}
            total={STORAGE_BLOCKS}
          />
          <p className="xs muted">
            Inclui os uploads em andamento, reservados para evitar ultrapassar a
            cota em corridas concorrentes. A cota é configurável
            (STORAGE_QUOTA_BYTES) e não representa preço do R2.
          </p>
        </section>
      ) : null}
      <section className="card pad">
        <h2 className="h2 st-h2-tight">Regras</h2>
        <table className="tbl">
          <tbody>
            {RULES.map(([label, value]) => (
              <tr key={label}>
                <td>{label}</td>
                <td className="mono">{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
