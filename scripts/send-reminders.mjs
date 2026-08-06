import fs from 'node:fs/promises';
import nodemailer from 'nodemailer';

const DATA_FILE = new URL('../data/properties.json', import.meta.url);
const DAYS_BEFORE = Number(process.env.ALERT_DAYS_BEFORE || 3);
const SEND_TEST = process.env.ALERT_SEND_TEST === 'true';
const fallbackRecipient = 'FPARDO1996@GMAIL.COM';

const data = JSON.parse(await fs.readFile(DATA_FILE, 'utf8'));
const today = todayInChile();
let alerts = data.mortgages.map((mortgage) => {
  const dueDate = nextDueDate(mortgage, today);
  const property = data.properties.find((item) => item.id === mortgage.propertyId) || {};
  return { mortgage, property, dueDate, daysLeft: daysBetween(today, dueDate) };
}).filter((item) => item.daysLeft === DAYS_BEFORE);

if (SEND_TEST && !alerts.length) {
  alerts = data.mortgages.map((mortgage) => {
    const dueDate = nextDueDate(mortgage, today);
    const property = data.properties.find((item) => item.id === mortgage.propertyId) || {};
    return { mortgage, property, dueDate, daysLeft: daysBetween(today, dueDate) };
  }).sort((a, b) => a.daysLeft - b.daysLeft).slice(0, 2);
}

if (!alerts.length) {
  console.log(`Sin alertas para ${today.toISOString().slice(0, 10)}.`);
  process.exit(0);
}

const required = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS'];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) {
  throw new Error(`Faltan secretos para enviar correo: ${missing.join(', ')}`);
}

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 465),
  secure: Number(process.env.SMTP_PORT || 465) === 465,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
});

const to = process.env.ALERT_TO || data.ownerEmail || fallbackRecipient;
const subject = SEND_TEST ? 'Prueba de alertas hipotecarias' : `Alerta dividendo hipotecario: vence en ${DAYS_BEFORE} dias`;
const html = buildEmail(alerts);
await transporter.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to, subject, html });
console.log(`Alerta enviada a ${to}.`);

function todayInChile() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const get = (type) => Number(parts.find((part) => part.type === type).value);
  return new Date(get('year'), get('month') - 1, get('day'));
}

function parseDate(value) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function addMonths(date, months) {
  const copy = new Date(date);
  copy.setMonth(copy.getMonth() + months);
  return copy;
}

function nextDueDate(mortgage, from) {
  let due = parseDate(mortgage.firstDueDate);
  while (due < from) due = addMonths(due, 1);
  return due;
}

function daysBetween(a, b) {
  return Math.round((b - a) / 86400000);
}

function buildEmail(alerts) {
  const rows = alerts.map(({ mortgage, property, dueDate }) => {
    const amount = mortgage.referenceDividendClp ? `$${Number(mortgage.referenceDividendClp).toLocaleString('es-CL')}` : `${Number(mortgage.referenceDividendUf || 0).toLocaleString('es-CL')} UF`;
    return `<tr><td>${property.unit || mortgage.propertyId}</td><td>${property.address || ''}</td><td>${mortgage.bank}</td><td>${mortgage.operation}</td><td>${dueDate.toLocaleDateString('es-CL')}</td><td>${amount}</td></tr>`;
  }).join('');
  return `<div style="font-family:Arial,sans-serif;color:#1e293b"><h2>Dividendos hipotecarios por vencer</h2><p>Estos pagos vencen en ${DAYS_BEFORE} dias.</p><table cellpadding="8" cellspacing="0" style="border-collapse:collapse;border:1px solid #d7dee8"><thead><tr style="background:#e8f1f8"><th>Depto</th><th>Direccion</th><th>Banco</th><th>Operacion</th><th>Vence</th><th>Monto ref.</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}
