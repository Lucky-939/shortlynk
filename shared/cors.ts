// ── CORS Helper ─────────────────────────────────────────────────────────────
//
// The frontend (Next.js) is a different origin from the workers. Browsers
// block cross-origin fetch() unless the server returns the correct
// Access-Control-* headers on both the preflight OPTIONS request and the
// actual response.

export const corsHeaders = {
  // In a production app handling sensitive user data, you should echo back
  // a specific allowed origin (e.g., https://your-frontend-domain.com)
  // instead of using a wildcard "*".
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

/** 204 response for browser OPTIONS preflight requests. */
export function handleOptions(): Response {
  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  });
}

/** Attaches CORS headers to an existing Response. */
export function withCors(response: Response): Response {
  const next = new Response(response.body, response);
  Object.entries(corsHeaders).forEach(([k, v]) => next.headers.set(k, v));
  return next;
}
