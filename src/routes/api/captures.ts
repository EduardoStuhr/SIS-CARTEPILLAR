import { createFileRoute } from "@tanstack/react-router";

import { json, listCaptures, optionsResponse } from "@/lib/capture-api.server";

export const Route = createFileRoute("/api/captures")({
  server: {
    handlers: {
      GET: async () => {
        try {
          return json({ ok: true, captures: await listCaptures() });
        } catch (error) {
          console.error("[GET /api/captures]", error);
          return json(
            { ok: false, error: "Não foi possível consultar as capturas." },
            { status: 500 },
          );
        }
      },
      OPTIONS: async () => optionsResponse(),
    },
  },
});
