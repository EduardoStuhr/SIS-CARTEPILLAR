import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import Fuse from "fuse.js";
import {
  Check,
  Clipboard,
  Database,
  Filter,
  Loader2,
  RefreshCw,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { useFavorites } from "@/hooks/useLocalStore";
import { deletePart, listBase, reviewPart, type BaseRow } from "@/lib/base.functions";

export const Route = createFileRoute("/base")({
  head: () => ({ meta: [{ title: "Base SIS Capturada - CAT Smart Parts" }] }),
  component: Page,
});

function asText(value: unknown) {
  return String(value ?? "").toLowerCase();
}

function statusClass(status: string) {
  if (status === "approved") return "bg-green-900/40 text-green-300";
  if (status === "rejected") return "bg-red-900/40 text-red-300";
  return "bg-yellow-900/40 text-yellow-300";
}

function Page() {
  const load = useServerFn(listBase);
  const review = useServerFn(reviewPart);
  const remove = useServerFn(deletePart);
  const { favorites, toggle } = useFavorites();
  const [rows, setRows] = useState<BaseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<BaseRow | null>(null);
  const [q, setQ] = useState("");
  const [f, setF] = useState({ fleet: "", model: "", serial: "", system: "", group: "", status: "" });

  async function refresh() {
    setLoading(true);
    try {
      const result = await load();
      setRows(result.rows);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao carregar a Base.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  const filtered = useMemo(() => {
    let list = rows.filter((row) =>
      (!f.fleet || asText(row.fleet_name).includes(asText(f.fleet))) &&
      (!f.model || asText(row.model).includes(asText(f.model))) &&
      (!f.serial || asText(row.serial_number).includes(asText(f.serial))) &&
      (!f.system || asText(row.system_name).includes(asText(f.system))) &&
      (!f.group || asText(row.group_name).includes(asText(f.group))) &&
      (!f.status || row.status === f.status),
    );

    const query = q.trim();
    if (query) {
      const direct = list.filter((row) =>
        [
          row.part_number,
          row.description,
          row.group_name,
          row.system_name,
          row.model,
          row.serial_number,
          row.item_position,
          row.captured_at,
          row.source,
          row.status,
          row.capture_id,
        ].some((value) => asText(value).includes(asText(query))),
      );
      if (direct.length) list = direct;
      else {
        const fuse = new Fuse(list, {
          keys: [
            "part_number",
            "description",
            "group_name",
            "system_name",
            "model",
            "serial_number",
            "item_position",
            "captured_at",
            "source",
            "status",
            "capture_id",
          ],
          threshold: 0.35,
          ignoreLocation: true,
        });
        list = fuse.search(query).map((result) => result.item);
      }
    }
    return list.slice(0, 500);
  }, [rows, q, f]);

  async function setStatus(row: BaseRow, status: "approved" | "rejected" | "pending") {
    await review({ data: { id: row.id, status } });
    setRows((current) => current.map((item) => (item.id === row.id ? { ...item, status } : item)));
    setSelected((current) => (current?.id === row.id ? { ...current, status } : current));
    toast.success(`Peça ${row.part_number} marcada como ${status}.`);
  }

  async function deleteRow(row: BaseRow) {
    await remove({ data: { id: row.id } });
    setRows((current) => current.filter((item) => item.id !== row.id));
    setSelected(null);
    toast.success(`Peça ${row.part_number} excluída.`);
  }

  async function copyPart(row: BaseRow) {
    await navigator.clipboard.writeText(row.part_number);
    toast.success("Número da peça copiado.");
  }

  return (
    <AppShell>
      <section className="mx-auto max-w-7xl px-4 py-8">
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <Database className="text-primary" />
          <h1 className="text-2xl font-bold">Base SIS Capturada</h1>
          <span className="text-xs text-muted-foreground">{rows.length} peças no total</span>
          <button
            type="button"
            onClick={() => void refresh()}
            className="ml-auto inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent"
          >
            <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
            Atualizar
          </button>
        </div>

        <div className="mb-4 grid gap-2 rounded-lg border border-border bg-card p-4 md:grid-cols-7">
          <input className="input-cat" placeholder="Busca inteligente" value={q} onChange={(e) => setQ(e.target.value)} />
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
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Carregando...
          </div>
        ) : (
          <div className="overflow-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-secondary text-xs uppercase tracking-wider">
                <tr>
                  <th className="p-2 text-left">Part #</th>
                  <th className="p-2 text-left">Descrição</th>
                  <th className="p-2 text-left">Qtd</th>
                  <th className="p-2 text-left">Pos</th>
                  <th className="p-2 text-left">Grupo</th>
                  <th className="p-2 text-left">Sistema</th>
                  <th className="p-2 text-left">Modelo / Serial</th>
                  <th className="p-2 text-left">Origem</th>
                  <th className="p-2 text-left">Status</th>
                  <th className="p-2 text-left">Ações</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => (
                  <tr
                    key={row.id}
                    onClick={() => setSelected(row)}
                    className="cursor-pointer border-t border-border hover:bg-secondary/40"
                  >
                    <td className="p-2 font-mono text-primary">{row.part_number}</td>
                    <td className="p-2">{row.description}</td>
                    <td className="p-2">{row.quantity}</td>
                    <td className="p-2">{row.item_position || "-"}</td>
                    <td className="p-2">{row.group_name}</td>
                    <td className="p-2">{row.system_name}{row.subsystem ? ` / ${row.subsystem}` : ""}</td>
                    <td className="p-2">{row.model} <span className="text-muted-foreground">/ {row.serial_number}</span></td>
                    <td className="p-2"><span className="rounded bg-secondary px-1.5 py-0.5 text-xs">{row.source}</span></td>
                    <td className="p-2"><span className={`rounded px-1.5 py-0.5 text-xs ${statusClass(row.status)}`}>{row.status}</span></td>
                    <td className="p-2">
                      <div className="flex gap-1" onClick={(event) => event.stopPropagation()}>
                        <button className="rounded p-1 hover:bg-green-900/40" onClick={() => void setStatus(row, "approved")} title="Aprovar"><Check className="size-4 text-green-400" /></button>
                        <button className="rounded p-1 hover:bg-red-900/40" onClick={() => void setStatus(row, "rejected")} title="Rejeitar"><X className="size-4 text-red-400" /></button>
                        <button className="rounded p-1 hover:bg-accent" onClick={() => void copyPart(row)} title="Copiar número"><Clipboard className="size-4" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
                {!filtered.length ? (
                  <tr>
                    <td colSpan={10} className="p-8 text-center text-muted-foreground">
                      <Filter className="mr-2 inline size-4" /> Nenhuma peça encontrada.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {selected ? (
        <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm" onClick={() => setSelected(null)}>
          <aside
            className="ml-auto h-full w-full max-w-xl overflow-auto border-l border-border bg-card p-6 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground">Detalhe da peça</p>
                <h2 className="mt-1 font-mono text-2xl font-bold text-primary">{selected.part_number}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{selected.description}</p>
              </div>
              <button className="rounded p-2 hover:bg-accent" onClick={() => setSelected(null)}><X className="size-4" /></button>
            </div>

            <dl className="mt-6 grid gap-3 text-sm sm:grid-cols-2">
              {[
                ["Quantidade", selected.quantity],
                ["Posição", selected.item_position || "-"],
                ["Modelo", selected.model || "Modelo não informado"],
                ["Serial", selected.serial_number || "-"],
                ["Sistema", selected.system_name || "-"],
                ["Grupo", selected.group_name || "-"],
                ["URL original do SIS", selected.sis_url || "-"],
                ["Data da captura", selected.captured_at ? new Date(selected.captured_at).toLocaleString("pt-BR") : "-"],
                ["Origem", selected.source || "-"],
                ["Status", selected.status || "-"],
                ["Capture ID", selected.capture_id || "-"],
              ].map(([label, value]) => (
                <div key={label} className="rounded-md border border-border p-3">
                  <dt className="text-xs text-muted-foreground">{label}</dt>
                  <dd className="mt-1 break-words">{value}</dd>
                </div>
              ))}
            </dl>

            <div className="mt-6 flex flex-wrap gap-2">
              <button className="rounded-md bg-green-600 px-3 py-2 text-sm font-semibold text-white" onClick={() => void setStatus(selected, "approved")}>Aprovar</button>
              <button className="rounded-md bg-red-600 px-3 py-2 text-sm font-semibold text-white" onClick={() => void setStatus(selected, "rejected")}>Rejeitar</button>
              <button className="rounded-md border border-border px-3 py-2 text-sm" onClick={() => void deleteRow(selected)}><Trash2 className="mr-1 inline size-4" /> Excluir</button>
              <button className="rounded-md border border-border px-3 py-2 text-sm" onClick={() => toggle(selected.id)}><Star className="mr-1 inline size-4" /> {favorites.includes(selected.id) ? "Remover favorito" : "Favorito"}</button>
              <button className="rounded-md border border-border px-3 py-2 text-sm" onClick={() => void copyPart(selected)}><Clipboard className="mr-1 inline size-4" /> Copiar número</button>
            </div>
          </aside>
        </div>
      ) : null}
    </AppShell>
  );
}
