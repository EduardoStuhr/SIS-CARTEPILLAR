
-- Catalog tables (publicly readable)
CREATE TABLE public.machines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  serial_number text NOT NULL,
  model text NOT NULL,
  family text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.systems (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  machine_id uuid NOT NULL REFERENCES public.machines(id) ON DELETE CASCADE,
  name text NOT NULL,
  subsystem text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  system_id uuid NOT NULL REFERENCES public.systems(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.parts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  part_number text NOT NULL,
  description text NOT NULL,
  quantity integer NOT NULL DEFAULT 1,
  image_url text,
  sis_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX parts_part_number_idx ON public.parts (part_number);

CREATE TABLE public.aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  part_id uuid NOT NULL REFERENCES public.parts(id) ON DELETE CASCADE,
  keyword text NOT NULL
);
CREATE INDEX aliases_keyword_idx ON public.aliases (keyword);

-- Grants
GRANT SELECT ON public.machines TO anon, authenticated;
GRANT SELECT ON public.systems  TO anon, authenticated;
GRANT SELECT ON public.groups   TO anon, authenticated;
GRANT SELECT ON public.parts    TO anon, authenticated;
GRANT SELECT ON public.aliases  TO anon, authenticated;
GRANT ALL ON public.machines, public.systems, public.groups, public.parts, public.aliases TO service_role;

-- RLS
ALTER TABLE public.machines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.systems  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.groups   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parts    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aliases  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read machines" ON public.machines FOR SELECT USING (true);
CREATE POLICY "public read systems"  ON public.systems  FOR SELECT USING (true);
CREATE POLICY "public read groups"   ON public.groups   FOR SELECT USING (true);
CREATE POLICY "public read parts"    ON public.parts    FOR SELECT USING (true);
CREATE POLICY "public read aliases"  ON public.aliases  FOR SELECT USING (true);
