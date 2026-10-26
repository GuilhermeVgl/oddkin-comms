import { ApiStatusError, ensure, type Client, type Schemas } from "./internal";

export type BoardColumn = Schemas["BoardColumn"];

export async function listBoardColumns(
  client: Client,
  projectId: string,
): Promise<BoardColumn[]> {
  const { data, response } = await client.GET(
    "/api/v1/projects/{projectId}/columns",
    { params: { path: { projectId } } },
  );
  return ensure("listBoardColumns", response, data, 200);
}

export async function createBoardColumn(
  client: Client,
  projectId: string,
  body: Schemas["CreateBoardColumnRequest"],
): Promise<BoardColumn> {
  const { data, response } = await client.POST(
    "/api/v1/projects/{projectId}/columns",
    { params: { path: { projectId } }, body },
  );
  return ensure("createBoardColumn", response, data, 201);
}

export async function updateBoardColumn(
  client: Client,
  projectId: string,
  columnId: string,
  body: Schemas["UpdateBoardColumnRequest"],
): Promise<BoardColumn> {
  const { data, response } = await client.PATCH(
    "/api/v1/projects/{projectId}/columns/{columnId}",
    { params: { path: { projectId, columnId } }, body },
  );
  return ensure("updateBoardColumn", response, data, 200);
}

/** Deletes a column; its activities move to `moveTo` in the same transaction. */
export async function deleteBoardColumn(
  client: Client,
  projectId: string,
  columnId: string,
  moveTo?: string,
): Promise<void> {
  const { response } = await client.DELETE(
    "/api/v1/projects/{projectId}/columns/{columnId}",
    {
      params: {
        path: { projectId, columnId },
        query: moveTo === undefined ? {} : { moveTo },
      },
    },
  );
  if (response.status !== 204) {
    throw new ApiStatusError(response.status, "deleteBoardColumn");
  }
}

export async function reorderBoardColumns(
  client: Client,
  projectId: string,
  columnIds: string[],
): Promise<BoardColumn[]> {
  const { data, response } = await client.PUT(
    "/api/v1/projects/{projectId}/columns/order",
    {
      params: { path: { projectId } },
      body: { columnIds },
    },
  );
  return ensure("reorderBoardColumns", response, data, 200);
}
