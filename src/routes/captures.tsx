import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Check, ExternalLink, PackagePlus, RefreshCw, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { deleteCapture, reviewCapture } from "@/lib/base.functions";
import { Button } from "@/components/ui/button";

type CapturePart = {
  partNumber: string;
  description?: string;
  quantity?: number;
  position?: string;
  url?: string;
};

type Capture = {
  id: string;
  serialNumber: string | null;
  model: string | null;
  systemName: string | null;
  subsystem: string | null;
  groupName: string | null;
  itemsCount: number;
  status: string;
  capturedAt: string;
  sisUrl: string | null;
  parts?: CapturePart[];
};

export const Route = createFileRoute("/captures")({ component: CapturesPage });

function statusClass(status: string) {
  if (status === "approved" || status === "imported") return "bg-green-900/40 text-green-300";
  if (status === "rejected") return "bg-red-900/40 text-red-300";
  return "bg-yellow-900/40 text-yellow-300";
}

function CapturesPage() {
  const setCaptureStatus = useServerFn(reviewCapture);
  const removeCapture = useServerFn(deleteCapture);
  const [captures, setCaptures] = useState<Capture[]>([]);
  const [selected, setSelected] = useState<Capture | null>(null);
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

  async function updateCapture(capture: Capture, status: "received" | "imported" | "approved" | "rejected" | "pending") {
    await setCaptureStatus({ data: { id: capture.id, status } });
    setCaptures((current) => current.map((item) => (item.id === capture.id ? { ...item, status } : item)));
    setSelected((current) => (current?.id === capture.id ? { ...current, status } : current));
    toast.success(`Captura marcada como ${status}.`);
  }

  async function deleteSelected(capture: Capture) {
    await removeCapture({ data: { id: capture.id } });
    setCaptures((current) => current.filter((item) => item.id !== capture.id));
    setSelected(null);
    toast.success("Captura excluída.");
  }

  return (
    <AppShell>
      <section className="mx-auto max-w-7xl px-4 py-10">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Capturas</h1>
            <p className="mt-2 text-muted-foreground">Capturas recebidas da extensão CAT Collector.</p>
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
            <button
              key={capture.id}
              type="button"
              onClick={() => setSelected(capture)}
              className="rounded-lg border bg-card p-5 text-left shadow-sm transition hover:border-primary hover:bg-accent/40"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="font-semibold">{capture.model || "Modelo não informado"}</h2>
                  <p className="text-sm text-muted-foreground">Serial: {capture.serialNumber || "não informado"}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusClass(capture.status)}`}>
                    {capture.status}
                  </span>
                  <span className="rounded-full bg-primary/15 px-3 py-1 text-xs font-semibold text-primary">
                    {capture.itemsCount} peça(s)
                  </span>
                </div>
              </div>
              <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-3">
                <div>
                  <dt className="text-muted-foreground">Sistema</dt>
                  <dd>{capture.systemName || "-"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Grupo</dt>
                  <dd>{capture.groupName || "-"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Capturada em</dt>
                  <dd>{new Date(capture.capturedAt).toLocaleString("pt-BR")}</dd>
                </div>
              </dl>
            </button>
          ))}
        </div>
      </section>

      {selected ? (
        <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm" onClick={() => setSelected(null)}>
          <aside
            className="ml-auto h-full w-full max-w-2xl overflow-auto border-l border-border bg-card p-6 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground">Detalhe da captura</p>
                <h2 className="mt-1 text-2xl font-bold">{selected.model || "Modelo não informado"}</h2>
                <p className="text-sm text-muted-foreground">Serial: {selected.serialNumber || "não informado"}</p>
              </div>
              <button className="rounded p-2 hover:bg-accent" onClick={() => setSelected(null)}><X className="size-4" /></button>
            </div>

            <dl className="mt-6 grid gap-3 text-sm sm:grid-cols-2">
              {[
                ["Sistema", selected.systemName || "-"],
                ["Grupo", selected.groupName || "-"],
                ["Capturado em", new Date(selected.capturedAt).toLocaleString("pt-BR")],
                ["Quantidade total", `${selected.itemsCount} peça(s)`],
                ["Status", selected.status],
                ["URL origem", selected.sisUrl || "-"],
              ].map(([label, value]) => (
                <div key={label} className="rounded-md border border-border p-3">
                  <dt className="text-xs text-muted-foreground">{label}</dt>
                  <dd className="mt-1 break-words">{value}</dd>
                </div>
              ))}
            </dl>

            <div className="mt-6 flex flex-wrap gap-2">
              <button className="rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground" onClick={() => void updateCapture(selected, "imported")}><PackagePlus className="mr-1 inline size-4" /> Importar para Base</button>
              <button className="rounded-md bg-green-600 px-3 py-2 text-sm font-semibold text-white" onClick={() => void updateCapture(selected, "approved")}><Check className="mr-1 inline size-4" /> Aprovar todas</button>
              <button className="rounded-md border border-border px-3 py-2 text-sm" onClick={() => void deleteSelected(selected)}><Trash2 className="mr-1 inline size-4" /> Excluir captura</button>
              {selected.sisUrl ? (
                <a className="rounded-md border border-border px-3 py-2 text-sm" href={selected.sisUrl} target="_blank" rel="noreferrer"><ExternalLink className="mr-1 inline size-4" /> Abrir origem SIS</a>
              ) : null}
            </div>

            <h3 className="mt-8 font-semibold">Peças capturadas</h3>
            <div className="mt-3 overflow-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="bg-secondary text-xs uppercase tracking-wider">
                  <tr>
                    <th className="p-2 text-left">Part #</th>
                    <th className="p-2 text-left">Descrição</th>
                    <th className="p-2 text-left">Qtd</th>
                    <th className="p-2 text-left">Pos</th>
                  </tr>
                </thead>
                <tbody>
                  {(selected.parts ?? []).map((part, index) => (
                    <tr key={`${part.partNumber}-${index}`} className="border-t border-border">
                      <td className="p-2 font-mono text-primary">{part.partNumber}</td>
                      <td className="p-2">{part.description || part.partNumber}</td>
                      <td className="p-2">{part.quantity ?? 1}</td>
                      <td className="p-2">{part.position || "-"}</td>
                    </tr>
                  ))}
                  {!(selected.parts ?? []).length ? (
                    <tr><td className="p-4 text-muted-foreground" colSpan={4}>A captura antiga não possui lista detalhada no payload exibido.</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </aside>
        </div>
      ) : null}
    </AppShell>
  );
}
