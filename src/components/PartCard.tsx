import { Copy, ExternalLink, Star, StarOff } from "lucide-react";
import { toast } from "sonner";
import type { PartResult } from "@/lib/search.functions";
import { useFavorites } from "@/hooks/useLocalStore";

export function PartCard({ part }: { part: PartResult }) {
  const { favorites, toggle } = useFavorites();
  const isFav = favorites.includes(part.id);

  return (
    <article className="group rounded-xl border border-border bg-card overflow-hidden hover:border-primary/60 transition">
      <div className="grid md:grid-cols-[200px_1fr]">
        <div className="bg-secondary/40 aspect-square md:aspect-auto flex items-center justify-center overflow-hidden">
          {part.image_url ? (
            <img
              src={part.image_url}
              alt={part.description}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="text-muted-foreground text-xs">Sem diagrama</div>
          )}
        </div>
        <div className="p-5 flex flex-col gap-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                {part.machine.model} · SN {part.machine.serial_number}
              </div>
              <h3 className="text-lg font-semibold mt-1">{part.description}</h3>
            </div>
            <button
              onClick={() => toggle(part.id)}
              className="text-muted-foreground hover:text-primary p-1"
              aria-label="Favoritar"
            >
              {isFav ? <Star className="size-5 fill-primary text-primary" /> : <StarOff className="size-5" />}
            </button>
          </div>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <Row label="Sistema" value={part.system.name} />
            <Row label="Subsistema" value={part.system.subsystem ?? "—"} />
            <Row label="Grupo" value={part.group.name} />
            <Row label="Quantidade" value={String(part.quantity)} />
          </dl>

          <div className="flex items-end justify-between gap-3 mt-1">
            <div>
              <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Part Number</div>
              <div className="font-mono text-2xl font-bold text-primary tracking-tight">
                {part.part_number}
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  navigator.clipboard.writeText(part.part_number);
                  toast.success("Part Number copiado");
                }}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary px-3 py-2 text-xs font-medium hover:bg-accent transition"
              >
                <Copy className="size-3.5" /> Copiar PN
              </button>
              {part.sis_url && (
                <a
                  href={part.sis_url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-bold text-primary-foreground hover:brightness-110 transition"
                >
                  <ExternalLink className="size-3.5" /> Abrir no SIS
                </a>
              )}
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{label}</dt>
      <dd className="text-foreground">{value}</dd>
    </div>
  );
}
