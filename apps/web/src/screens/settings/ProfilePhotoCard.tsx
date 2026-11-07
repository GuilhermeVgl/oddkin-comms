import {
  deleteAvatar,
  putAvatar,
  updateProfile,
  type CurrentAccount,
} from "@crewstead/api-client";
import { useRef, useState } from "react";
import {
  getAvatarVersions,
  setAvatarVersions,
  useAvatarVersion,
} from "../../design/avatars";
import { Icon } from "../../design/icons";
import { displayNameOf } from "../../design/people";
import { Avatar } from "../../design/primitives";
import { toast, toastError } from "../../design/toast";
import { roleOf } from "../../shell/Sidebar";
import { useWorkspace } from "../../workspace";
import { PhotoEditor } from "../PhotoEditor";

export function ProfilePhotoCard({ account }: { account: CurrentAccount }) {
  const { client } = useWorkspace();
  const version = useAvatarVersion(account.id);
  const [busyPhoto, setBusyPhoto] = useState(false);
  const [editing, setEditing] = useState<File | null>(null);
  const initialName = displayNameOf(account.email, account.displayName);
  const [name, setName] = useState(initialName);
  const [savingName, setSavingName] = useState(false);
  const picker = useRef<HTMLInputElement>(null);

  // The photo list also refreshes on its own when the change event arrives;
  // updating it here means this person does not wait for that.
  const others = () =>
    Object.entries(getAvatarVersions())
      .filter(([id]) => id !== account.id)
      .map(([id, value]) => ({ accountId: id, version: value }));

  // Throws when the upload fails, so the editor stays open and says so.
  async function sendPhoto(photo: Blob) {
    await putAvatar(photo);
    setAvatarVersions([
      ...others(),
      { accountId: account.id, version: (version ?? 0) + 1 },
    ]);
    setEditing(null);
    toast("Foto atualizada.", { icon: "check" });
  }

  async function removePhoto() {
    setBusyPhoto(true);
    try {
      await deleteAvatar(client);
      setAvatarVersions(others());
      toast("Foto removida.", { icon: "check" });
    } catch {
      toastError("Não foi possível remover a foto.");
    } finally {
      setBusyPhoto(false);
    }
  }

  return (
    <section className="card pad col gap16">
      <div className="row gap16">
        <Avatar email={account.email} id={account.id} name={name} size="xl" />
        <div className="col gap4">
          <h2 className="h2">{displayNameOf(account.email, name)}</h2>
          <span className="muted">{account.email}</span>
          <span className="tag mute st-fit">{roleOf(account)}</span>
          <div className="row gap8 st-mt6">
            <button
              className={`btn sm${busyPhoto ? " loading" : ""}`}
              onClick={() => picker.current?.click()}
              type="button"
            >
              <Icon name="clip" size="sm" />
              {version === undefined ? "Enviar foto" : "Trocar foto"}
            </button>
            {version === undefined ? null : (
              <button
                className="btn sm ghost"
                disabled={busyPhoto}
                onClick={() => void removePhoto()}
                type="button"
              >
                Remover
              </button>
            )}
            <input
              accept="image/png,image/jpeg,image/webp,image/gif,image/heic"
              aria-label="Escolher foto de perfil"
              hidden
              onChange={(event) => {
                setEditing(event.target.files?.[0] ?? null);
                event.target.value = "";
              }}
              ref={picker}
              type="file"
            />
          </div>
        </div>
      </div>
      <form
        className="profile-name"
        onSubmit={(event) => {
          event.preventDefault();
          const next = name.trim();
          if (next === "" || next.length > 80) return;
          setSavingName(true);
          void updateProfile(client, next)
            .then(() => {
              setName(next);
              toast("Nome de perfil atualizado.", { icon: "check" });
              window.setTimeout(() => window.location.reload(), 350);
            })
            .catch(() => toastError("Não foi possível atualizar o nome."))
            .finally(() => setSavingName(false));
        }}
      >
        <label htmlFor="profile-display-name">Nome exibido</label>
        <div className="row gap8">
          <input
            className="inp grow"
            id="profile-display-name"
            maxLength={80}
            onChange={(event) => setName(event.target.value)}
            required
            value={name}
          />
          <button
            className={`btn${savingName ? " loading" : ""}`}
            disabled={name.trim() === "" || name.trim() === initialName}
            type="submit"
          >
            Salvar nome
          </button>
        </div>
        <span className="xs muted">
          Este é o nome que sua equipe verá nas conversas e atividades.
        </span>
      </form>
      {editing === null ? null : (
        <PhotoEditor
          file={editing}
          onCancel={() => setEditing(null)}
          onSave={sendPhoto}
        />
      )}
      <p className="xs muted">
        E-mail e nome de perfil ficam acessíveis ao backend. O conteúdo de
        trabalho, não.
      </p>
    </section>
  );
}
