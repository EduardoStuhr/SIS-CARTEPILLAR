import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

function publicClient() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
}
function adminClient() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export type BaseRow = {
  id: string;
  part_number: string;
  description: string;
  quantity: number;
  item_position: string | null;
  image_url: string | null;
  sis_url: string | null;
  status: string;
  source: string;
  group_name: string;
  system_name: string;
  subsystem: string | null;
  model: string;
  serial_number: string;
  fleet_name: string | null;
};

export const listBase = createServerFn({ method: "GET" }).handler(async () => {
  const supa = publicClient();
  const { data, error } = await supa
    .from("parts")
    .select(
      `id, part_number, description, quantity, item_position, image_url, sis_url, status, source,
       groups:group_id ( name,
         systems:system_id ( name, subsystem,
           machines:machine_id ( model, serial_number,
             fleets:fleet_id ( name )
           )
         )
       )`,
    )
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw new Error(error.message);
  const rows: BaseRow[] = (data ?? []).map((r: any) => ({
    id: r.id,
    part_number: r.part_number,
    description: r.description,
    quantity: r.quantity,
    item_position: r.item_position,
    image_url: r.image_url,
    sis_url: r.sis_url,
    status: r.status,
    source: r.source,
    group_name: r.groups?.name ?? "",
    system_name: r.groups?.systems?.name ?? "",
    subsystem: r.groups?.systems?.subsystem ?? null,
    model: r.groups?.systems?.machines?.model ?? "",
    serial_number: r.groups?.systems?.machines?.serial_number ?? "",
    fleet_name: r.groups?.systems?.machines?.fleets?.name ?? null,
  }));
  return { rows };
});

export const listCaptures = createServerFn({ method: "GET" }).handler(async () => {
  const supa = publicClient();
  const { data, error } = await supa
    .from("captures")
    .select("*")
    .order("captured_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  return { captures: data ?? [] };
});

export const reviewPart = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({
      id: z.string().uuid(),
      status: z.enum(["approved", "rejected", "pending"]),
    }).parse(d),
  )
  .handler(async ({ data }) => {
    const admin = adminClient();
    const { error } = await admin.from("parts").update({ status: data.status }).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const reviewCapture = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({
      id: z.string().uuid(),
      status: z.enum(["approved", "rejected", "pending"]),
    }).parse(d),
  )
  .handler(async ({ data }) => {
    const admin = adminClient();
    const { error } = await admin
      .from("captures")
      .update({ status: data.status, reviewed_at: new Date().toISOString() })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    // cascade to its parts (those captured in same diagram tracked by raw_payload sisUrl)
    if (data.status !== "pending") {
      const { data: cap } = await admin.from("captures").select("raw_payload").eq("id", data.id).maybeSingle();
      const sisUrl = (cap?.raw_payload as any)?.sisUrl;
      if (sisUrl) {
        await admin.from("parts").update({ status: data.status }).eq("sis_url", sisUrl).eq("status", "pending");
      }
    }
    return { ok: true };
  });

const ImportRow = z.object({
  fleet: z.string().optional().nullable(),
  model: z.string().min(1),
  serial: z.string().min(1),
  system: z.string().min(1),
  subsystem: z.string().optional().nullable(),
  group: z.string().min(1),
  partNumber: z.string().min(1),
  description: z.string().optional().default(""),
  quantity: z.coerce.number().int().min(1).default(1),
  itemPosition: z.string().optional().nullable(),
});

export const importRows = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ rows: z.array(ImportRow).min(1).max(5000) }).parse(d),
  )
  .handler(async ({ data }) => {
    const admin = adminClient();
    let imported = 0;
    const errors: string[] = [];
    // cache lookups
    const fleetCache = new Map<string, string>();
    const machineCache = new Map<string, string>();
    const systemCache = new Map<string, string>();
    const groupCache = new Map<string, string>();

    for (const row of data.rows) {
      try {
        let fleetId: string | null = null;
        if (row.fleet) {
          fleetId = fleetCache.get(row.fleet) ?? null;
          if (!fleetId) {
            const { data: f } = await admin.from("fleets").select("id").eq("name", row.fleet).maybeSingle();
            if (f) fleetId = f.id;
            else {
              const { data: ins } = await admin.from("fleets").insert({ name: row.fleet }).select("id").single();
              fleetId = ins!.id;
            }
            fleetCache.set(row.fleet, fleetId!);
          }
        }
        let machineId = machineCache.get(row.serial);
        if (!machineId) {
          const { data: m } = await admin.from("machines").select("id").eq("serial_number", row.serial).maybeSingle();
          if (m) {
            machineId = m.id;
            await admin.from("machines").update({ model: row.model, fleet_id: fleetId }).eq("id", machineId);
          } else {
            const { data: ins } = await admin
              .from("machines")
              .insert({ serial_number: row.serial, model: row.model, fleet_id: fleetId })
              .select("id").single();
            machineId = ins!.id;
          }
          machineCache.set(row.serial, machineId!);
        }
        const sysKey = `${machineId}::${row.system}::${row.subsystem ?? ""}`;
        let systemId = systemCache.get(sysKey);
        if (!systemId) {
          const { data: rows } = await admin
            .from("systems").select("id, subsystem")
            .eq("machine_id", machineId).eq("name", row.system);
          const found = (rows ?? []).find((r: any) => (r.subsystem ?? null) === (row.subsystem ?? null));
          if (found) systemId = found.id;
          else {
            const { data: ins } = await admin
              .from("systems").insert({ machine_id: machineId, name: row.system, subsystem: row.subsystem ?? null })
              .select("id").single();
            systemId = ins!.id;
          }
          systemCache.set(sysKey, systemId!);
        }
        const grpKey = `${systemId}::${row.group}`;
        let groupId = groupCache.get(grpKey);
        if (!groupId) {
          const { data: g } = await admin
            .from("groups").select("id").eq("system_id", systemId).eq("name", row.group).maybeSingle();
          if (g) groupId = g.id;
          else {
            const { data: ins } = await admin
              .from("groups").insert({ system_id: systemId, name: row.group })
              .select("id").single();
            groupId = ins!.id;
          }
          groupCache.set(grpKey, groupId!);
        }
        const { error } = await admin
          .from("parts")
          .upsert({
            group_id: groupId,
            part_number: row.partNumber,
            description: row.description || row.partNumber,
            quantity: row.quantity,
            item_position: row.itemPosition ?? null,
            status: "pending",
            source: "csv",
          }, { onConflict: "group_id,part_number" });
        if (error) throw error;
        imported++;
      } catch (e: any) {
        errors.push(`${row.partNumber}: ${e.message}`);
      }
    }
    return { imported, errors };
  });
