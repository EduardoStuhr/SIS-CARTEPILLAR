import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  listBaseParts,
  removeCapture,
  removePart,
  saveCapture,
  setCaptureStatus,
  setPartStatus,
  type BasePartRow,
  type CaptureStatus,
  type ReviewStatus,
} from "./capture-api.server";

export type BaseRow = BasePartRow;

export const listBase = createServerFn({ method: "GET" }).handler(async () => {
  return { rows: await listBaseParts() };
});

export const reviewPart = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({
      id: z.string().min(1),
      status: z.enum(["approved", "rejected", "pending"]),
    }).parse(d),
  )
  .handler(async ({ data }) => {
    return setPartStatus(data.id, data.status as ReviewStatus);
  });

export const deletePart = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ id: z.string().min(1) }).parse(d))
  .handler(async ({ data }) => removePart(data.id));

export const reviewCapture = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({
      id: z.string().min(1),
      status: z.enum(["received", "imported", "approved", "rejected", "pending"]),
    }).parse(d),
  )
  .handler(async ({ data }) => setCaptureStatus(data.id, data.status as CaptureStatus));

export const deleteCapture = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ id: z.string().min(1) }).parse(d))
  .handler(async ({ data }) => removeCapture(data.id));

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
    const groups = new Map<string, z.infer<typeof ImportRow>[]>();
    for (const row of data.rows) {
      const key = [
        row.model,
        row.serial,
        row.system,
        row.subsystem ?? "",
        row.group,
      ].join("|");
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }

    let imported = 0;
    const errors: string[] = [];
    for (const rows of groups.values()) {
      const first = rows[0];
      try {
        const result = await saveCapture({
          machineModel: first.model,
          serialNumber: first.serial,
          system: first.system,
          subsystem: first.subsystem ?? "",
          group: first.group,
          capturedAt: new Date().toISOString(),
          url: "",
          parts: rows.map((row) => ({
            partNumber: row.partNumber,
            description: row.description || row.partNumber,
            quantity: row.quantity,
            position: row.itemPosition ?? "",
            imageUrl: "",
            url: "",
          })),
        });
        imported += result.savedParts;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Falha ao importar grupo.";
        errors.push(`${first.model}/${first.serial}/${first.group}: ${message}`);
      }
    }

    return { imported, errors };
  });
