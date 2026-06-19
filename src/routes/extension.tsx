import { createFileRoute } from "@tanstack/react-router";
import { Download, Puzzle } from "lucide-react";
import { AppShell } from "@/components/AppShell";

export const Route = createFileRoute("/extension")({
  head: () => ({
    meta: [{ title: "Extensão CAT Collector — CAT Smart Parts" }],
  }),
  component: Page,
});

function Page() {
  function download() {
    fetch("/cat-collector.zip")
      .then((r) => {
        if (!r.ok) throw new Error("Download falhou: " + r.status);
        return r.blob();
      })
      .then((blob) => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "cat-collector.zip";
        a.click();
        URL.revokeObjectURL(a.href);
      })
      .catch((e) => alert(e.message));
  }

  return (
    <AppShell>
      <section className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <Puzzle className="text-primary" /> Extensão CAT Collector
        </h1>
        <p className="mt-3 text-muted-foreground">
          Instale a extensão no Chrome (ou qualquer Chromium) para capturar peças diretamente do
          <code className="mx-1 rounded bg-secondary px-1.5 py-0.5 text-xs">sis2.cat.com</code>
          com um clique e enviá-las ao catálogo do CAT Smart Parts.
        </p>

        <button
          onClick={download}
          className="mt-6 inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-3 text-sm font-bold text-primary-foreground hover:brightness-110"
        >
          <Download className="size-4" /> Baixar cat-collector.zip
        </button>

        <ol className="mt-8 space-y-3 text-sm list-decimal list-inside text-muted-foreground">
          <li>Descompacte o arquivo baixado.</li>
          <li>Abra <code className="text-foreground">chrome://extensions</code> no Chrome.</li>
          <li>Ative o <span className="text-foreground">Modo desenvolvedor</span> no canto superior direito.</li>
          <li>Clique em <span className="text-foreground">Carregar sem compactação</span> e selecione a pasta descompactada.</li>
          <li>
            Abra o popup da extensão e preencha:
            <ul className="list-disc list-inside mt-2 ml-4 space-y-1">
              <li><b className="text-foreground">Backend URL</b>: a URL pública deste app (ex.: <code>https://seu-app.lovable.app</code>).</li>
              <li><b className="text-foreground">Collector Key</b>: o valor do segredo <code>CAT_COLLECTOR_KEY</code> configurado no backend.</li>
            </ul>
          </li>
          <li>
            Navegue até <code className="text-foreground">https://sis2.cat.com</code> e use os botões
            <strong className="text-primary"> Capturar página</strong> ou
            <strong className="text-primary"> Capturar tudo visível</strong> no painel flutuante.
          </li>
          <li>As capturas entram como <span className="text-primary">pendentes</span> em <code>/captures</code> para revisão.</li>
        </ol>

        <div className="mt-8 rounded-lg border border-border bg-card/50 p-4 text-xs text-muted-foreground">
          <b className="text-foreground">Endpoint:</b> <code>POST /api/sis-capture</code><br />
          <b className="text-foreground">Header de autenticação:</b> <code>Authorization: Bearer &lt;CAT_COLLECTOR_KEY&gt;</code><br />
          A extensão nunca faz scraping em massa — captura apenas a página aberta manualmente.
        </div>
      </section>
    </AppShell>
  );
}
