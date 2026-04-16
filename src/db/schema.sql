-- App tables (better-auth tables are created by `npx better-auth migrate`)

-- Extend better-auth user table with role
DO $$ BEGIN
  ALTER TABLE "user" ADD COLUMN role TEXT NOT NULL DEFAULT 'user';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Suppliers
CREATE TABLE IF NOT EXISTS suppliers (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  contact_name TEXT,
  email TEXT,
  phone TEXT,
  address TEXT,
  notes TEXT,
  avg_lead_time_days REAL,
  reliability_score REAL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Locations: 3-tier hierarchy (facility > area > location)
CREATE TABLE IF NOT EXISTS locations (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('facility', 'area', 'location')),
  parent_id INTEGER REFERENCES locations(id) ON DELETE CASCADE,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Items (materials/parts being tracked)
CREATE TABLE IF NOT EXISTS items (
  id SERIAL PRIMARY KEY,
  part_number TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  unit_of_measure TEXT NOT NULL DEFAULT 'each',
  supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  cost_per_unit REAL,
  location_id INTEGER REFERENCES locations(id) ON DELETE SET NULL,
  reorder_point INTEGER NOT NULL,
  reorder_quantity INTEGER NOT NULL,
  container_quantity INTEGER NOT NULL DEFAULT 1,
  lead_time_days INTEGER NOT NULL DEFAULT 1,
  safety_factor REAL NOT NULL DEFAULT 1.5,
  current_stock INTEGER NOT NULL DEFAULT 0,
  num_kanban_cards INTEGER,
  label_color TEXT NOT NULL DEFAULT '#ffffff',
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Kanban cards
CREATE TABLE IF NOT EXISTS cards (
  id SERIAL PRIMARY KEY,
  card_uid UUID UNIQUE NOT NULL DEFAULT gen_random_uuid(),
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  loop_number INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'at_location'
    CHECK (status IN ('at_location', 'in_queue', 'ordered', 'in_transit', 'received')),
  location_id INTEGER REFERENCES locations(id) ON DELETE SET NULL,
  qr_data_url TEXT,
  last_scanned_at TIMESTAMPTZ,
  last_scanned_by TEXT REFERENCES "user"(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Purchase orders
CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY,
  order_number TEXT UNIQUE NOT NULL,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'submitted', 'confirmed', 'shipped', 'received', 'cancelled')),
  total_cost REAL,
  notes TEXT,
  submitted_at TIMESTAMPTZ,
  expected_delivery_date DATE,
  received_at TIMESTAMPTZ,
  created_by TEXT REFERENCES "user"(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Order line items
CREATE TABLE IF NOT EXISTS order_items (
  id SERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES items(id),
  card_id INTEGER REFERENCES cards(id),
  quantity INTEGER NOT NULL,
  unit_cost REAL,
  received_quantity INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Scan history (append-only audit log)
CREATE TABLE IF NOT EXISTS scan_history (
  id SERIAL PRIMARY KEY,
  card_id INTEGER NOT NULL REFERENCES cards(id),
  scanned_by TEXT REFERENCES "user"(id),
  action TEXT NOT NULL CHECK (action IN ('pull', 'receive', 'putaway', 'audit')),
  previous_status TEXT,
  new_status TEXT,
  location_id INTEGER REFERENCES locations(id),
  notes TEXT,
  scanned_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Receiving log
CREATE TABLE IF NOT EXISTS receiving_log (
  id SERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  order_item_id INTEGER NOT NULL REFERENCES order_items(id),
  quantity_received INTEGER NOT NULL,
  location_id INTEGER REFERENCES locations(id),
  received_by TEXT REFERENCES "user"(id),
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes TEXT
);

-- App settings (key-value store)
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Insert default app URL if not exists
INSERT INTO app_settings (key, value) VALUES ('app_url', 'http://localhost:3000')
ON CONFLICT (key) DO NOTHING;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_cards_item_id ON cards(item_id);
CREATE INDEX IF NOT EXISTS idx_cards_status ON cards(status);
CREATE INDEX IF NOT EXISTS idx_cards_card_uid ON cards(card_uid);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_supplier_id ON orders(supplier_id);
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_scan_history_card_id ON scan_history(card_id);
CREATE INDEX IF NOT EXISTS idx_scan_history_scanned_at ON scan_history(scanned_at);
CREATE INDEX IF NOT EXISTS idx_items_supplier_id ON items(supplier_id);
CREATE INDEX IF NOT EXISTS idx_items_part_number ON items(part_number);
CREATE INDEX IF NOT EXISTS idx_locations_parent_id ON locations(parent_id);
