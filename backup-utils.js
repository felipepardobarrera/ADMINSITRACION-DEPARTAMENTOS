export const BACKUP_FORMAT_VERSION = 3;

const REQUIRED_COLLECTIONS = ['properties', 'mortgages', 'income', 'expenses'];
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function cloneData(value) {
  return JSON.parse(JSON.stringify(value));
}

export function validateState(candidate) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw new Error('El respaldo no contiene un estado válido.');
  }

  for (const collection of REQUIRED_COLLECTIONS) {
    if (!Array.isArray(candidate[collection])) {
      throw new Error(`Falta la lista obligatoria "${collection}".`);
    }
  }

  const propertyIds = uniqueIds(candidate.properties, 'propiedades');
  uniqueIds(candidate.income, 'ingresos');
  uniqueIds(candidate.expenses, 'gastos');

  candidate.mortgages.forEach((row, index) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error(`El dividendo ${index + 1} no es válido.`);
    requireProperty(row, propertyIds, `dividendo ${index + 1}`);
    requireDate(row.firstDueDate, `dividendo ${index + 1}`);
    requireNonNegative(row.referenceDividendUf, `dividendo ${index + 1}`);
    requireNonNegative(row.referenceDividendClp, `dividendo ${index + 1}`);
  });

  for (const [label, rows] of [['ingreso', candidate.income], ['gasto', candidate.expenses]]) {
    rows.forEach((row, index) => {
      requireProperty(row, propertyIds, `${label} ${index + 1}`);
      requireDate(row.date, `${label} ${index + 1}`);
      requireNonNegative(row.amount, `${label} ${index + 1}`, true);
    });
  }

  return cloneData(candidate);
}

export function validateBackupDocument(candidate, options = {}) {
  const maxAttachmentBytes = options.maxAttachmentBytes ?? 20 * 1024 * 1024;
  const maxTotalAttachmentBytes = options.maxTotalAttachmentBytes ?? 100 * 1024 * 1024;
  const document = candidate?.state ? candidate : { formatVersion: 1, state: candidate, attachments: {} };
  const version = Number(document.formatVersion || 1);
  if (!Number.isInteger(version) || version < 1 || version > BACKUP_FORMAT_VERSION) {
    throw new Error(`Versión de respaldo no compatible: ${document.formatVersion}.`);
  }

  const state = validateState(document.state);
  const attachments = document.attachments || {};
  if (!attachments || typeof attachments !== 'object' || Array.isArray(attachments)) {
    throw new Error('La sección de archivos adjuntos no es válida.');
  }

  const recordIds = new Set([...state.income, ...state.expenses].map((row) => row.id));
  let totalBytes = 0;
  for (const [id, attachment] of Object.entries(attachments)) {
    if (!recordIds.has(id)) throw new Error(`El archivo adjunto ${id} no corresponde a un movimiento.`);
    if (!attachment || typeof attachment.data !== 'string' || !attachment.data.startsWith('data:') || !attachment.data.includes(',')) {
      throw new Error(`El archivo adjunto ${id} está dañado.`);
    }
    const encoded = attachment.data.slice(attachment.data.indexOf(',') + 1);
    const estimatedBytes = Math.floor(encoded.length * 0.75);
    if (estimatedBytes > maxAttachmentBytes) throw new Error(`El archivo ${attachment.name || id} supera 20 MB.`);
    totalBytes += estimatedBytes;
  }
  if (totalBytes > maxTotalAttachmentBytes) throw new Error('Los archivos del respaldo superan 100 MB en total.');

  return { formatVersion: version, state, attachments: cloneData(attachments) };
}

export function safeCsvCell(value) {
  if (typeof value !== 'string') return value;
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function uniqueIds(rows, label) {
  const ids = new Set();
  rows.forEach((row, index) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error(`El registro ${index + 1} de ${label} no es válido.`);
    const id = String(row.id || '').trim();
    if (!id) throw new Error(`El registro ${index + 1} de ${label} no tiene identificador.`);
    if (ids.has(id)) throw new Error(`Hay un identificador duplicado en ${label}: ${id}.`);
    ids.add(id);
  });
  return ids;
}

function requireProperty(row, propertyIds, label) {
  if (!propertyIds.has(String(row.propertyId || ''))) throw new Error(`La propiedad del ${label} no existe.`);
}

function requireDate(value, label) {
  if (!DATE_PATTERN.test(String(value || '')) || Number.isNaN(Date.parse(`${value}T00:00:00`))) {
    throw new Error(`La fecha del ${label} no es válida.`);
  }
}

function requireNonNegative(value, label, required = false) {
  if (!required && (value === undefined || value === null || value === '')) return;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(`El monto del ${label} no es válido.`);
}
