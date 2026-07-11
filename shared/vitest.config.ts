import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // crypto.subtle is available globally in Node ≥ 18.7.
    // No special environment flag needed — the default "node" pool works.
    environment: "node",
  },
});
