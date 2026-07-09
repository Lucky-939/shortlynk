/**
 * redirect-worker
 *
 * Handles GET /{shortCode} — resolves a short URL and redirects.
 * Will publish a click event to a Cloudflare Queue.
 * Business logic will be added in a future step.
 */

interface Env {
  URLS_KV: KVNamespace;
  CLICK_QUEUE: Queue<unknown>;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const shortCode = url.pathname.replace(/^\//, "");

    if (request.method === "GET" && shortCode) {
      // TODO: look up shortCode in KV, publish click event to Queue, then redirect
      return new Response(
        `Hello from redirect-worker! shortCode="${shortCode}" — redirect not yet implemented`,
        { status: 200 }
      );
    }

    return new Response("Hello from redirect-worker!", { status: 200 });
  },
} satisfies ExportedHandler<Env>;
