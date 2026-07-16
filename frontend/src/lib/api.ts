/**
 * api.ts — all backend API calls for ShortLynk.
 *
 * Base URLs come from environment variables — never hardcoded.
 * Set these in .env.local for development:
 *   NEXT_PUBLIC_AUTH_API_URL=http://localhost:8790
 *   NEXT_PUBLIC_SHORTEN_API_URL=http://localhost:8787
 *   NEXT_PUBLIC_ANALYTICS_API_URL=http://localhost:8791
 *
 * Every function that requires auth accepts a token and throws ApiError on
 * 401 — callers catch this to clear the stored token and redirect to /login.
 */

// ── Base URLs ─────────────────────────────────────────────────────────────────

export const AUTH_API = process.env.NEXT_PUBLIC_AUTH_API_URL ?? "";
export const SHORTEN_API = process.env.NEXT_PUBLIC_SHORTEN_API_URL ?? "";
export const ANALYTICS_API = process.env.NEXT_PUBLIC_ANALYTICS_API_URL ?? "";

// ── Error type ────────────────────────────────────────────────────────────────

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Throws ApiError on non-2xx. Callers handle the specific status codes. */
async function request<T>(
  url: string,
  options: RequestInit = {}
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, options);
  } catch {
    throw new ApiError(0, "Network error — is the API reachable?");
  }

  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = await res.json() as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // ignore JSON parse failure, use status code message
    }
    throw new ApiError(res.status, message);
  }

  return res.json() as Promise<T>;
}

function authHeaders(token: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
}

// ── Auth ──────────────────────────────────────────────────────────────────────

export interface SignupPayload { email: string; password: string }
export interface SignupResult  { userId: string; email: string }

export async function signup(payload: SignupPayload): Promise<SignupResult> {
  return request<SignupResult>(`${AUTH_API}/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export interface LoginPayload { email: string; password: string }
export interface LoginResult  { token: string; userId: string; email: string }

export async function login(payload: LoginPayload): Promise<LoginResult> {
  return request<LoginResult>(`${AUTH_API}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

// ── Shorten ───────────────────────────────────────────────────────────────────

export interface ShortenPayload { longUrl: string; customAlias?: string }
export interface ShortenResult  { shortUrl: string; shortCode: string; longUrl: string; createdAt: string }

export async function shortenUrl(payload: ShortenPayload, token: string): Promise<ShortenResult> {
  return request<ShortenResult>(`${SHORTEN_API}/shorten`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(payload),
  });
}

// ── Analytics ─────────────────────────────────────────────────────────────────

export interface LinkSummary {
  shortCode: string;
  longUrl: string;
  createdAt: string;
  totalClicks: number;
}

export async function getLinks(token: string): Promise<LinkSummary[]> {
  return request<LinkSummary[]>(`${ANALYTICS_API}/links`, {
    headers: authHeaders(token),
  });
}

export interface HourlyBucket { hour: string; count: number }
export interface ReferrerEntry { referrer: string; count: number }
export interface LinkStats {
  totalClicks: number;
  hourly: HourlyBucket[];
  topReferrers: ReferrerEntry[];
}

export async function getLinkStats(shortCode: string, token: string): Promise<LinkStats> {
  return request<LinkStats>(`${ANALYTICS_API}/links/${shortCode}/stats`, {
    headers: authHeaders(token),
  });
}
