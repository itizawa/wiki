/** HTTPステータス付きのアプリケーションエラー。ルートの onError でJSONに変換する。 */
export class HttpError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 422,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const notFound = (what: string) => new HttpError(404, "not_found", `${what} not found`);
