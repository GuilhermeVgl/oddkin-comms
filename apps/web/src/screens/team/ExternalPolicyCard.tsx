import { Icon } from "../../design/icons";
import { nameOf } from "../../design/people";
import { Banner } from "../../design/primitives";
import type { ProjectState } from "../../workspace";
import { DEPENDS, GROUPS, LABEL, type Permission } from "./teamRules";
import { useExternalPolicy } from "./useExternalPolicy";

function PermissionMatrix({
  normalized,
  onToggle,
}: {
  normalized: ReadonlySet<Permission>;
  onToggle: (permission: Permission) => void;
}) {
  return (
    <div className="matrix">
      {GROUPS.map((group) => (
        <div key={group.title}>
          <div className="mgrp">
            <Icon name={group.icon} size="sm" />
            {group.title}
          </div>
          {group.items.map(([key, label]) => {
            const need = DEPENDS[key];
            const blocked = need !== undefined && !normalized.has(need);
            return (
              <div className="mrow" key={key}>
                <div className="grow col">
                  <span className="tm-label">{label}</span>
                  <span className="k">{key}</span>
                  {blocked && need !== undefined ? (
                    <span className="why" id={`why-${key}`}>
                      Requer: {LABEL.get(need)?.toLowerCase()}
                    </span>
                  ) : null}
                </div>
                <button
                  aria-checked={normalized.has(key)}
                  aria-describedby={blocked ? `why-${key}` : undefined}
                  aria-label={label}
                  className="sw"
                  disabled={blocked}
                  onClick={() => onToggle(key)}
                  role="switch"
                  type="button"
                />
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

export function ExternalPolicyCard({ current }: { current: ProjectState }) {
  const { policy, normalized, dirty, rotation, toggle, discard, save } =
    useExternalPolicy(current);
  const externals = current.members.filter(
    (member) => member.membershipKind === "external",
  );

  return (
    <section className="card pad">
      <div className="row">
        <h2 className="h2 grow">Perfil dos externos</h2>
        {policy === null ? null : (
          <span className="tag mute num mono">política v{policy.version}</span>
        )}
      </div>
      {externals.length > 0 ? (
        <div className="tm-note">
          <Banner kind="warn">
            Vale <b>imediatamente</b> para os {externals.length}{" "}
            {externals.length === 1 ? "externo" : "externos"} deste projeto (
            {externals.map((member) => nameOf(member.email)).join(", ")}). Não
            existe exceção por pessoa.
          </Banner>
        </div>
      ) : (
        <div className="tm-note">
          <Banner>
            Este projeto ainda não tem externos. A política vale para quem for
            convidado depois.
          </Banner>
        </div>
      )}
      {policy === null ? (
        <p className="xs muted">
          Somente quem gerencia o projeto altera esta política.
        </p>
      ) : (
        <>
          <PermissionMatrix normalized={normalized} onToggle={toggle} />
          <div className="row tm-mt16">
            <span className="xs muted grow">
              Mudanças que reduzem acesso rotacionam as chaves do domínio
              afetado.
            </span>
            <button
              className="btn"
              disabled={!dirty}
              onClick={discard}
              type="button"
            >
              Descartar
            </button>
            <button
              className="btn primary"
              disabled={!dirty}
              onClick={() => void save()}
              type="button"
            >
              Salvar política
            </button>
          </div>
          {rotation === "pending" ? (
            <div className="tm-mt12">
              <Banner icon="rot" kind="warn" role="status">
                <b>rotation_required.</b> Acesso bloqueado no servidor. Novas
                escritas cifradas neste domínio ficam suspensas até um cliente
                elegível publicar a nova geração de chaves.
              </Banner>
            </div>
          ) : null}
          {rotation === "done" ? (
            <div className="tm-mt12">
              <Banner icon="shieldOk" kind="ok" role="status">
                <b>Rotação concluída.</b> Uma nova geração de chaves foi
                publicada para o conjunto atual de destinatários.
              </Banner>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
