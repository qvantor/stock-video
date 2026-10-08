export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

export const notFound = (what: string): HttpError => new HttpError(404, `${what} not found`);
export const conflict = (message: string): HttpError => new HttpError(409, message);
export const badRequest = (message: string): HttpError => new HttpError(400, message);
