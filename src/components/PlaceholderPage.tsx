export function PlaceholderPage({ title, description }: { title: string; description: string }) {
  return (
    <section className="mx-auto max-w-7xl px-4 py-12">
      <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
      <p className="mt-3 max-w-2xl text-muted-foreground">{description}</p>
    </section>
  );
}
