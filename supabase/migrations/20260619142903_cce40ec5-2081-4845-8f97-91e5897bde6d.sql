-- Fleets
CREATE TABLE public.fleets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  owner text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fleets TO authenticated;
GRANT SELECT ON public.fleets TO anon;
GRANT ALL ON public.fleets TO service_role;
ALTER TABLE public.fleets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read fleets" ON public.fleets FOR SELECT USING (true);

-- Machines: add fleet_id (already has family)
ALTER TABLE public.machines ADD COLUMN IF NOT EXISTS fleet_id uuid REFERENCES public.fleets(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS machines_serial_uidx ON public.machines(serial_number);

-- Systems uniqueness
CREATE UNIQUE INDEX IF NOT EXISTS systems_unique ON public.systems(machine_id, name, COALESCE(subsystem,''));

-- Groups
ALTER TABLE public.groups ADD COLUMN IF NOT EXISTS illustration_ref text;
CREATE UNIQUE INDEX IF NOT EXISTS groups_unique ON public.groups(system_id, name);

-- Diagrams
CREATE TABLE public.diagrams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  image_url text,
  sis_url text,
  captured_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.diagrams TO authenticated;
GRANT SELECT ON public.diagrams TO anon;
GRANT ALL ON public.diagrams TO service_role;
ALTER TABLE public.diagrams ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read diagrams" ON public.diagrams FOR SELECT USING (true);

-- Parts: add diagram_id, item_position, status, source
ALTER TABLE public.parts ADD COLUMN IF NOT EXISTS diagram_id uuid REFERENCES public.diagrams(id) ON DELETE SET NULL;
ALTER TABLE public.parts ADD COLUMN IF NOT EXISTS item_position text;
ALTER TABLE public.parts ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'approved';
ALTER TABLE public.parts ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual';
CREATE INDEX IF NOT EXISTS parts_status_idx ON public.parts(status);
CREATE INDEX IF NOT EXISTS parts_pn_idx ON public.parts(part_number);

-- Captures
CREATE TABLE public.captures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
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
  captured_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by text
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.captures TO authenticated;
GRANT SELECT ON public.captures TO anon;
GRANT ALL ON public.captures TO service_role;
ALTER TABLE public.captures ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read captures" ON public.captures FOR SELECT USING (true);
CREATE INDEX IF NOT EXISTS captures_status_idx ON public.captures(status);

-- Allow public anon writes to aliases? No. Aliases stays read-only.

-- Add unique constraint on parts (part_number, group_id) to allow upsert
CREATE UNIQUE INDEX IF NOT EXISTS parts_unique ON public.parts(group_id, part_number);