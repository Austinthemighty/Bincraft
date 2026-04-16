import nodemailer from 'nodemailer';

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  if (!process.env.SMTP_HOST) return null;
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587'),
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
  return transporter;
}

export async function sendOrderEmail(supplier, order, orderItems) {
  const t = getTransporter();
  if (!t || !supplier.email) return false;

  const itemLines = orderItems.map(oi =>
    `- ${oi.part_number}: ${oi.item_name} x ${oi.quantity} ${oi.unit_of_measure}`
  ).join('\n');

  await t.sendMail({
    from: process.env.SMTP_FROM || 'noreply@bincraft.local',
    to: supplier.email,
    subject: `Purchase Order ${order.order_number}`,
    text: `Dear ${supplier.contact_name || supplier.name},\n\nPlease find our purchase order below:\n\nOrder: ${order.order_number}\nDate: ${new Date().toLocaleDateString()}\n\nItems:\n${itemLines}\n\nPlease confirm receipt of this order.\n\nThank you.`,
  });
  return true;
}
