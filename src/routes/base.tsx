import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import Fuse from "fuse.js";
import { Database, Loader2, Filter, Check, X } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { listBase, reviewPart, type BaseRow } from "@/lib/base.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/base")({
  head: () => ({ meta: [{ title: "Base SIS Capturada — CAT Smart Parts" }] }),
  component: Page,
});

function Page() {
  const load = useServerFn(listBase);
  const review = useServerFn(reviewPart);
  const [rows, setRows] = useState<BaseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [f, setF] = useState({ fleet: "", model: "", serial: "", system: "", group: "", status: "" });

  async function refresh() {
    setLoading(true);
    try {
      const r = await load();
      setRows(r.rows);
    } finally { setLoading(false); }
  }
  useEffect(() => { refresh(); }, []);

  const filtered = useMemo(() => {
    let list = rows;
    const norm = (s: string | null | undefined) => (s ?? "").toLowerCase();
    list = list.filter((r) =>
      (!f.fleet  || norm(r.fleet_name).includes(f.fleet.toLowerCase())) &&
      (!f.model  || norm(r.model).includes(f.model.toLowerCase())) &&
      (!f.serial || norm(r.serial_number).includes(f.serial.toLowerCase())) &&
      (!f.system || norm(r.system_name).includes(f.system.toLowerCase())) &&
      (!f.group  || norm(r.group_name).includes(f.group.toLowerCase())) &&
      (!f.status || r.status === f.status),
    );
    if (q.trim()) {
      const fuse = new Fuse(list, {
        keys: ["part_number", "description", "group_name", "system_name", "model"],
        threshold: 0.4, ignoreLocation: true,
      });
      list = fuse.search(q).map((r) => r.item);
    }
    return list.slice(0, 300);
  }, [rows, q, f]);

  async function setStatus(id: string, status: "approved" | "rejected" | "pending") {
    await review({ data: { id, status } });
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, status } : r)));
    toast.success(`Marcado como ${status}`);
  }

  return (
    <AppShell>
      <section className="mx-auto max-w-7xl px-4 py-8">
        <div className="flex items-center gap-3 mb-6">
          <Database className="text-primary" />
          <h1 className="text-2xl font-bold">Base SIS Capturada</h1>
          <span className="text-xs text-muted-foreground ml-2">{rows.length} peças no total</span>
        </div>

        <div className="rounded-xl border border-border bg-card p-4 mb-4 grid md:grid-cols-7 gap-2">
          <input className="input-cat" placeholder="Busca inteligente (fuzzy)" value={q} onChange={(e) => setQ(e.target.value)} />
          <input className="input-cat" placeholder="Frota" value={f.fleet} onChange={(e) => setF({ ...f, fleet: e.target.value })} />
          <input className="input-cat" placeholder="Modelo" value={f.model} onChange={(e) => setF({ ...f, model: e.target.value })} />
          <input className="input-cat" placeholder="Serial" value={f.serial} onChange={(e) => setF({ ...f, serial: e.target.value })} />
          <input className="input-cat" placeholder="Sistema" value={f.system} onChange={(e) => setF({ ...f, system: e.target.value })} />
          <input className="input-cat" placeholder="Grupo" value={f.group} onChange={(e) => setF({ ...f, group: e.target.value })} />
          <select className="input-cat" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
            <option value="">Todos status</option>
            <option value="approved">Aprovados</option>
            <option value="pending">Pendentes</option>
            <option value="rejected">Rejeitados</option>
          </select>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="animate-spin size-4" /> Carregando…</div>
        ) : (
          <div className="overflow-auto rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead className="bg-secondary text-xs uppercase tracking-wider">
                <tr>
                  <th className="text-left p-2">Part #</th>
                  <th className="text-left p-2">Descrição</th>
                  <th className="text-left p-2">Qtd</th>
                  <th className="text-left p-2">Pos</th>
                  <th className="text-left p-2">Grupo</th>
                  <th className="text-left p-2">Sistema</th>
                  <th className="text-left p-2">Modelo / Serial</th>
                  <th className="text-left p-2">Origem</th>
                  <th className="text-left p-2">Status</th>
                  <th className="text-left p-2">Ações</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id} className="border-t border-border hover:bg-secondary/40">
                    <td className="p-2 font-mono text-primary">{r.part_number}</td>
                    <td className="p-2">{r.description}</td>
                    <td className="p-2">{r.quantity}</td>
                    <td className="p-2">{r.item_position ?? "—"}</td>
                    <td className="p-2">{r.group_name}</td>
                    <td className="p-2">{r.system_name}{r.subsystem ? ` / ${r.subsystem}` : ""}</td>
                    <td className="p-2">{r.model} · <span className="text-muted-foreground">{r.serial_number}</span></td>
                    <td className="p-2"><span className="text-xs rounded bg-secondary px-1.5 py-0.5">{r.source}</span></td>
                    <td className="p-2">
                      <span className={`text-xs rounded px-1.5 py-0.5 ${
                        r.status === "approved" ? "bg-green-900/40 text-green-300" :
                        r.status === "rejected" ? "bg-red-900/40 text-red-300" :
                        "bg-yellow-900/40 text-yellow-300"
                      }`}>{r.status}</span>
                    </td>
                    <td className="p-2 flex gap-1">
                      <button className="p-1 rounded hover:bg-green-900/40" onClick={() => setStatus(r.id, "approved")} title="Aprovar"><Check className="size-4 text-green-400" /></button>
                      <button className="p-1 rounded hover:bg-red-900/40" onClick={() => setStatus(r.id, "rejected")} title="Rejeitar"><X className="size-4 text-red-400" /></button>
                    </td>
                  </tr>
                ))}
                {!filtered.length && (
                  <tr><td colSpan={10} className="p-8 text-center text-muted-foreground"><Filter className="inline mr-2 size-4" /> Nenhuma peça encontrada.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </AppShell>
  );
}
