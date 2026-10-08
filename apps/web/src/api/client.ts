import type { z } from 'zod';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const readError = async (res: Response): Promise<string> => {
  try {
    const body: unknown = await res.json();
    if (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string') {
      return body.error;
    }
  } catch {
    // fall through
  }
  return `${res.status} ${res.statusText}`;
};

/** Fetch JSON from the API and validate it against a contracts schema. */
export const apiRequest = async <S extends z.ZodType>(
  schema: S,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<z.infer<S>> => {
  const res = await fetch(`/api${path}`, {
    method: init.method ?? 'GET',
    headers: init.body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  if (!res.ok) throw new ApiError(res.status, await readError(res));
  if (res.status === 204) return schema.parse(undefined);
  return schema.parse(await res.json());
};
