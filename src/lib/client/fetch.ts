/**
 * Client fetch wrapper. On a 401 it transparently attempts a single refresh via
 * /api/auth/refresh and retries the original request; if refresh fails it sends
 * the user to /login. Same-origin credentials are always included so the auth
 * cookies ride along. (Same-origin requests carry an Origin/Referer header, so
 * the server's CSRF check passes without extra headers.)
 */

export class ApiClientError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly details?: unknown;
  constructor(status: number, message: string, code?: string, details?: unknown) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

let refreshInFlight: Promise<boolean> | null = null;

async function refreshOnce(): Promise<boolean> {
  refreshInFlight ??= fetch("/api/auth/refresh", {
    method: "POST",
    credentials: "same-origin",
  })
    .then((r) => r.ok)
    .catch(() => false)
    .finally(() => {
      refreshInFlight = null;
    });
  return refreshInFlight;
}

export async function fetchWithAuth(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const opts: RequestInit = { ...init, credentials: "same-origin" };
  const res = await fetch(input, opts);
  if (res.status !== 401) return res;

  const refreshed = await refreshOnce();
  if (!refreshed) {
    if (typeof window !== "undefined") {
      const next = encodeURIComponent(window.location.pathname);
      // Intentional hard navigation: on lost auth we do a full reload to /login
      // so all client/query state is discarded rather than partially rehydrated.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = `/login?next=${next}`;
    }
    return res;
  }
  return fetch(input, opts);
}

/** Convenience JSON helper that throws `ApiClientError` on non-2xx. */
export async function apiJson<T>(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetchWithAuth(input, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  const body = (await res.json().catch(() => null)) as
    { error?: { code?: string; message?: string; details?: unknown } } | T | null;

  if (!res.ok) {
    const err = (body as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ApiClientError(
      res.status,
      err?.message ?? "Request failed",
      err?.code,
      (body as { error?: { details?: unknown } } | null)?.error?.details,
    );
  }
  return body as T;
}
