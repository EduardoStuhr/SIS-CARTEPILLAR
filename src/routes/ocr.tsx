import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { createWorker } from "tesseract.js";
import { Loader2, Upload, ScanLine } from "lucide-react";
import { AppShell } from "@/components/AppShell";

export const Route = createFileRoute("/ocr")({
  head: () => ({
    meta: [{ title: "OCR — CAT Smart Parts" }],
  }),
  component: OcrPage,
});

type Extracted = {
  part_numbers: string[];
  raw: string;
};

function OcrPage() {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [preview, setPreview] = useState<string | null>(null);
  const [result, setResult] = useState<Extracted | null>(null);

  async function handleFile(file: File) {
    setBusy(true);
    setResult(null);
    setProgress(0);
    setPreview(URL.createObjectURL(file));
    try {
      const worker = await createWorker("eng+por", 1, {
        logger: (m: { status: string; progress: number }) => {
          if (m.status === "recognizing text") setProgress(Math.round(m.progress * 100));
        },
      });
      const { data } = await worker.recognize(file);
      await worker.terminate();
      const pns = Array.from(
        new Set<string>([
          ...((data.text.match(/\b\d{3}-\d{4}\b/g) ?? []) as string[]),
          ...((data.text.match(/\b\d{7}\b/g) ?? []) as string[]),
        ]),
      );
      setResult({ part_numbers: pns, raw: data.text });
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell>
      <section className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <ScanLine className="text-primary" /> OCR de prints do SIS
        </h1>
        <p className="mt-2 text-muted-foreground">
          Envie uma captura de tela do SIS 2.0 e extraímos automaticamente Part Numbers,
          descrição e quantidade usando Tesseract.
        </p>

        <label
          className={`mt-8 block cursor-pointer rounded-xl border-2 border-dashed p-10 text-center transition ${
            busy ? "border-primary/50" : "border-border hover:border-primary"
          }`}
        >
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
            }}
          />
          {busy ? (
            <div className="flex flex-col items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-6 animate-spin text-primary" />
              Processando OCR... {progress}%
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 text-sm text-muted-foreground">
              <Upload className="size-6 text-primary" />
              Clique ou arraste uma imagem aqui
            </div>
          )}
        </label>

        {preview && (
          <div className="mt-8 grid md:grid-cols-2 gap-6">
            <img
              src={preview}
              alt="preview"
              className="rounded-xl border border-border max-h-96 object-contain bg-secondary/40"
            />
            <div>
              <h2 className="font-semibold mb-2">Part Numbers detectados</h2>
              {result?.part_numbers.length ? (
                <ul className="space-y-1">
                  {result.part_numbers.map((pn) => (
                    <li
                      key={pn}
                      className="font-mono text-primary text-lg font-bold rounded bg-secondary/60 px-3 py-1.5 inline-block mr-2"
                    >
                      {pn}
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="text-sm text-muted-foreground">
                  {result ? "Nenhum PN no padrão XXX-XXXX encontrado." : "Aguardando imagem..."}
                </div>
              )}

              {result?.raw && (
                <details className="mt-4 text-xs">
                  <summary className="cursor-pointer text-muted-foreground">
                    Ver texto bruto extraído
                  </summary>
                  <pre className="mt-2 max-h-64 overflow-auto rounded bg-secondary/40 p-3 whitespace-pre-wrap">
                    {result.raw}
                  </pre>
                </details>
              )}
            </div>
          </div>
        )}
      </section>
    </AppShell>
  );
}
