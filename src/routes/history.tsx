import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useHistory } from "@/hooks/useLocalStore";
import { AppShell } from "@/components/AppShell";
import { History, Trash2 } from "lucide-react";

export const Route = createFileRoute("/history")({
  head: () => ({ meta: [{ title: "Histórico — CAT Smart Parts" }] }),
  component: Page,
});

function Page() {
  const { history, clear } = useHistory();
  const nav = useNavigate();
  return (
    <AppShell>
      <section className="mx-auto max-w-3xl px-4 py-10">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <History className="text-primary" /> Histórico de pesquisas
          </h1>
          {history.length > 0 && (
            <button
              onClick={clear}
              className="text-xs text-muted-foreground hover:text-destructive inline-flex items-center gap-1"
            >
              <Trash2 className="size-3.5" /> Limpar
            </button>
          )}
        </div>
        {history.length === 0 ? (
          <p className="mt-8 text-muted-foreground text-sm">
            Você ainda não pesquisou nada. As últimas 30 buscas ficam salvas neste navegador.
          </p>
        ) : (
          <ul className="mt-6 divide-y divide-border rounded-xl border border-border bg-card">
            {history.map((h) => (
              <li key={h.at}>
                <button
                  onClick={() => nav({ to: "/", search: { q: h.query } as never })}
                  className="w-full text-left px-4 py-3 hover:bg-accent flex items-center justify-between"
                >
                  <span>{h.query}</span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(h.at).toLocaleString("pt-BR")}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </AppShell>
  );
}
