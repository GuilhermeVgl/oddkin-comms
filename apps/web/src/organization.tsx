import {
  createApiClient,
  getOrganizationBranding,
  updateOrganizationBranding,
  type CurrentAccount,
  type OrganizationBranding,
  type UpdateOrganizationBrandingRequest,
} from "@crewstead/api-client";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { setDuoVisible } from "./design/duoVisibility";
import { APP_NAME } from "./brand";

type OrganizationValue = {
  branding: OrganizationBranding;
  save: (body: UpdateOrganizationBrandingRequest) => Promise<void>;
  logoVersion: number;
};

const Context = createContext<OrganizationValue | null>(null);

export function useOrganization(): OrganizationValue {
  const value = useContext(Context);
  if (value === null) throw new Error("OrganizationProvider is missing");
  return value;
}

export function OrganizationGate({
  account,
  children,
}: {
  account: CurrentAccount;
  children: React.ReactNode;
}) {
  const client = useMemo(() => createApiClient(""), []);
  const [branding, setBranding] = useState<OrganizationBranding | null>(null);
  const [error, setError] = useState(false);
  const [logoVersion, setLogoVersion] = useState(0);

  useEffect(() => {
    let active = true;
    getOrganizationBranding(client)
      .then((value) => {
        if (active) {
          setBranding(value);
          setDuoVisible(value.showDuo);
        }
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [client]);

  async function save(body: UpdateOrganizationBrandingRequest) {
    const value = await updateOrganizationBranding(client, body);
    setBranding(value);
    setDuoVisible(value.showDuo);
    setLogoVersion((version) => version + 1);
  }

  if (error) {
    return (
      <main className="setup-screen">
        <p role="alert">
          Não foi possível carregar a equipe. Recarregue a página.
        </p>
      </main>
    );
  }
  if (branding === null)
    return <main className="setup-screen">Carregando equipe…</main>;

  return (
    <Context.Provider value={{ branding, save, logoVersion }}>
      {account.isAdmin && branding.name === "" ? (
        <OrganizationSetup />
      ) : (
        children
      )}
    </Context.Provider>
  );
}

export function TeamLogo({ size = 36 }: { size?: number }) {
  const { branding, logoVersion } = useOrganization();
  return branding.hasLogo ? (
    <img
      alt=""
      className="team-logo"
      height={size}
      src={`/api/v1/organization/logo?v=${logoVersion}`}
      width={size}
    />
  ) : (
    <span
      aria-hidden="true"
      className="tile"
      style={{ height: size, width: size }}
    >
      {(branding.name || APP_NAME).slice(0, 1).toLocaleUpperCase()}
    </span>
  );
}

export async function imageToBase64(file: File): Promise<{
  logoBase64: string;
  logoMime: "image/png" | "image/jpeg" | "image/webp";
}> {
  if (
    file.size === 0 ||
    file.size > 1024 * 1024 ||
    !["image/png", "image/jpeg", "image/webp"].includes(file.type)
  ) {
    throw new Error("Use PNG, JPEG ou WebP de até 1 MB.");
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return {
    logoBase64: btoa(binary),
    logoMime: file.type as "image/png" | "image/jpeg" | "image/webp",
  };
}

export function OrganizationForm({ initial = false }: { initial?: boolean }) {
  const { branding, save } = useOrganization();
  const [name, setName] = useState(branding.name);
  const [showDuo, setShowDuo] = useState(branding.showDuo);
  const [logo, setLogo] = useState<File | null>(null);
  const logoInput = useRef<HTMLInputElement>(null);
  const [removeLogo, setRemoveLogo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  return (
    <form
      className="col gap16"
      onSubmit={(event) => {
        event.preventDefault();
        setBusy(true);
        setError("");
        void (async () => {
          try {
            const image = logo === null ? {} : await imageToBase64(logo);
            await save({
              name: name.trim(),
              showDuo,
              ...image,
              ...(removeLogo ? { removeLogo: true } : {}),
            });
            setLogo(null);
            setRemoveLogo(false);
          } catch (cause) {
            setError(
              cause instanceof Error && cause.message.startsWith("Use PNG")
                ? cause.message
                : "Não foi possível salvar a equipe. Tente novamente.",
            );
          } finally {
            setBusy(false);
          }
        })();
      }}
    >
      <div className="field">
        <label htmlFor="team-name">Nome da equipe</label>
        <input
          autoComplete="organization"
          className="inp"
          id="team-name"
          maxLength={80}
          onChange={(event) => setName(event.target.value)}
          required
          value={name}
        />
      </div>
      <div className="field">
        <label htmlFor="team-logo">Logo da equipe (opcional)</label>
        <input
          accept="image/png,image/jpeg,image/webp"
          id="team-logo"
          ref={logoInput}
          onChange={(event) => {
            setLogo(event.target.files?.[0] ?? null);
            setRemoveLogo(false);
          }}
          type="file"
        />
        <span className="xs muted">PNG, JPEG ou WebP, até 1 MB.</span>
        {branding.hasLogo && !initial ? (
          <label className="row">
            <input
              checked={removeLogo}
              onChange={(event) => {
                setRemoveLogo(event.target.checked);
                if (event.target.checked) {
                  setLogo(null);
                  if (logoInput.current !== null) logoInput.current.value = "";
                }
              }}
              type="checkbox"
            />
            Remover logo atual
          </label>
        ) : null}
      </div>
      <label className="row">
        <input
          checked={showDuo}
          onChange={(event) => setShowDuo(event.target.checked)}
          type="checkbox"
        />
        Mostrar Capuz e Tela e suas animações
      </label>
      {error !== "" ? <p role="alert">{error}</p> : null}
      <button
        className="btn primary"
        disabled={busy || name.trim() === ""}
        type="submit"
      >
        {busy ? "Salvando…" : initial ? "Criar equipe" : "Salvar equipe"}
      </button>
    </form>
  );
}

function OrganizationSetup() {
  return (
    <main className="setup-screen">
      <section className="card pad setup-card">
        <span className="tag lime">{APP_NAME}</span>
        <h1>Vamos configurar sua equipe</h1>
        <p className="muted">
          Escolha o nome, adicione um logo e decida se a dupla aparece no espaço
          de trabalho.
        </p>
        <OrganizationForm initial />
      </section>
    </main>
  );
}
