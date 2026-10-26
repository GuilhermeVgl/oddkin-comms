import {
  OrganizationForm,
  TeamLogo,
  useOrganization,
} from "../../organization";

export function TeamBrandingTab() {
  const { branding } = useOrganization();
  return (
    <section className="card pad col gap16">
      <div className="row gap16">
        <TeamLogo size={52} />
        <div className="col">
          <h2 className="h2">Identidade da equipe</h2>
          <span className="muted">{branding.name}</span>
        </div>
      </div>
      <OrganizationForm />
    </section>
  );
}
