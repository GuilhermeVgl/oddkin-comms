import type { CurrentAccount } from "@crewstead/api-client";
import { Achievements } from "../Achievements";
import { AppearanceCard } from "./AppearanceCard";
import { ProfilePhotoCard } from "./ProfilePhotoCard";

export function ProfileTab({ account }: { account: CurrentAccount }) {
  return (
    <div className="stack">
      <ProfilePhotoCard account={account} />
      <Achievements />
      <AppearanceCard />
      <section className="card pad col gap8">
        <h2 className="h2">Notificações</h2>
        <p className="muted">
          Apenas dentro do app: mensagens, menções, atribuições e chamadas. Sem
          e-mail ou push de atividade. E-mails existem só para convite e conta.
        </p>
      </section>
    </div>
  );
}
