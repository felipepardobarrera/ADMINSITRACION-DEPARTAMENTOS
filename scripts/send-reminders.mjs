import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA_FILE = new URL('../data/properties.json', import.meta.url);
const DEFAULT_SUPABASE_URL = 'https://hkvfqmzvuuseshroacqb.supabase.co';
const DEFAULT_SUPABASE_KEY = 'sb_publishable_r7Nu9wLPFlG_pa4h0ig2jw_nKunjdXq';
const fallbackRecipient = 'FPARDO1996@GMAIL.COM';

export async function main() {
  const { default: nodemailer } = await import('nodemailer');
  const daysBefore = Number(process.env.ALERT_DAYS_BEFORE || 3);
  const sendTest = process.env.ALERT_SEND_TEST === 'true';
  const data = await loadPortfolioState();
  const today = todayInChile();
  let alerts = buildAlerts(data, today).filter((item) => item.daysLeft === daysBefore);

  if (sendTest && !alerts.length) alerts = buildAlerts(data, today).sort((a, b) => a.daysLeft - b.daysLeft).slice(0, 2);
  if (!alerts.length) {
    console.log(`Sin alertas para ${formatIsoDate(today)}.`);
    return;
  }

  const smtpHost = process.env.SMTP_HOST || 'smtp.gmail.com';
  const smtpPort = Number(process.env.SMTP_PORT || 465);
  const smtpUser = process.env.SMTP_USER || fallbackRecipient;
  const smtpPass = String(process.env.SMTP_PASS || '').replace(/\s/g, '');
  if (!smtpPass) throw new Error('Falta configurar el secreto SMTP_PASS con una contraseña de aplicación de Gmail.');

  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpPort === 465,
    auth: { user: smtpUser, pass: smtpPass },
  });

  const to = process.env.ALERT_TO || data.ownerEmail || fallbackRecipient;
  const subject = sendTest ? 'Prueba de alertas hipotecarias' : `Alerta dividendo hipotecario: vence en ${daysBefore} días`;
  await transporter.sendMail({ from: process.env.SMTP_FROM || smtpUser, to, subject, html: buildEmail(alerts, daysBefore) });
  console.log(`Alerta enviada a ${to} usando los datos actuales.`);
}

export async function loadPortfolioState() {
  const supabaseUrl = process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL;
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY || DEFAULT_SUPABASE_KEY;
  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/portfolio_state?id=eq.main&select=data`, {
      headers: { apikey: publishableKey, Authorization: `Bearer ${publishableKey}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error(`Supabase respondió ${response.status}`);
    const rows = await response.json();
    if (!rows[0]?.data?.mortgages || !rows[0]?.data?.properties) throw new Error('Supabase no devolvió el portafolio esperado');
    console.log('Datos de alertas cargados desde Supabase.');
    return rows[0].data;
  } catch (error) {
    console.warn(`No fue posible leer Supabase (${error.message}). Se usará la copia del repositorio.`);
    const rawData = await fs.readFile(DATA_FILE, 'utf8');
    return JSON.parse(rawData.replace(/^\uFEFF/, ''));
  }
}

export function buildAlerts(data, today) {
  return data.mortgages.map((mortgage) => {
    const dueDate = nextDueDate(mortgage, today);
    const property = data.properties.find((item) => item.id === mortgage.propertyId) || {};
    return { mortgage, property, dueDate, daysLeft: daysBetween(today, dueDate) };
  });
}

export function todayInChile(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (type) => Number(parts.find((part) => part.type === type).value);
  return new Date(get('year'), get('month') - 1, get('day'));
}

export function parseDate(value) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

export function dueDateInMonth(year, month, dueDay) {
  const lastDay = new Date(year, month + 1, 0).getDate();
  return new Date(year, month, Math.min(Math.max(Number(dueDay) || 1, 1), lastDay));
}

export function nextDueDate(mortgage, from) {
  const firstDue = parseDate(mortgage.firstDueDate);
  if (from <= firstDue) return firstDue;
  let due = dueDateInMonth(from.getFullYear(), from.getMonth(), mortgage.dueDay || firstDue.getDate());
  if (due < from) due = dueDateInMonth(from.getFullYear(), from.getMonth() + 1, mortgage.dueDay || firstDue.getDate());
  return due < firstDue ? firstDue : due;
}

export function daysBetween(a, b) {
  return Math.round((b - a) / 86400000);
}

export function buildEmail(alerts, daysBefore) {
  const rows = alerts.map(({ mortgage, property, dueDate }) => {
    const amount = mortgage.referenceDividendClp ? `$${Number(mortgage.referenceDividendClp).toLocaleString('es-CL')}` : `${Number(mortgage.referenceDividendUf || 0).toLocaleString('es-CL')} UF`;
    return `<tr><td>${escapeHtml(property.unit || mortgage.propertyId)}</td><td>${escapeHtml(property.address || '')}</td><td>${escapeHtml(mortgage.bank || '')}</td><td>${escapeHtml(mortgage.operation || '')}</td><td>${escapeHtml(dueDate.toLocaleDateString('es-CL'))}</td><td>${escapeHtml(amount)}</td></tr>`;
  }).join('');
  return `<div style="font-family:Arial,sans-serif;color:#1e293b"><h2>Dividendos hipotecarios por vencer</h2><p>Estos pagos vencen en ${Number(daysBefore)} días.</p><table cellpadding="8" cellspacing="0" style="border-collapse:collapse;border:1px solid #d7dee8"><thead><tr style="background:#e8f1f8"><th>Depto</th><th>Dirección</th><th>Banco</th><th>Operación</th><th>Vence</th><th>Monto ref.</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function formatIsoDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[character]);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await main();
}
