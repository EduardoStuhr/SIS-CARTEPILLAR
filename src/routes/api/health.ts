import { createFileRoute } from "@tanstack/react-router";

import { json, optionsResponse } from "@/lib/capture-api.server";

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async () => json({ ok: true }),
      OPTIONS: async () => optionsResponse(),
    },
  },
});
