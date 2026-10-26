import { ApiStatusError, ensure, type Client, type Schemas } from "./internal";

export type OrganizationPerson = Schemas["OrganizationPerson"];

export async function listOrganizationPeople(
  client: Client,
): Promise<OrganizationPerson[]> {
  const { data, response } = await client.GET("/api/v1/organization/people");
  return ensure("listOrganizationPeople", response, data, 200);
}

export async function setPersonActive(
  client: Client,
  accountId: string,
  active: boolean,
): Promise<void> {
  const { response } = await client.PUT(
    "/api/v1/organization/people/{accountId}/active",
    {
      params: { path: { accountId } },
      body: { active },
    },
  );
  if (response.status !== 204)
    throw new ApiStatusError(response.status, "setPersonActive");
}
