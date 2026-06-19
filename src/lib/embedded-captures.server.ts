import { PGlite } from "@electric-sql/pglite";
import { mkdirSync } from "node:fs";

import type { CapturePayload } from "./capture-api.server";

export type EmbeddedBasePart = {
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
  captured_at: string;
  capture_id: string | null;
};

declare global {
  var __catSmartPartsPGlite: PGlite | undefined;
  var __catSmartPartsPGliteReady: Promise<void> | undefined;
}

function database() {
  mkdirSync(".data", { recursive: true });
  globalThis.__catSmartPartsPGlite ??= new PGlite(".data/cat-smart-parts");
  const db = globalThis.__catSmartPartsPGlite;
  globalThis.__catSmartPartsPGliteReady = db
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
      status text NOT NULL DEFAULT 'pending',
      capture_id text,
      captured_at timestamptz NOT NULL DEFAULT now(),
      base_key text UNIQUE,
      UNIQUE (machine_id, system_name, group_name, part_number)
    );
    ALTER TABLE local_parts ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'sis-extension';
    ALTER TABLE local_parts ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending';
    ALTER TABLE local_parts ADD COLUMN IF NOT EXISTS capture_id text;
    ALTER TABLE local_parts ADD COLUMN IF NOT EXISTS captured_at timestamptz NOT NULL DEFAULT now();
    ALTER TABLE local_parts ADD COLUMN IF NOT EXISTS base_key text;
    CREATE UNIQUE INDEX IF NOT EXISTS local_parts_base_key_idx ON local_parts (base_key);
    UPDATE local_captures
      SET serial_number = substring(sis_url from 'serialNumber=([^&]+)')
      WHERE (serial_number IS NULL OR serial_number = '' OR upper(serial_number) = 'NUMBER')
        AND sis_url LIKE '%serialNumber=%';
    UPDATE local_machines AS m
      SET serial_number = c.serial_number
      FROM local_captures AS c
      WHERE upper(m.serial_number) = 'NUMBER'
        AND c.serial_number IS NOT NULL
        AND c.serial_number <> ''
        AND c.sis_url LIKE '%serialNumber=%'
        AND NOT EXISTS (
          SELECT 1 FROM local_machines existing WHERE existing.serial_number = c.serial_number
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
  let inserted = 0;
  let updated = 0;

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
      const normalizedPartNumber = part.partNumber.toUpperCase();
      const itemPosition = part.position || "";
      const baseKey = [
        normalizedPartNumber,
        serialNumber,
        payload.group || "Grupo não informado",
        payload.system || "Sistema não informado",
        itemPosition,
      ].join("|");
      const existing = await tx.query<{ id: string }>(
        "SELECT id FROM local_parts WHERE base_key = $1 OR (machine_id = $2 AND system_name = $3 AND group_name = $4 AND part_number = $5 AND COALESCE(item_position, '') = $6)",
        [
          baseKey,
          resolvedMachineId,
          payload.system || "Sistema não informado",
          payload.group || "Grupo não informado",
          normalizedPartNumber,
          itemPosition,
        ],
      );
      if (existing.rows[0]?.id) updated += 1;
      else inserted += 1;

      await tx.query(
        `INSERT INTO local_parts (
          id, machine_id, system_name, subsystem, group_name, part_number,
          description, quantity, image_url, sis_url, item_position, source,
          status, capture_id, captured_at, base_key
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'sis-extension','pending',$12,$13,$14)
        ON CONFLICT (machine_id, system_name, group_name, part_number) DO UPDATE SET
          description = EXCLUDED.description, quantity = EXCLUDED.quantity,
          image_url = EXCLUDED.image_url, sis_url = EXCLUDED.sis_url,
          item_position = EXCLUDED.item_position, source = EXCLUDED.source,
          capture_id = EXCLUDED.capture_id, captured_at = EXCLUDED.captured_at,
          base_key = EXCLUDED.base_key`,
        [
          crypto.randomUUID(),
          resolvedMachineId,
          payload.system || "Sistema não informado",
          payload.subsystem || null,
          payload.group || "Grupo não informado",
          normalizedPartNumber,
          part.description || part.partNumber,
          part.quantity,
          part.imageUrl || null,
          part.url || payload.url || null,
          part.position || null,
          captureId,
          capturedAt,
          baseKey,
        ],
      );
    }
  });

  console.info("[CAT Collector] PGlite capture saved", {
    captureId,
    receivedParts: payload.parts.length,
    normalizedParts: payload.parts.length,
    insertedParts: inserted,
    updatedParts: updated,
  });
  return { captureId, savedParts: payload.parts.length, insertedParts: inserted, updatedParts: updated };
}

