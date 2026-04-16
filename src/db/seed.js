import 'dotenv/config';
import pg from 'pg';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function seed() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Clear existing data (in dependency order)
    await client.query('DELETE FROM receiving_log');
    await client.query('DELETE FROM scan_history');
    await client.query('DELETE FROM order_items');
    await client.query('DELETE FROM orders');
    await client.query('DELETE FROM cards');
    await client.query('DELETE FROM items');
    await client.query('DELETE FROM locations');
    await client.query('DELETE FROM suppliers');

    // Suppliers
    const suppliers = await client.query(`
      INSERT INTO suppliers (name, contact_name, email, phone, address, notes, avg_lead_time_days)
      VALUES
        ('Acme Fasteners', 'John Smith', 'orders@acmefasteners.com', '555-0101', '123 Industrial Blvd, Detroit MI', 'Primary fastener supplier', 5),
        ('Pacific Steel Co', 'Sarah Lee', 'sales@pacificsteel.com', '555-0202', '456 Harbor Dr, Long Beach CA', 'Steel and raw materials', 14),
        ('Global Electronics', 'Mike Chen', 'supply@globalelec.com', '555-0303', '789 Tech Park, San Jose CA', 'Electronic components and PCBs', 21)
      RETURNING id
    `);
    const [s1, s2, s3] = suppliers.rows;

    // Locations
    const fac = await client.query(`
      INSERT INTO locations (name, type, description)
      VALUES ('Main Plant', 'facility', 'Primary manufacturing facility')
      RETURNING id
    `);
    const facId = fac.rows[0].id;

    const areas = await client.query(`
      INSERT INTO locations (name, type, parent_id, description)
      VALUES
        ('Assembly Line A', 'area', $1, 'Main assembly area'),
        ('Assembly Line B', 'area', $1, 'Secondary assembly area'),
        ('Warehouse', 'area', $1, 'Raw materials warehouse')
      RETURNING id
    `, [facId]);
    const [areaA, areaB, warehouse] = areas.rows;

    const locs = await client.query(`
      INSERT INTO locations (name, type, parent_id, description)
      VALUES
        ('Rack A1', 'location', $1, 'First rack in Assembly A'),
        ('Rack A2', 'location', $1, 'Second rack in Assembly A'),
        ('Rack B1', 'location', $2, 'First rack in Assembly B'),
        ('Shelf W1', 'location', $3, 'Warehouse shelf 1'),
        ('Shelf W2', 'location', $3, 'Warehouse shelf 2')
      RETURNING id
    `, [areaA.id, areaB.id, warehouse.id]);
    const [rackA1, rackA2, rackB1, shelfW1, shelfW2] = locs.rows;

    // Items - using explicit location/supplier IDs
    const items = await client.query(`
      INSERT INTO items (part_number, name, description, unit_of_measure, supplier_id, cost_per_unit, location_id, reorder_point, reorder_quantity, container_quantity, lead_time_days, safety_factor, current_stock)
      VALUES
        ('FAS-M6-25', 'M6x25 Hex Bolt', 'Grade 8.8 zinc plated hex bolt', 'box', $1, 12.50, $4, 5, 20, 100, 5, 1.5, 15),
        ('FAS-M8-30', 'M8x30 Hex Bolt', 'Grade 8.8 zinc plated hex bolt', 'box', $1, 15.00, $4, 3, 15, 50, 5, 1.5, 8),
        ('FAS-NUT-M6', 'M6 Hex Nut', 'Grade 8 zinc plated hex nut', 'box', $1, 8.00, $5, 5, 25, 200, 5, 1.5, 20),
        ('STL-FLAT-3MM', '3mm Steel Flat Bar', '3mm x 30mm hot rolled flat bar', 'each', $2, 45.00, $7, 10, 30, 1, 14, 2.0, 12),
        ('STL-TUBE-25', '25mm Steel Tube', '25mm round structural tube', 'each', $2, 38.00, $7, 8, 20, 1, 14, 2.0, 5),
        ('STL-SHEET-2MM', '2mm Steel Sheet', '2mm x 1200 x 2400 mild steel sheet', 'each', $2, 95.00, $8, 5, 10, 1, 14, 1.5, 3),
        ('ELC-RES-10K', '10K Ohm Resistor', '1/4W through-hole resistor', 'box', $3, 5.50, $6, 10, 50, 1000, 21, 1.5, 25),
        ('ELC-CAP-100UF', '100uF Capacitor', 'Electrolytic capacitor 25V', 'box', $3, 18.00, $6, 5, 20, 500, 21, 1.5, 8),
        ('ELC-PCB-MAIN', 'Main PCB Board', 'Rev 3.2 main controller board', 'each', $3, 125.00, $6, 3, 10, 1, 21, 2.0, 2),
        ('FAS-WASH-M6', 'M6 Flat Washer', 'Zinc plated flat washer', 'box', $1, 6.00, $4, 5, 30, 200, 5, 1.5, 30)
      RETURNING id, part_number
    `, [s1.id, s2.id, s3.id, rackA1.id, rackA2.id, rackB1.id, shelfW1.id, shelfW2.id]);

    // Create 2-3 Kanban cards per item
    for (const item of items.rows) {
      const cardCount = item.part_number.startsWith('ELC-PCB') ? 3 : 2;
      for (let i = 1; i <= cardCount; i++) {
        await client.query(`
          INSERT INTO cards (item_id, loop_number, status, location_id)
          SELECT $1, $2, 'at_location', location_id FROM items WHERE id = $1
        `, [item.id, i]);
      }
    }

    // Create a sample order
    const orderNum = `PO-${new Date().toISOString().slice(0,10).replace(/-/g, '')}-0001`;
    const order = await client.query(`
      INSERT INTO orders (order_number, supplier_id, status, total_cost, notes, submitted_at, expected_delivery_date)
      VALUES ($1, $2, 'submitted', 240.00, 'Regular restock order', NOW() - INTERVAL '3 days', NOW() + INTERVAL '4 days')
      RETURNING id
    `, [orderNum, s1.id]);

    // Add order items
    const firstTwoItems = items.rows.slice(0, 2);
    for (const item of firstTwoItems) {
      await client.query(`
        INSERT INTO order_items (order_id, item_id, quantity, unit_cost)
        VALUES ($1, $2, 10, (SELECT cost_per_unit FROM items WHERE id = $2))
      `, [order.rows[0].id, item.id]);
    }

    await client.query('COMMIT');
    console.log('Seed data inserted successfully!');
    console.log(`- 3 suppliers`);
    console.log(`- 1 facility, 3 areas, 5 locations`);
    console.log(`- 10 items with 21 kanban cards`);
    console.log(`- 1 sample order`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Seed failed:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
