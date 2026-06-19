import { config } from "dotenv";
import { readFileSync } from "node:fs";
import postgres from "postgres";
import { z } from "zod";

import { listEmbeddedCaptures, saveEmbeddedCapture } from "./embedded-captures.server";

const localEnv = config({ processEnv: {}, quiet: true }).parsed ?? {};
if (import.meta.env.DEV) {
  try {
    const rawCollectorKey = readFileSync(".env", "utf8")
      .match(/^CAT_COLLECTOR_KEY=(.*)$/m)?.[1]
      .trim();
    if (rawCollectorKey) {
      localEnv.CAT_COLLECTOR_KEY = rawCollectorKey.replace(/^(['"])(.*)\1$/, "$2");
    }
  } catch {
    // A variável de ambiente continua sendo o fallback quando não há .env local.
  }
}
const serverEnv: Record<string, string | undefined> = import.meta.env.DEV ? localEnv : process.env;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const partSchema = z.object({
  partNumber: z.string().trim().min(1).max(200),
  description: z.string().trim().max(500).optional().default(""),
  quantity: z.coerce.number().int().min(1).max(9999).optional().default(1),
  position: z.string().trim().max(80).optional().default(""),
  imageUrl: z.string().trim().max(2048).optional().default(""),
  url: z.string().trim().max(2048).optional().default(""),
});

export const captureSchema = z.object({
  machineModel: z.string().trim().max(120).optional().default(""),
  serialNumber: z.string().trim().max(120).optional().default(""),
  system: z.string().trim().max(240).optional().default(""),
  subsystem: z.string().trim().max(240).optional().default(""),
  group: z.string().trim().max(240).optional().default(""),
  capturedAt: z.string().datetime().optional(),
  url: z.string().trim().max(2048).optional().default(""),
  parts: z.array(partSchema).min(1).max(2000),
});

export type CapturePayload = z.infer<typeof captureSchema>;

declare global {
  var __catSmartPartsSql: ReturnType<typeof postgres> | undefined;
}

function getDatabase() {
  const databaseUrl = serverEnv.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL não está configurada.");

  globalThis.__catSmartPartsSql ??= postgres(databaseUrl, {
    max: 5,
    prepare: false,
    ssl: "require",
  });
  return globalThis.__catSmartPartsSql;
}

function usesEmbeddedDatabase() {
  try {
    const hostname = new URL(serverEnv.DATABASE_URL ?? "").hostname;
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  } catch {
    return false;
  }
}

export function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  for (const [name, value] of Object.entries(corsHeaders)) headers.set(name, value);
  return Response.json(data, { ...init, headers });
}

export function optionsResponse() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export function authorizeCollector(request: Request) {
  const collectorKey = serverEnv.CAT_COLLECTOR_KEY;
  if (!collectorKey) return false;
  return request.headers.get("authorization") === `Bearer ${collectorKey}`;
}

export async function saveCapture(payload: CapturePayload) {
  if (usesEmbeddedDatabase()) return saveEmbeddedCapture(payload);
  const sql = getDatabase();

  return sql.begin(async (tx) => {
    const capturedAt = payload.capturedAt ?? new Date().toISOString();
    const [capture] = await tx`
      INSERT INTO captures (
        sis_url, serial_number, model, system_name, subsystem, group_name,
        image_url, items_count, raw_payload, status, captured_at
      ) VALUES (
        ${payload.url || null}, ${payload.serialNumber || null},
        ${payload.machineModel || null}, ${payload.system || null},
        ${payload.subsystem || null}, ${payload.group || null}, null,
        ${payload.parts.length}, ${tx.json(payload)}, 'pending', ${capturedAt}
      )
      RETURNING id
    `;

    const serialNumber = payload.serialNumber || `SEM-SERIAL-${capture.id}`;
    const [machine] = await tx`
      INSERT INTO machines (serial_number, model)
      VALUES (${serialNumber}, ${payload.machineModel || "Modelo não informado"})
      ON CONFLICT (serial_number) DO UPDATE
      SET model = EXCLUDED.model
      RETURNING id
    `;

    const [system] = await tx`
      INSERT INTO systems (machine_id, name, subsystem)
      VALUES (${machine.id}, ${payload.system || "Sistema não informado"}, ${payload.subsystem || null})
      ON CONFLICT (machine_id, name, COALESCE(subsystem, '')) DO UPDATE
      SET name = EXCLUDED.name
      RETURNING id
    `;

    const [group] = await tx`
      INSERT INTO groups (system_id, name)
      VALUES (${system.id}, ${payload.group || "Grupo não informado"})
      ON CONFLICT (system_id, name) DO UPDATE
      SET name = EXCLUDED.name
      RETURNING id
    `;

    for (const part of payload.parts) {
      await tx`
        INSERT INTO parts (
          group_id, part_number, description, quantity, image_url, sis_url,
          item_position, status, source
        ) VALUES (
          ${group.id}, ${part.partNumber.toUpperCase()},
          ${part.description || part.partNumber}, ${part.quantity},
          ${part.imageUrl || null}, ${part.url || payload.url || null},
          ${part.position || null}, 'pending', 'sis-extension'
        )
        ON CONFLICT (group_id, part_number) DO UPDATE SET
          description = EXCLUDED.description,
          quantity = EXCLUDED.quantity,
          image_url = EXCLUDED.image_url,
          sis_url = EXCLUDED.sis_url,
          item_position = EXCLUDED.item_position,
          source = EXCLUDED.source
      `;
    }

    return { captureId: capture.id as string, savedParts: payload.parts.length };
  });
}

export async function listCaptures() {
  if (usesEmbeddedDatabase()) return listEmbeddedCaptures();
  const sql = getDatabase();
  return sql`
    SELECT
      id, sis_url AS "sisUrl", serial_number AS "serialNumber", model,
      system_name AS "systemName", subsystem, group_name AS "groupName",
      image_url AS "imageUrl", items_count AS "itemsCount", status,
      captured_at AS "capturedAt"
    FROM captures
    ORDER BY captured_at DESC
    LIMIT 200
  `;
}
