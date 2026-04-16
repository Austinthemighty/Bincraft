import { parse } from 'csv-parse/sync';

export function parseItemsCsv(buffer) {
  const records = parse(buffer, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  return records.map(row => ({
    part_number: row.part_number || row['Part Number'] || row.PartNumber,
    name: row.name || row.Name || row['Item Name'],
    description: row.description || row.Description || '',
    unit_of_measure: row.unit_of_measure || row.UOM || row['Unit'] || 'each',
    cost_per_unit: parseFloat(row.cost_per_unit || row.Cost || row.Price || 0) || null,
    reorder_point: parseInt(row.reorder_point || row['Reorder Point'] || row.ROP || 10),
    reorder_quantity: parseInt(row.reorder_quantity || row['Reorder Qty'] || row.ROQ || 10),
    container_quantity: parseInt(row.container_quantity || row['Container Qty'] || 1),
    lead_time_days: parseInt(row.lead_time_days || row['Lead Time'] || 1),
  }));
}
