/**
 * shorten-worker
 *
 * Handles POST /shorten — creates a short URL mapping.
 * Business logic will be added in a future step.
 */

interface Env {
  // LINKS_KV: KVNamespace; // Uncomment when KV binding is wired up
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/shorten") {
      // TODO: implement URL shortening logic
      return new Response(
        JSON.stringify({ message: "shorten-worker: POST /shorten — not yet implemented" }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response("Hello from shorten-worker!", { status: 200 });
  },
} satisfies ExportedHandler<Env>;
