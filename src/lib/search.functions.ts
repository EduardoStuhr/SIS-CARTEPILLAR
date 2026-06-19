import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

function publicClient() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
}

export type PartResult = {
  id: string;
  part_number: string;
  description: string;
  quantity: number;
  image_url: string | null;
  sis_url: string | null;
  group: { id: string; name: string };
  system: { id: string; name: string; subsystem: string | null };
  machine: { id: string; model: string; serial_number: string; family: string | null };
  matched_via?: string;
};

async function fetchPartsByIds(ids: string[]): Promise<PartResult[]> {
  if (!ids.length) return [];
  const supa = publicClient();
  const { data, error } = await supa
    .from("parts")
    .select(
      `id, part_number, description, quantity, image_url, sis_url,
       groups:group_id ( id, name,
         systems:system_id ( id, name, subsystem,
           machines:machine_id ( id, model, serial_number, family )
         )
       )`,
    )
    .in("id", ids);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: any) => ({
    id: r.id,
    part_number: r.part_number,
    description: r.description,
    quantity: r.quantity,
    image_url: r.image_url,
    sis_url: r.sis_url,
    group: { id: r.groups.id, name: r.groups.name },
    system: {
      id: r.groups.systems.id,
      name: r.groups.systems.name,
      subsystem: r.groups.systems.subsystem,
    },
    machine: {
      id: r.groups.systems.machines.id,
      model: r.groups.systems.machines.model,
      serial_number: r.groups.systems.machines.serial_number,
      family: r.groups.systems.machines.family,
    },
  }));
}

export const searchParts = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ query: z.string().min(1) }).parse(d))
  .handler(async ({ data }) => {
    const supa = publicClient();
    const q = data.query.trim().toLowerCase();

    // 1) Exact part number match
    const { data: byPn } = await supa
      .from("parts")
      .select("id")
      .ilike("part_number", `%${q}%`)
      .limit(10);

    // 2) Alias keyword fuzzy match (ilike on words)
    const tokens = q.split(/\s+/).filter((t) => t.length > 2);
    let aliasIds: string[] = [];
    if (tokens.length) {
      const orExpr = tokens.map((t) => `keyword.ilike.%${t}%`).join(",");
      const { data: byAlias } = await supa
        .from("aliases")
        .select("part_id")
        .or(orExpr)
        .limit(50);
      aliasIds = (byAlias ?? []).map((r: any) => r.part_id);
    }

    // 3) Description ilike
    const { data: byDesc } = await supa
      .from("parts")
      .select("id")
      .ilike("description", `%${q}%`)
      .limit(20);

    const ids = Array.from(
      new Set([
        ...(byPn ?? []).map((r: any) => r.id),
        ...aliasIds,
        ...(byDesc ?? []).map((r: any) => r.id),
      ]),
    );

    let results = await fetchPartsByIds(ids);

    // 4) Fallback: if no hits, return ALL parts so client-side Fuse can fuzzy-match
    if (!results.length) {
      const { data: all } = await supa.from("parts").select("id").limit(200);
      results = await fetchPartsByIds((all ?? []).map((r: any) => r.id));
    }

    return { query: data.query, results };
  });

export const listAllParts = createServerFn({ method: "GET" }).handler(async () => {
  const supa = publicClient();
  const { data } = await supa.from("parts").select("id").limit(500);
  return fetchPartsByIds((data ?? []).map((r: any) => r.id));
});
