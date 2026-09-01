interface Page<T> {
  items: T[];
  nextToken: string | null;
}

interface CursorState {
  token: string | null;
  offset: number;
}

function encodeCursor(state: CursorState): string {
  return Buffer.from(JSON.stringify(state), "utf8").toString("base64url");
}

function decodeCursor(value: string | null): CursorState {
  if (!value) return { token: null, offset: 0 };
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<CursorState>;
    if ((parsed.token === null || typeof parsed.token === "string") && Number.isInteger(parsed.offset) && parsed.offset! >= 0) {
      return { token: parsed.token, offset: parsed.offset! };
    }
  } catch { /* Older cursors are raw R2 continuation tokens. */ }
  return { token: value, offset: 0 };
}

export async function collectFilteredPage<T>({
  cursor,
  limit,
  list,
  include,
}: {
  cursor: string | null;
  limit: number;
  list: (token: string | null) => Promise<Page<T>>;
  include: (item: T) => boolean | Promise<boolean>;
}): Promise<{ items: T[]; nextCursor: string | null }> {
  const collected: T[] = [];
  let { token, offset } = decodeCursor(cursor);

  while (collected.length < limit) {
    const pageToken = token;
    const page = await list(pageToken);
    let index = Math.min(offset, page.items.length);

    for (; index < page.items.length; index += 1) {
      if (await include(page.items[index])) collected.push(page.items[index]);
      if (collected.length === limit) {
        const consumedPage = index + 1 >= page.items.length;
        const next = consumedPage ? page.nextToken === null ? null : { token: page.nextToken, offset: 0 } : { token: pageToken, offset: index + 1 };
        return { items: collected, nextCursor: next ? encodeCursor(next) : null };
      }
    }

    if (!page.nextToken) return { items: collected, nextCursor: null };
    if (page.nextToken === pageToken) throw new Error("Asset pagination did not advance");
    token = page.nextToken;
    offset = 0;
  }

  return { items: collected, nextCursor: null };
}