export async function listEmbeddedCaptures() {
  const { db, ready } = database();
  await ready;
  const result = await db.query<{
    id: string;
    sisUrl: string | null;
    serialNumber: string | null;
    model: string | null;
    systemName: string | null;
    subsystem: string | null;
    groupName: string | null;
    imageUrl: string | null;
    itemsCount: number;
    status: string;
    capturedAt: string;
    rawPayload: CapturePayload;
  }>(`
    SELECT id, sis_url AS "sisUrl", serial_number AS "serialNumber", model,
      system_name AS "systemName", subsystem, group_name AS "groupName",
      image_url AS "imageUrl", items_count AS "itemsCount", status,
      captured_at AS "capturedAt", raw_payload AS "rawPayload"
    FROM local_captures
    ORDER BY captured_at DESC
    LIMIT 200
  `);
  return result.rows.map((capture) => {
    let rawPayload = capture.rawPayload;
    if (typeof capture.rawPayload === "string") {
      try {
        rawPayload = JSON.parse(capture.rawPayload);
      } catch {
        rawPayload = { parts: [] } as CapturePayload;
      }
    }
    return {
      ...capture,
      rawPayload,
      parts: rawPayload?.parts ?? [],
    };
  });
}

export async function listEmbeddedBaseParts(): Promise<EmbeddedBasePart[]> {
  const { db, ready } = database();
  await ready;
  const result = await db.query<EmbeddedBasePart>(`
    SELECT
      p.id,
      p.part_number,
      p.description,
      p.quantity,
      p.item_position,
      p.image_url,
      p.sis_url,
      p.status,
      p.source,
      p.group_name,
      p.system_name,
      p.subsystem,
      m.model,
      m.serial_number,
      null::text AS fleet_name,
      p.captured_at,
      p.capture_id
    FROM local_parts p
    JOIN local_machines m ON m.id = p.machine_id
    ORDER BY p.captured_at DESC
    LIMIT 1000
  `);
  return result.rows;
}

export async function updateEmbeddedPartStatus(id: string, status: "approved" | "rejected" | "pending") {
  const { db, ready } = database();
  await ready;
  await db.query("UPDATE local_parts SET status = $2 WHERE id = $1", [id, status]);
  return { ok: true };
}

export async function deleteEmbeddedPart(id: string) {
  const { db, ready } = database();
  await ready;
  await db.query("DELETE FROM local_parts WHERE id = $1", [id]);
  return { ok: true };
}

export async function updateEmbeddedCaptureStatus(id: string, status: "received" | "imported" | "approved" | "rejected" | "pending") {
  const { db, ready } = database();
  await ready;
  await db.transaction(async (tx) => {
    await tx.query("UPDATE local_captures SET status = $2 WHERE id = $1", [id, status]);
    if (status === "approved" || status === "rejected" || status === "pending") {
      await tx.query("UPDATE local_parts SET status = $2 WHERE capture_id = $1", [id, status]);
    }
  });
  return { ok: true };
}

export async function deleteEmbeddedCapture(id: string) {
  const { db, ready } = database();
  await ready;
  await db.transaction(async (tx) => {
    await tx.query("DELETE FROM local_parts WHERE capture_id = $1", [id]);
    await tx.query("DELETE FROM local_captures WHERE id = $1", [id]);
  });
  return { ok: true };
}
