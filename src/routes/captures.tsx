import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";

type Capture = {
  id: string;
  serialNumber: string | null;
  model: string | null;
  systemName: string | null;
  groupName: string | null;
  itemsCount: number;
  status: string;
  capturedAt: string;
  sisUrl: string | null;
};

export const Route = createFileRoute("/captures")({ component: CapturesPage });

function CapturesPage() {
  const [captures, setCaptures] = useState<Capture[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadCaptures = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/captures", { headers: { Accept: "application/json" } });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error || "Falha ao carregar capturas.");
      setCaptures(body.captures ?? []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Falha ao carregar capturas.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCaptures();
  }, [loadCaptures]);

  return (
    <section className="mx-auto max-w-7xl px-4 py-10">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Capturas</h1>
          <p className="mt-2 text-muted-foreground">
            Capturas recebidas da extensão CAT Collector.
          </p>
        </div>
        <Button variant="outline" onClick={() => void loadCaptures()} disabled={loading}>
          <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
          Atualizar
        </Button>
      </div>

      {error ? (
        <p className="mt-8 rounded-md border border-destructive/40 bg-destructive/10 p-4 text-destructive">
          {error}
        </p>
      ) : null}
      {!loading && !error && captures.length === 0 ? (
        <div className="mt-8 rounded-lg border border-dashed p-10 text-center text-muted-foreground">
          Nenhuma captura salva ainda.
        </div>
      ) : null}

      <div className="mt-8 grid gap-4">
        {captures.map((capture) => (
          <article key={capture.id} className="rounded-lg border bg-card p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-semibold">{capture.model || "Modelo não informado"}</h2>
                <p className="text-sm text-muted-foreground">
                  Serial: {capture.serialNumber || "não informado"}
                </p>
              </div>
              <span className="rounded-full bg-primary/15 px-3 py-1 text-xs font-semibold text-primary">
                {capture.itemsCount} peça(s)
              </span>
            </div>
            <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-muted-foreground">Sistema</dt>
                <dd>{capture.systemName || "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Grupo</dt>
                <dd>{capture.groupName || "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Capturada em</dt>
                <dd>{new Date(capture.capturedAt).toLocaleString("pt-BR")}</dd>
              </div>
            </dl>
          </article>
        ))}
      </div>
    </section>
  );
}
