import { PGlite } from "@electric-sql/pglite";
import { mkdirSync } from "node:fs";

import type { CapturePayload } from "./capture-api.server";

declare global {
  var __catSmartPartsPGlite: PGlite | undefined;
  var __catSmartPartsPGliteReady: Promise<void> | undefined;
}

function database() {
  mkdirSync(".data", { recursive: true });
  globalThis.__catSmartPartsPGlite ??= new PGlite(".data/cat-smart-parts");
  const db = globalThis.__catSmartPartsPGlite;
  globalThis.__catSmartPartsPGliteReady ??= db
    .exec(
      `
    CREATE TABLE IF NOT EXISTS local_captures (
      id text PRIMARY KEY,
      sis_url text,
      serial_number text,
      model text,
      system_name text,
      subsystem text,
      group_name text,
      image_url text,
      items_count integer NOT NULL DEFAULT 0,
      raw_payload jsonb NOT NULL,
      status text NOT NULL DEFAULT 'pending',
      captured_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS local_machines (
      id text PRIMARY KEY,
      serial_number text NOT NULL UNIQUE,
      model text NOT NULL
    );
    CREATE TABLE IF NOT EXISTS local_parts (
      id text PRIMARY KEY,
      machine_id text NOT NULL REFERENCES local_machines(id),
      system_name text NOT NULL,
      subsystem text,
      group_name text NOT NULL,
      part_number text NOT NULL,
      description text NOT NULL,
      quantity integer NOT NULL DEFAULT 1,
      image_url text,
      sis_url text,
      item_position text,
      source text NOT NULL DEFAULT 'sis-extension',
      UNIQUE (machine_id, system_name, group_name, part_number)
    );
  `,
    )
    .then(() => undefined);
  return { db, ready: globalThis.__catSmartPartsPGliteReady };
}

export async function saveEmbeddedCapture(payload: CapturePayload) {
  const { db, ready } = database();
  await ready;
  const captureId = crypto.randomUUID();
  const machineId = crypto.randomUUID();
  const serialNumber = payload.serialNumber || `SEM-SERIAL-${captureId}`;
  const capturedAt = payload.capturedAt ?? new Date().toISOString();

  await db.transaction(async (tx) => {
    await tx.query(
      `INSERT INTO local_captures (
        id, sis_url, serial_number, model, system_name, subsystem, group_name,
        items_count, raw_payload, status, captured_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,'pending',$10)`,
      [
        captureId,
        payload.url || null,
        payload.serialNumber || null,
        payload.machineModel || null,
        payload.system || null,
        payload.subsystem || null,
        payload.group || null,
        payload.parts.length,
        JSON.stringify(payload),
        capturedAt,
      ],
    );

    const existing = await tx.query<{ id: string }>(
      "SELECT id FROM local_machines WHERE serial_number = $1",
      [serialNumber],
    );
    const resolvedMachineId = existing.rows[0]?.id ?? machineId;
    await tx.query(
      `INSERT INTO local_machines (id, serial_number, model) VALUES ($1,$2,$3)
       ON CONFLICT (serial_number) DO UPDATE SET model = EXCLUDED.model`,
      [resolvedMachineId, serialNumber, payload.machineModel || "Modelo não informado"],
    );

    for (const part of payload.parts) {
      await tx.query(
        `INSERT INTO local_parts (
          id, machine_id, system_name, subsystem, group_name, part_number,
          description, quantity, image_url, sis_url, item_position
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        ON CONFLICT (machine_id, system_name, group_name, part_number) DO UPDATE SET
          description = EXCLUDED.description, quantity = EXCLUDED.quantity,
          image_url = EXCLUDED.image_url, sis_url = EXCLUDED.sis_url,
          item_position = EXCLUDED.item_position`,
        [
          crypto.randomUUID(),
          resolvedMachineId,
          payload.system || "Sistema não informado",
          payload.subsystem || null,
          payload.group || "Grupo não informado",
          part.partNumber.toUpperCase(),
          part.description || part.partNumber,
          part.quantity,
          part.imageUrl || null,
          part.url || payload.url || null,
          part.position || null,
        ],
      );
    }
  });

  return { captureId, savedParts: payload.parts.length };
}

export async function listEmbeddedCaptures() {
  const { db, ready } = database();
  await ready;
  const result = await db.query(`
    SELECT id, sis_url AS "sisUrl", serial_number AS "serialNumber", model,
      system_name AS "systemName", subsystem, group_name AS "groupName",
      image_url AS "imageUrl", items_count AS "itemsCount", status,
      captured_at AS "capturedAt"
    FROM local_captures
    ORDER BY captured_at DESC
    LIMIT 200
  `);
  return result.rows;
}
