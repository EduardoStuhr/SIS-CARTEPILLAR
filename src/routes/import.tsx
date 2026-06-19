import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import * as XLSX from "xlsx";
import { Upload, FileSpreadsheet, Loader2 } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { importRows } from "@/lib/base.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/import")({
  head: () => ({ meta: [{ title: "Importar CSV/XLSX — CAT Smart Parts" }] }),
  component: Page,
});

const REQUIRED = ["model", "serial", "system", "group", "partNumber"];
const OPTIONAL = ["fleet", "subsystem", "description", "quantity", "itemPosition"];

function Page() {
  const importer = useServerFn(importRows);
  const [rows, setRows] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);

  async function onFile(file: File) {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json<any>(sheet, { defval: "" });
    setRows(data);
    toast.success(`${data.length} linha(s) lidas`);
  }

  async function runImport() {
    if (!rows.length) return;
    setBusy(true);
    try {
      const r = await importer({ data: { rows } });
      toast.success(`Importadas ${r.imported} peça(s)${r.errors.length ? ` · ${r.errors.length} erro(s)` : ""}`);
      if (r.errors.length) console.warn(r.errors);
    } catch (e: any) {
      toast.error(e.message);
    } finally { setBusy(false); }
  }

  return (
    <AppShell>
      <section className="mx-auto max-w-4xl px-4 py-8">
        <div className="flex items-center gap-3 mb-2">
          <FileSpreadsheet className="text-primary" />
          <h1 className="text-2xl font-bold">Importar CSV / Excel</h1>
        </div>
        <p className="text-sm text-muted-foreground mb-6">
          Colunas obrigatórias: <code className="text-foreground">{REQUIRED.join(", ")}</code>.
          Opcionais: <code className="text-foreground">{OPTIONAL.join(", ")}</code>. Linhas importadas entram como
          <span className="text-primary"> pendentes</span> para revisão.
        </p>

        <label className="block rounded-xl border-2 border-dashed border-border bg-card p-10 text-center cursor-pointer hover:border-primary transition">
          <Upload className="mx-auto size-8 text-primary mb-2" />
          <div className="text-sm">Clique para escolher um arquivo .csv, .xlsx ou .xls</div>
          <input
            type="file" accept=".csv,.xlsx,.xls" className="hidden"
            onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
          />
        </label>

        {rows.length > 0 && (
          <>
            <div className="mt-6 flex items-center justify-between">
              <div className="text-sm text-muted-foreground">{rows.length} linha(s) prontas para importar</div>
              <button
                disabled={busy}
                onClick={runImport}
                className="rounded-lg bg-primary px-5 py-2 text-sm font-bold text-primary-foreground hover:brightness-110 inline-flex items-center gap-2 disabled:opacity-60"
              >
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />} Importar
              </button>
            </div>
            <div className="mt-3 overflow-auto rounded-lg border border-border max-h-96">
              <table className="text-xs w-full">
                <thead className="bg-secondary"><tr>{Object.keys(rows[0]).map((k) => <th key={k} className="text-left p-2">{k}</th>)}</tr></thead>
                <tbody>
                  {rows.slice(0, 50).map((r, i) => (
                    <tr key={i} className="border-t border-border">
                      {Object.keys(rows[0]).map((k) => <td key={k} className="p-2">{String(r[k] ?? "")}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </AppShell>
  );
}
