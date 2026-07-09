/**
 * click-processor-worker
 *
 * Queue consumer — receives click events and aggregates analytics into KV.
 * Business logic will be added in a future step.
 */

interface Env {
  // ANALYTICS_KV: KVNamespace; // Uncomment when KV binding is wired up
}

interface ClickEvent {
  shortCode: string;
  timestamp: number;
  // Additional fields (referrer, country, etc.) will be added later
}

export default {
  /**
   * HTTP handler — only used for health-checks / wrangler dev curl testing.
   */
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return new Response("Hello from click-processor-worker!", { status: 200 });
  },

  /**
   * Queue consumer — called by Cloudflare when click-events messages arrive.
   */
  async queue(batch: MessageBatch<ClickEvent>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      // TODO: aggregate click data into ANALYTICS_KV
      console.log("[click-processor] received click event:", JSON.stringify(message.body));
      message.ack();
    }
  },
} satisfies ExportedHandler<Env>;
