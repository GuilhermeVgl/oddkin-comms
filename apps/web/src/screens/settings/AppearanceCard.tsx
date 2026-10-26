import { Icon } from "../../design/icons";
import { getPrefs, setPrefs, usePrefs } from "../../design/prefs";
import { blip } from "../../design/sound";
import { Duo } from "../../design/Sprite";
import { useOrganization } from "../../organization";
import { Switch } from "./Switch";

export function AppearanceCard() {
  const prefs = usePrefs();
  const { branding } = useOrganization();
  return (
    <section className="card pad col gap16">
      <h2 className="h2">Aparência e movimento</h2>
      <div className="row">
        <div className="grow col">
          <b>Tema</b>
          <span className="xs muted">
            Papel é o padrão. Carvão para ambientes escuros.
          </span>
        </div>
        <div aria-label="Tema" className="seg" role="group">
          <button
            aria-pressed={prefs.theme === "papel"}
            onClick={() => setPrefs({ theme: "papel" })}
            type="button"
          >
            <Icon name="sun" size="sm" />
            Papel
          </button>
          <button
            aria-pressed={prefs.theme === "carvao"}
            onClick={() => setPrefs({ theme: "carvao" })}
            type="button"
          >
            <Icon name="moon" size="sm" />
            Carvão
          </button>
        </div>
      </div>
      <hr className="sep" />
      <div className="row">
        <div className="grow col">
          <b>Reduzir animações</b>
          <span className="xs muted">
            Troca movimento por fade leve. Personagens ficam parados e
            celebrações viram um aviso discreto.
          </span>
        </div>
        <Switch
          label="Reduzir animações"
          on={!prefs.motion}
          onToggle={() => setPrefs({ motion: !getPrefs().motion })}
        />
      </div>
      <hr className="sep" />
      <div className="row">
        <div className="grow col">
          <b>Sons discretos</b>
          <span className="xs muted">
            Bips curtos ao concluir. Desligado por padrão, só depois de um
            clique seu.
          </span>
        </div>
        <Switch
          label="Sons discretos"
          on={prefs.sound}
          onToggle={() => {
            setPrefs({ sound: !getPrefs().sound });
            if (getPrefs().sound) blip("ok");
          }}
        />
      </div>
      <hr className="sep" />
      <div className="row">
        <div className="grow col">
          <b>Prévia dos personagens</b>
          <span className="xs muted">
            {branding.showDuo
              ? "Capuz e Tela aparecem em estados vazios e marcos, sem pontos ou rankings."
              : "A equipe desativou Capuz e Tela. O administrador pode reativá-los na aba Equipe."}
          </span>
        </div>
        {branding.showDuo ? (
          <div className="st-flex">
            <Duo pose="wave" scale={3} />
          </div>
        ) : null}
      </div>
    </section>
  );
}
