import { createFileRoute } from "@tanstack/react-router";

import {
  authorizeCollector,
  captureSchema,
  json,
  optionsResponse,
  saveCapture,
} from "@/lib/capture-api.server";

export const Route = createFileRoute("/api/sis-capture")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!authorizeCollector(request)) {
          return json({ ok: false, error: "Authorization Bearer inválido." }, { status: 401 });
        }

        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return json({ ok: false, error: "O corpo deve ser um JSON válido." }, { status: 400 });
        }

        const parsed = captureSchema.safeParse(body);
        if (!parsed.success) {
          return json(
            { ok: false, error: "Captura inválida.", details: parsed.error.flatten() },
            { status: 422 },
          );
        }

        try {
          const saved = await saveCapture(parsed.data);
          return json({ ok: true, ...saved });
        } catch (error) {
          console.error("[POST /api/sis-capture]", error);
          return json({ ok: false, error: "Não foi possível salvar a captura." }, { status: 500 });
        }
      },
      OPTIONS: async () => optionsResponse(),
    },
  },
});
