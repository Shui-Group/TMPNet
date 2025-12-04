-- MemPPI-Atlas Row Level Security
-- Enable RLS and create policies for public read access

-- Enable RLS on tables
ALTER TABLE nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE edges ENABLE ROW LEVEL SECURITY;

-- Create policies for public read access (anon users can SELECT)
CREATE POLICY "Allow public read access on nodes"
  ON nodes FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "Allow public read access on edges"
  ON edges FOR SELECT
  TO anon
  USING (true);

-- Allow authenticated users full access (optional, for admin)
CREATE POLICY "Allow authenticated full access on nodes"
  ON nodes FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow authenticated full access on edges"
  ON edges FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);
