import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useFavorites } from "@/hooks/useLocalStore";
import { listAllParts } from "@/lib/search.functions";
import { AppShell } from "@/components/AppShell";
import { PartCard } from "@/components/PartCard";
import { Star } from "lucide-react";

export const Route = createFileRoute("/favorites")({
  head: () => ({ meta: [{ title: "Favoritos — CAT Smart Parts" }] }),
  component: Page,
});

function Page() {
  const { favorites } = useFavorites();
  const list = useServerFn(listAllParts);
  const { data } = useQuery({ queryKey: ["all-parts"], queryFn: () => list() });
  const items = (data ?? []).filter((p) => favorites.includes(p.id));

  return (
    <AppShell>
      <section className="mx-auto max-w-5xl px-4 py-10 space-y-4">
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <Star className="text-primary" /> Peças favoritas
        </h1>
        {items.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Marque ⭐ em qualquer peça nos resultados de busca para vê-la aqui.
          </p>
        ) : (
          items.map((p) => <PartCard key={p.id} part={p} />)
        )}
      </section>
    </AppShell>
  );
}
