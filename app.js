const DATA_URL = './data/properties.json';
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.56.0/+esm';
import { BACKUP_FORMAT_VERSION, cloneData, safeCsvCell, validateBackupDocument, validateState } from './backup-utils.js';

const STORAGE_KEY = 'administracion-departamentos-v1';
const LEGACY_RECOVERY_KEY = 'administracion-departamentos-recuperacion-v1';
const MONTH_FILTER_KEY = 'administracion-departamentos-mes';
const INCOME_PROPERTY_FILTER_KEY = 'administracion-departamentos-filtro-ingresos-propiedad';
const EXPENSE_PROPERTY_FILTER_KEY = 'administracion-departamentos-filtro-gastos-propiedad';
const RESTORE_POINTS_KEY = 'administracion-departamentos-puntos-restauracion-v1';
const RESTORE_POINTS_LIMIT = 8;
const ATTACHMENT_DB_NAME = 'administracion-departamentos-archivos';
const ATTACHMENT_STORE = 'respaldos';
const MAX_ATTACHMENT_SIZE = 20 * 1024 * 1024;
const SUPABASE_URL = 'https://hkvfqmzvuuseshroacqb.supabase.co';
const SUPABASE_KEY = 'sb_publishable_r7Nu9wLPFlG_pa4h0ig2jw_nKunjdXq';
const ADMIN_EMAIL = 'fpardo1996@gmail.com';
const PUBLIC_APP_URL = new URL('.', window.location.href).href.split('#')[0];
const CLOUD_ROW_ID = 'main';
const DOCUMENT_BUCKET = 'documentos';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const fmtMoney = new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 });
const fmtDate = new Intl.DateTimeFormat('es-CL', { dateStyle: 'medium' });
const fmtMonth = new Intl.DateTimeFormat('es-CL', { month: 'short', year: 'numeric' });
let state;
let toastTimer;
let session = null;
let isAdmin = false;
let cloudSubscription = null;
let lastCloudUpdate = null;
let usingLocalCopy = false;
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

async function boot() {
  const authResult = await supabase.auth.getSession();
  session = authResult.data.session;
  isAdmin = isAdminSession(session);
  await loadState();
  $('#monthFilter').value = localStorage.getItem(MONTH_FILTER_KEY) || latestActivityMonth() || currentMonth();
  bindEvents();
  renderAll();
  applyAccessMode();
  updateSyncStatus();
  subscribeToCloudUpdates();
  if (isPasswordRecoveryRedirect() && isAdmin) openPasswordDialog();
  showAuthRedirectError();
  supabase.auth.onAuthStateChange((event, nextSession) => {
    session = nextSession;
    isAdmin = isAdminSession(session);
    setTimeout(async () => {
      await loadState();
      renderAll();
      applyAccessMode();
      if (event === 'PASSWORD_RECOVERY') openPasswordDialog();
    }, 0);
  });
}

function isAdminSession(value) {
  return value?.user?.email?.toLowerCase() === ADMIN_EMAIL;
}

async function loadState() {
  const saved = localStorage.getItem(STORAGE_KEY);
  const localState = parseStoredState(saved);
  const { data, error } = await supabase.from('portfolio_state').select('data, updated_by').eq('id', CLOUD_ROW_ID).single();
  const cloudIsEmpty = !error && data?.data && Array.isArray(data.data.properties) && data.data.properties.length === 0;
  if (!error && data?.data && !cloudIsEmpty) {
    if (localState && hasMissingLocalRecords(localState, data.data)) {
      localStorage.setItem(LEGACY_RECOVERY_KEY, JSON.stringify({ state: localState, replaceSettings: !data.updated_by }));
    }
    state = validateState(data.data);
    lastCloudUpdate = new Date();
    usingLocalCopy = false;
    const recovery = parseStoredState(localStorage.getItem(LEGACY_RECOVERY_KEY));
    if (isAdmin && recovery?.state) {
      state = mergeRecoveredState(state, recovery);
      try {
        await persist();
        localStorage.removeItem(LEGACY_RECOVERY_KEY);
        showToast('Los movimientos guardados en este computador se sincronizaron con la nube.');
      } catch {
        showToast('Encontramos movimientos anteriores, pero aun no fue posible sincronizarlos.');
      }
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return;
  }
  state = validateState(localState || await fetch(DATA_URL).then((response) => {
    if (!response.ok) throw new Error('No fue posible cargar los datos iniciales.');
    return response.json();
  }));
  usingLocalCopy = true;
  if (cloudIsEmpty && isAdmin) {
    await persist();
    showToast('La nube estaba vacía y se inicializó con la copia disponible.');
    return;
  }
  if (cloudIsEmpty) {
    showToast('La nube está lista pero vacía. Ingresa como administrador para inicializarla.');
    return;
  }
  showToast('No fue posible conectar con la nube. Se muestra la ultima copia disponible.');
}

function parseStoredState(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function hasMissingLocalRecords(local, cloud) {
  const cloudIds = new Set([...(cloud.income || []), ...(cloud.expenses || [])].map((row) => row.id));
  return [...(local.income || []), ...(local.expenses || [])].some((row) => row.id && !cloudIds.has(row.id));
}

function mergeRecoveredState(cloud, recovery) {
  const legacy = recovery.state;
  const merged = recovery.replaceSettings ? { ...cloud, ...legacy } : { ...cloud };
  merged.income = mergeRecordLists(cloud.income, legacy.income);
  merged.expenses = mergeRecordLists(cloud.expenses, legacy.expenses);
  return merged;
}

function mergeRecordLists(cloudRows = [], localRows = []) {
  const rows = new Map(cloudRows.map((row) => [row.id, row]));
  localRows.forEach((row) => rows.set(row.id, row));
  return [...rows.values()];
}

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function latestActivityMonth() {
  return [...state.income, ...state.expenses].map((row) => monthKey(row.date)).filter(Boolean).sort().at(-1) || '';
}

async function persist() {
  if (!isAdmin) throw new Error('Solo el administrador puede guardar cambios.');
  const validState = validateState(state);
  const { data, error } = await supabase.from('portfolio_state').update({
    data: validState,
    updated_at: new Date().toISOString(),
    updated_by: session.user.id,
  }).eq('id', CLOUD_ROW_ID).select('id').single();
  if (error) throw error;
  if (!data?.id) throw new Error('Supabase no confirmó la actualización. Revisa que exista la fila "main".');
  state = validState;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  lastCloudUpdate = new Date();
  usingLocalCopy = false;
  updateSyncStatus();
}

function subscribeToCloudUpdates() {
  cloudSubscription?.unsubscribe();
  cloudSubscription = supabase.channel('portfolio-publico')
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'portfolio_state', filter: `id=eq.${CLOUD_ROW_ID}` }, (payload) => {
      state = validateState(payload.new.data);
      lastCloudUpdate = new Date(payload.new.updated_at || Date.now());
      usingLocalCopy = false;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      renderAll();
      applyAccessMode();
      showToast('Informacion actualizada desde la nube.');
    })
    .subscribe();
}

function updateSyncStatus() {
  const status = $('#syncStatus');
  if (!status) return;
  if (!navigator.onLine) {
    status.textContent = 'Sin conexión · copia local';
    status.className = 'sync-status offline';
    return;
  }
  if (usingLocalCopy) {
    status.textContent = 'Copia local · nube no disponible';
    status.className = 'sync-status offline';
    return;
  }
  status.textContent = lastCloudUpdate ? `Nube al día · ${lastCloudUpdate.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}` : 'Conectando con la nube…';
  status.className = 'sync-status';
}

function saveRestorePoint(label, snapshot = state) {
  const points = getRestorePoints();
  points.unshift({ id: crypto.randomUUID(), createdAt: new Date().toISOString(), label, state: validateState(snapshot) });
  localStorage.setItem(RESTORE_POINTS_KEY, JSON.stringify(points.slice(0, RESTORE_POINTS_LIMIT)));
  renderRestorePoints();
}

function getRestorePoints() {
  try {
    const points = JSON.parse(localStorage.getItem(RESTORE_POINTS_KEY) || '[]');
    return Array.isArray(points) ? points : [];
  } catch {
    return [];
  }
}

function renderRestorePoints() {
  const container = $('#restorePoints');
  if (!container) return;
  const points = getRestorePoints();
  container.innerHTML = points.length ? points.map((point) => `<article class="restore-point"><div><strong>${escapeHtml(point.label || 'Cambio')}</strong><span>${escapeHtml(new Date(point.createdAt).toLocaleString('es-CL'))}</span></div><button class="small secondary" data-restore-point="${escapeAttr(point.id)}" type="button">Restaurar</button></article>`).join('') : '<p class="empty-state compact">Todavía no hay puntos automáticos.</p>';
}

async function restoreLocalPoint(id) {
  if (!requireAdmin()) return;
  const point = getRestorePoints().find((item) => item.id === id);
  if (!point || !confirm(`¿Restaurar el punto "${point.label}"? Se guardará una copia del estado actual.`)) return;
  const previous = cloneData(state);
  saveRestorePoint('Antes de restaurar un punto', previous);
  state = validateState(point.state);
  try {
    await persist();
    renderAll();
    showToast('Punto de restauración aplicado y sincronizado.');
  } catch (error) {
    state = previous;
    renderAll();
    showToast(error.message || 'No fue posible restaurar el punto.');
  }
}

function attachmentDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(ATTACHMENT_DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(ATTACHMENT_STORE)) request.result.createObjectStore(ATTACHMENT_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveLocalAttachment(id, file) {
  const db = await attachmentDb();
  await new Promise((resolve, reject) => {
    const transaction = db.transaction(ATTACHMENT_STORE, 'readwrite');
    transaction.objectStore(ATTACHMENT_STORE).put(file, id);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
}

async function getLocalAttachment(id) {
  const db = await attachmentDb();
  const file = await new Promise((resolve, reject) => {
    const request = db.transaction(ATTACHMENT_STORE, 'readonly').objectStore(ATTACHMENT_STORE).get(id);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return file;
}

async function deleteLocalAttachment(id) {
  const db = await attachmentDb();
  await new Promise((resolve, reject) => {
    const transaction = db.transaction(ATTACHMENT_STORE, 'readwrite');
    transaction.objectStore(ATTACHMENT_STORE).delete(id);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
}

async function saveAttachment(id, file) {
  if (!requireAdmin()) throw new Error('Solo el administrador puede subir respaldos.');
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `${id}/${crypto.randomUUID()}-${safeName}`;
  const { error } = await supabase.storage.from(DOCUMENT_BUCKET).upload(path, file, {
    contentType: file.type || 'application/octet-stream',
    upsert: false,
  });
  if (error) throw error;
  return path;
}

async function getAttachment(id) {
  const record = [...state.income, ...state.expenses].find((item) => item.id === id);
  if (record?.attachment?.path && isAdmin) {
    const { data, error } = await supabase.storage.from(DOCUMENT_BUCKET).download(record.attachment.path);
    if (error) throw error;
    return new File([data], record.attachment.name || 'respaldo', { type: record.attachment.type || data.type });
  }
  return getLocalAttachment(id);
}

async function deleteAttachment(id, attachment) {
  if (attachment?.path && isAdmin) {
    const { error } = await supabase.storage.from(DOCUMENT_BUCKET).remove([attachment.path]);
    if (error) throw error;
  }
  await deleteLocalAttachment(id).catch(() => {});
}

function propertyName(id) {
  const property = state.properties.find((item) => item.id === id);
  return property ? `${property.unit} - ${property.address}` : id;
}

function parseLocalDate(value) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function isoDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function monthKey(dateString) {
  return dateString ? dateString.slice(0, 7) : '';
}

function daysBetween(a, b) {
  const ms = parseLocalDate(isoDate(b)) - parseLocalDate(isoDate(a));
  return Math.round(ms / 86400000);
}

function addMonths(date, months) {
  const target = new Date(date.getFullYear(), date.getMonth() + months, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(date.getDate(), lastDay));
  return target;
}

function nextDueDate(mortgage, from = new Date()) {
  let due = parseLocalDate(mortgage.firstDueDate);
  while (due < parseLocalDate(isoDate(from))) {
    due = addMonths(due, 1);
  }
  return due;
}

function upcomingMortgages(days = 45) {
  const today = new Date();
  return state.mortgages.map((mortgage) => {
    const due = nextDueDate(mortgage, today);
    return { ...mortgage, dueDate: isoDate(due), daysLeft: daysBetween(today, due), property: state.properties.find((item) => item.id === mortgage.propertyId) };
  }).filter((item) => item.daysLeft <= days).sort((a, b) => a.daysLeft - b.daysLeft);
}

function selectedMonth() {
  return $('#monthFilter').value || currentMonth();
}

function byMonth(rows, dateField = 'date') {
  const month = selectedMonth();
  return rows.filter((row) => monthKey(row[dateField]) === month);
}

function sum(rows, field = 'amount') {
  return rows.reduce((total, row) => total + Number(row[field] || 0), 0);
}

function formatMonth(month) {
  if (!month) return '';
  const [year, monthNumber] = month.split('-').map(Number);
  const label = fmtMonth.format(new Date(year, monthNumber - 1, 1)).replace('.', '');
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function paid(rows) {
  return rows.filter((row) => row.status === 'Pagado');
}

function cashFlowByMonth(propertyId = null) {
  const months = new Map();
  const ensureMonth = (key) => {
    if (!months.has(key)) months.set(key, { month: key, income: 0, expenses: 0, net: 0, accumulated: 0 });
    return months.get(key);
  };

  paid(state.income).filter((row) => !propertyId || row.propertyId === propertyId).forEach((row) => {
    const key = monthKey(row.date);
    if (key) ensureMonth(key).income += Number(row.amount || 0);
  });
  paid(state.expenses).filter((row) => !propertyId || row.propertyId === propertyId).forEach((row) => {
    const key = monthKey(row.date);
    if (key) ensureMonth(key).expenses += Number(row.amount || 0);
  });

  let accumulated = 0;
  return [...months.values()].sort((a, b) => a.month.localeCompare(b.month)).map((row) => {
    row.net = row.income - row.expenses;
    accumulated += row.net;
    row.accumulated = accumulated;
    return row;
  });
}

function renderAll() {
  fillPropertyOptions();
  renderKpis();
  renderAlerts();
  renderPropertyResults();
  renderCashFlow();
  renderDepartmentDashboard();
  renderProperties();
  renderMortgages();
  renderIncome();
  renderExpenses();
  renderReports();
  applyAccessMode();
}

function renderKpis() {
  const income = sum(paid(byMonth(state.income)));
  const expenses = sum(paid(byMonth(state.expenses)));
  $('#kpiIncome').textContent = fmtMoney.format(income);
  $('#kpiExpenses').textContent = fmtMoney.format(expenses);
  $('#kpiNet').textContent = fmtMoney.format(income - expenses);
  $('#kpiNet').className = income - expenses < 0 ? 'negative' : income - expenses > 0 ? 'positive' : '';
  $('#kpiAlerts').textContent = upcomingMortgages(15).length;
}

function renderCashFlow() {
  const rows = cashFlowByMonth();
  const totalIncome = rows.reduce((total, row) => total + row.income, 0);
  const totalExpenses = rows.reduce((total, row) => total + row.expenses, 0);
  const balance = totalIncome - totalExpenses;
  $('#cashflowIncome').textContent = fmtMoney.format(totalIncome);
  $('#cashflowExpenses').textContent = fmtMoney.format(totalExpenses);
  $('#cashflowBalance').textContent = fmtMoney.format(balance);
  $('#cashflowBalance').className = balance < 0 ? 'negative' : balance > 0 ? 'positive' : '';
  $('#cashflowMonths').textContent = rows.length;
  $('#cashflowPeriod').textContent = rows.length ? `${formatMonth(rows[0].month)} a ${formatMonth(rows.at(-1).month)} · Solo movimientos pagados` : 'Aun no hay movimientos pagados';

  const tableRows = [...rows].reverse();
  $('#cashflowRows').innerHTML = tableRows.length ? tableRows.map((row) => `
    <tr>
      <td>${formatMonth(row.month)}</td>
      <td class="numeric income-value">${fmtMoney.format(row.income)}</td>
      <td class="numeric expense-value">${fmtMoney.format(row.expenses)}</td>
      <td class="numeric ${row.net < 0 ? 'negative' : row.net > 0 ? 'positive' : ''}">${fmtMoney.format(row.net)}</td>
      <td class="numeric ${row.accumulated < 0 ? 'negative' : row.accumulated > 0 ? 'positive' : ''}">${fmtMoney.format(row.accumulated)}</td>
    </tr>`).join('') : '<tr><td colspan="5" class="empty-state">Agrega ingresos y gastos pagados para ver el flujo de caja.</td></tr>';

  const chartRows = rows.slice(-12);
  const maxAmount = Math.max(1, ...chartRows.flatMap((row) => [row.income, row.expenses]));
  $('#cashflowChart').innerHTML = chartRows.length ? chartRows.map((row) => `
    <div class="chart-row">
      <span class="chart-month">${formatMonth(row.month)}</span>
      <div class="bar-group">
        <div class="bar-track" title="Ingresos ${fmtMoney.format(row.income)}"><span class="bar income-bar" style="width:${(row.income / maxAmount) * 100}%"></span><strong>${fmtMoney.format(row.income)}</strong></div>
        <div class="bar-track" title="Egresos ${fmtMoney.format(row.expenses)}"><span class="bar expense-bar" style="width:${(row.expenses / maxAmount) * 100}%"></span><strong>${fmtMoney.format(row.expenses)}</strong></div>
      </div>
    </div>`).join('') : '<div class="empty-state">Sin movimientos para graficar.</div>';
}

function renderDepartmentDashboard() {
  const monthIncome = sum(paid(byMonth(state.income)));
  const monthExpenses = sum(paid(byMonth(state.expenses)));
  const portfolioRows = cashFlowByMonth();
  const totalBalance = portfolioRows.at(-1)?.accumulated || 0;
  $('#departmentPeriod').textContent = `${formatMonth(selectedMonth())} · Solo movimientos pagados`;
  $('#portfolioMonthIncome').textContent = fmtMoney.format(monthIncome);
  $('#portfolioMonthExpenses').textContent = fmtMoney.format(monthExpenses);
  $('#portfolioMonthBalance').textContent = fmtMoney.format(monthIncome - monthExpenses);
  $('#portfolioMonthBalance').className = financialClass(monthIncome - monthExpenses);
  $('#portfolioTotalBalance').textContent = fmtMoney.format(totalBalance);
  $('#portfolioTotalBalance').className = financialClass(totalBalance);

  $('#departmentPanels').innerHTML = state.properties.map((property) => {
    const incomeMonth = sum(paid(byMonth(state.income)).filter((row) => row.propertyId === property.id));
    const expensesMonth = sum(paid(byMonth(state.expenses)).filter((row) => row.propertyId === property.id));
    const history = cashFlowByMonth(property.id);
    const totalIncome = history.reduce((total, row) => total + row.income, 0);
    const totalExpenses = history.reduce((total, row) => total + row.expenses, 0);
    const totalNet = totalIncome - totalExpenses;
    const historyRows = [...history].reverse().slice(0, 6);
    return `<article class="department-panel">
      <div class="department-panel-head">
        <div><span class="unit-label">Departamento ${escapeHtml(property.unit)}</span><h3>${escapeHtml(property.address)}</h3></div>
        <span class="badge">${escapeHtml(property.status || '')}</span>
      </div>
      <div class="department-metrics">
        <div><span>Ingreso mes</span><strong>${fmtMoney.format(incomeMonth)}</strong></div>
        <div><span>Egreso mes</span><strong>${fmtMoney.format(expensesMonth)}</strong></div>
        <div><span>Saldo mes</span><strong class="${financialClass(incomeMonth - expensesMonth)}">${fmtMoney.format(incomeMonth - expensesMonth)}</strong></div>
        <div><span>Ingreso acumulado</span><strong>${fmtMoney.format(totalIncome)}</strong></div>
        <div><span>Egreso acumulado</span><strong>${fmtMoney.format(totalExpenses)}</strong></div>
        <div><span>Saldo acumulado</span><strong class="${financialClass(totalNet)}">${fmtMoney.format(totalNet)}</strong></div>
      </div>
      <div class="department-history">
        <h4>Últimos movimientos mensuales</h4>
        <div class="table-wrap"><table><thead><tr><th>Mes</th><th class="numeric">Ingreso</th><th class="numeric">Egreso</th><th class="numeric">Saldo</th></tr></thead><tbody>
          ${historyRows.length ? historyRows.map((row) => `<tr><td>${formatMonth(row.month)}</td><td class="numeric income-value">${fmtMoney.format(row.income)}</td><td class="numeric expense-value">${fmtMoney.format(row.expenses)}</td><td class="numeric ${financialClass(row.net)}">${fmtMoney.format(row.net)}</td></tr>`).join('') : '<tr><td colspan="4" class="empty-state">Sin movimientos pagados.</td></tr>'}
        </tbody></table></div>
      </div>
    </article>`;
  }).join('');
}

function financialClass(value) {
  return value < 0 ? 'negative' : value > 0 ? 'positive' : '';
}

function renderAlerts() {
  const list = $('#alertsList');
  const alerts = upcomingMortgages(45);
  if (!alerts.length) {
    list.innerHTML = '<div class="alert-card"><strong>Sin vencimientos cercanos</strong><p>No hay dividendos hipotecarios dentro de los proximos 45 dias.</p></div>';
    return;
  }
  list.innerHTML = alerts.map((item) => {
    const cls = item.daysLeft <= 3 ? 'danger' : item.daysLeft <= 10 ? 'warning' : '';
    const date = fmtDate.format(parseLocalDate(item.dueDate));
    const amount = item.referenceDividendClp ? fmtMoney.format(item.referenceDividendClp) : `${item.referenceDividendUf.toLocaleString('es-CL')} UF`;
    return `<article class="alert-card ${cls}"><strong>${escapeHtml(item.bank || '')} ${escapeHtml(item.operation || '')} - ${escapeHtml(propertyName(item.propertyId))}</strong><p>Vence ${escapeHtml(date)}. Faltan ${item.daysLeft} días. Dividendo referencial: ${escapeHtml(amount)}.</p></article>`;
  }).join('');
}

function renderPropertyResults() {
  const rows = state.properties.map((property) => {
    const income = sum(byMonth(state.income).filter((row) => row.propertyId === property.id && row.status === 'Pagado'));
    const expenses = sum(byMonth(state.expenses).filter((row) => row.propertyId === property.id && row.status === 'Pagado'));
    return `<tr><td>${escapeHtml(propertyName(property.id))}</td><td class="numeric">${fmtMoney.format(income)}</td><td class="numeric">${fmtMoney.format(expenses)}</td><td class="numeric">${fmtMoney.format(income - expenses)}</td></tr>`;
  });
  $('#propertyResults').innerHTML = rows.join('');
}

function renderProperties() {
  $('#propertyCards').innerHTML = state.properties.map((property, index) => `
    <article class="property-card" data-index="${index}">
      <div class="card-head"><div><h3>${escapeHtml(propertyName(property.id))}</h3><span class="badge">${escapeHtml(property.status || '')}</span></div><strong>${escapeHtml(property.role || '')}</strong></div>
      <div class="form-grid">
        <label>Direccion <input data-field="address" value="${escapeAttr(property.address)}"></label>
        <label>Comuna <input data-field="commune" value="${escapeAttr(property.commune)}"></label>
        <label>Arrendatario <input data-field="tenant" value="${escapeAttr(property.tenant)}"></label>
        <label>Canon mensual <input data-field="monthlyRent" type="number" value="${property.monthlyRent || 0}"></label>
        <label>Dia pago arriendo <input data-field="rentDueDay" type="number" min="1" max="31" value="${property.rentDueDay || 5}"></label>
        <label>Estado <select data-field="status">${['Arrendado','Disponible','En reparacion','Uso propio','En venta'].map((v) => `<option ${v === property.status ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      </div>
      <label>Notas <textarea data-field="notes">${escapeHtml(property.notes || '')}</textarea></label>
    </article>
  `).join('');
}

function renderMortgages() {
  $('#mortgageCards').innerHTML = state.mortgages.map((mortgage, index) => {
    const due = nextDueDate(mortgage);
    return `<article class="property-card" data-index="${index}">
      <div class="card-head"><div><h3>${escapeHtml(mortgage.bank || '')} ${escapeHtml(mortgage.operation || '')}</h3><span class="badge">${escapeHtml(propertyName(mortgage.propertyId))}</span></div><strong>${fmtDate.format(due)}</strong></div>
      <div class="form-grid">
        <label>Banco <input data-field="bank" value="${escapeAttr(mortgage.bank)}"></label>
        <label>Operacion <input data-field="operation" value="${escapeAttr(mortgage.operation)}"></label>
        <label>Dividendo UF <input data-field="referenceDividendUf" type="number" step="0.0001" value="${mortgage.referenceDividendUf || 0}"></label>
        <label>Dividendo CLP ref. <input data-field="referenceDividendClp" type="number" value="${mortgage.referenceDividendClp || 0}"></label>
        <label>Dia vencimiento <input data-field="dueDay" type="number" min="1" max="31" value="${mortgage.dueDay || 5}"></label>
        <label>Dividendos pagados <input data-field="paidPayments" type="number" min="0" value="${mortgage.paidPayments || 0}"></label>
      </div>
      <label>Notas <textarea data-field="notes">${escapeHtml(mortgage.notes || '')}</textarea></label>
    </article>`;
  }).join('');
}

function renderIncome() {
  const selectedPropertyId = $('#incomePropertyFilter')?.value || '';
  const income = state.income
    .filter((row) => !selectedPropertyId || row.propertyId === selectedPropertyId)
    .sort((a, b) => b.date.localeCompare(a.date));
  const total = income.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const selectedProperty = state.properties.find((property) => property.id === selectedPropertyId);
  const scope = selectedProperty ? buildingPropertyLabel(selectedProperty) : 'Todos los edificios';
  const recordLabel = income.length === 1 ? '1 ingreso' : `${income.length} ingresos`;

  $('#incomeFilterSummary').textContent = `${scope} · ${recordLabel} · Total ${fmtMoney.format(total)}`;
  $('#incomeRows').innerHTML = income.length
    ? income.map((row) => `<tr><td>${escapeHtml(row.date)}</td><td>${escapeHtml(propertyName(row.propertyId))}</td><td>${escapeHtml(row.tenant || '')}</td><td class="numeric">${fmtMoney.format(row.amount || 0)}</td><td>${escapeHtml(row.status || '')}</td><td>${escapeHtml(row.notes || '')}</td><td>${attachmentCell(row)}</td><td>${isAdmin ? `<div class="row-actions"><button class="small secondary" data-edit-income="${escapeAttr(row.id)}" type="button">Editar</button><button class="small danger" data-delete-income="${escapeAttr(row.id)}" type="button">Eliminar</button></div>` : ''}</td></tr>`).join('')
    : `<tr><td colspan="8" class="empty-state">No hay ingresos registrados para ${escapeHtml(scope)}.</td></tr>`;
}

function renderExpenses() {
  const selectedPropertyId = $('#expensePropertyFilter')?.value || '';
  const expenses = state.expenses
    .filter((row) => !selectedPropertyId || row.propertyId === selectedPropertyId)
    .sort((a, b) => b.date.localeCompare(a.date));
  const total = expenses.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const selectedProperty = state.properties.find((property) => property.id === selectedPropertyId);
  const scope = selectedProperty ? buildingPropertyLabel(selectedProperty) : 'Todos los edificios';
  const recordLabel = expenses.length === 1 ? '1 gasto' : `${expenses.length} gastos`;

  $('#expenseFilterSummary').textContent = `${scope} · ${recordLabel} · Total ${fmtMoney.format(total)}`;
  $('#expenseRows').innerHTML = expenses.length
    ? expenses.map((row) => `<tr><td>${escapeHtml(row.date)}</td><td>${escapeHtml(propertyName(row.propertyId))}</td><td>${escapeHtml(row.category || '')}</td><td>${escapeHtml(row.detail || '')}</td><td class="numeric">${fmtMoney.format(row.amount || 0)}</td><td>${escapeHtml(row.status || '')}</td><td>${attachmentCell(row)}</td><td>${isAdmin ? `<div class="row-actions"><button class="small secondary" data-edit-expense="${escapeAttr(row.id)}" type="button">Editar</button><button class="small danger" data-delete-expense="${escapeAttr(row.id)}" type="button">Eliminar</button></div>` : ''}</td></tr>`).join('')
    : `<tr><td colspan="8" class="empty-state">No hay gastos registrados para ${escapeHtml(scope)}.</td></tr>`;
}

function attachmentCell(row) {
  if (!row.attachment) return '<span class="no-attachment">Sin archivo</span>';
  if (!isAdmin) return '<span class="no-attachment">Respaldo privado</span>';
  return `<div class="attachment-actions"><span title="${escapeAttr(row.attachment.name)}">${escapeHtml(row.attachment.name)}</span><div><button class="small secondary" data-open-attachment="${escapeAttr(row.id)}" type="button">Abrir</button><button class="small secondary" data-download-attachment="${escapeAttr(row.id)}" type="button">Descargar</button></div></div>`;
}

function renderReports() {
  $('#reportProperties').textContent = state.properties.length;
  $('#reportMortgageUf').textContent = state.mortgages.reduce((t, m) => t + Number(m.referenceDividendUf || 0), 0).toLocaleString('es-CL', { maximumFractionDigits: 4 });
  $('#reportExpectedRent').textContent = fmtMoney.format(state.properties.reduce((t, p) => t + Number(p.monthlyRent || 0), 0));
  $('#reportExpensesAll').textContent = fmtMoney.format(sum(state.expenses));
}

function fillPropertyOptions() {
  $$('select[name="propertyId"]').forEach((select) => {
    select.innerHTML = state.properties.map((property) => `<option value="${escapeAttr(property.id)}">${escapeHtml(propertyName(property.id))}</option>`).join('');
  });

  fillMovementPropertyFilter('#incomePropertyFilter', INCOME_PROPERTY_FILTER_KEY);
  fillMovementPropertyFilter('#expensePropertyFilter', EXPENSE_PROPERTY_FILTER_KEY);
}

function fillMovementPropertyFilter(selector, storageKey) {
  const filter = $(selector);
  if (!filter) return;
  const currentValue = filter.value || localStorage.getItem(storageKey) || '';
  filter.innerHTML = `<option value="">Todos los edificios</option>${state.properties.map((property) => `<option value="${escapeAttr(property.id)}">${escapeHtml(buildingPropertyLabel(property))}</option>`).join('')}`;
  filter.value = state.properties.some((property) => property.id === currentValue) ? currentValue : '';
}

function buildingPropertyLabel(property) {
  const address = String(property.address || '').trim();
  const building = address.match(/^(.+?\s+\d+)/)?.[1] || address || 'Edificio';
  return `${building} · Depto ${property.unit}`;
}

function bindEvents() {
  $('.tabs').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-tab]');
    if (!button) return;
    $$('.tabs button').forEach((item) => item.classList.toggle('active', item === button));
    $$('.tab-panel').forEach((panel) => panel.classList.toggle('active', panel.id === button.dataset.tab));
  });
  $('#monthFilter').addEventListener('change', () => {
    localStorage.setItem(MONTH_FILTER_KEY, selectedMonth());
    renderAll();
  });
  $('#expensePropertyFilter').addEventListener('change', (event) => {
    localStorage.setItem(EXPENSE_PROPERTY_FILTER_KEY, event.target.value);
    renderExpenses();
  });
  $('#incomePropertyFilter').addEventListener('change', (event) => {
    localStorage.setItem(INCOME_PROPERTY_FILTER_KEY, event.target.value);
    renderIncome();
  });
  $$('[data-open]').forEach((button) => button.addEventListener('click', () => {
    prepareCreateForm(button.dataset.open);
    $(`#${button.dataset.open}`).showModal();
  }));
  $$('[data-close]').forEach((button) => button.addEventListener('click', () => button.closest('dialog').close()));
  $('#incomeForm').addEventListener('submit', addIncome);
  $('#expenseForm').addEventListener('submit', addExpense);
  $('#saveProperties').addEventListener('click', saveProperties);
  $('#saveMortgages').addEventListener('click', saveMortgages);
  $('#openBackups').addEventListener('click', () => { renderRestorePoints(); $('#backupDialog').showModal(); });
  $('#exportBackup').addEventListener('click', exportBackup);
  $('#importBackup').addEventListener('change', importBackup);
  $('#authButton').addEventListener('click', handleAuthButton);
  $('#authForm').addEventListener('submit', signInAdmin);
  $('#recoverAdminAccess').addEventListener('click', sendPasswordRecovery);
  $('#passwordForm').addEventListener('submit', updateAdminPassword);
  $('#downloadMonthly').addEventListener('click', () => downloadCsv('resultado-mensual.csv', monthlyRows()));
  $('#downloadCashflow').addEventListener('click', () => downloadCsv('flujo-de-caja.csv', cashFlowRows()));
  $('#downloadCalendar').addEventListener('click', () => downloadCsv('vencimientos.csv', alertRows()));
  $('#downloadAll').addEventListener('click', () => downloadCsv('administracion-completa.csv', allRows()));
  window.addEventListener('online', updateSyncStatus);
  window.addEventListener('offline', updateSyncStatus);
  document.addEventListener('click', async (event) => {
    const openButton = event.target.closest('[data-open-attachment]');
    const downloadButton = event.target.closest('[data-download-attachment]');
    const editIncomeButton = event.target.closest('[data-edit-income]');
    const editExpenseButton = event.target.closest('[data-edit-expense]');
    const incomeButton = event.target.closest('[data-delete-income]');
    const expenseButton = event.target.closest('[data-delete-expense]');
    const restoreButton = event.target.closest('[data-restore-point]');
    if (openButton) await openAttachment(openButton.dataset.openAttachment, false);
    if (downloadButton) await openAttachment(downloadButton.dataset.downloadAttachment, true);
    if (editIncomeButton) editIncome(editIncomeButton.dataset.editIncome);
    if (editExpenseButton) editExpense(editExpenseButton.dataset.editExpense);
    if (restoreButton) await restoreLocalPoint(restoreButton.dataset.restorePoint);
    if (incomeButton) {
      if (!requireAdmin()) return;
      const id = incomeButton.dataset.deleteIncome;
      const record = state.income.find((row) => row.id === id);
      if (!record || !confirm(`¿Eliminar el ingreso de ${fmtMoney.format(record.amount || 0)}? Esta acción puede revertirse desde Respaldos.`)) return;
      const previous = cloneData(state);
      saveRestorePoint('Antes de eliminar un ingreso', previous);
      state.income = state.income.filter((row) => row.id !== id);
      try {
        await persist();
        await deleteAttachment(id, record?.attachment).catch(() => {});
        renderAll(); applyAccessMode(); showToast('Ingreso eliminado.');
      } catch (error) {
        state = previous;
        renderAll(); applyAccessMode();
        showToast(error.message || 'No fue posible eliminar el ingreso.');
      }
    }
    if (expenseButton) {
      if (!requireAdmin()) return;
      const id = expenseButton.dataset.deleteExpense;
      const record = state.expenses.find((row) => row.id === id);
      if (!record || !confirm(`¿Eliminar el gasto de ${fmtMoney.format(record.amount || 0)}? Esta acción puede revertirse desde Respaldos.`)) return;
      const previous = cloneData(state);
      saveRestorePoint('Antes de eliminar un gasto', previous);
      state.expenses = state.expenses.filter((row) => row.id !== id);
      try {
        await persist();
        await deleteAttachment(id, record?.attachment).catch(() => {});
        renderAll(); applyAccessMode(); showToast('Egreso eliminado.');
      } catch (error) {
        state = previous;
        renderAll(); applyAccessMode();
        showToast(error.message || 'No fue posible eliminar el egreso.');
      }
    }
  });
}

function requireAdmin() {
  if (isAdmin) return true;
  showToast('Ingresa como administrador para modificar la informacion.');
  return false;
}

function applyAccessMode() {
  $('#accessMode').textContent = isAdmin ? 'Modo administrador' : 'Vista pública';
  $('#accessMode').classList.toggle('admin', isAdmin);
  $('#authButton').textContent = isAdmin ? 'Cerrar sesion' : 'Ingresar';
  $$('[data-admin-only]').forEach((element) => { element.hidden = !isAdmin; });
  $$('#properties [data-field], #mortgages [data-field]').forEach((field) => { field.disabled = !isAdmin; });
}

async function handleAuthButton() {
  if (isAdmin) {
    await supabase.auth.signOut();
    showToast('Sesion de administrador cerrada.');
    return;
  }
  $('#authForm').reset();
  $('#authForm').elements.email.value = ADMIN_EMAIL;
  $('#authDialog').showModal();
}

async function signInAdmin(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const { error } = await supabase.auth.signInWithPassword({ email: ADMIN_EMAIL, password: form.get('password') });
  if (error) {
    showToast(error.message === 'Invalid login credentials' ? 'Correo o contrasena incorrectos.' : error.message);
    return;
  }
  $('#authDialog').close();
  event.currentTarget.reset();
  showToast('Acceso de administrador iniciado.');
}

async function sendPasswordRecovery() {
  const { error } = await supabase.auth.resetPasswordForEmail(ADMIN_EMAIL, { redirectTo: PUBLIC_APP_URL });
  if (error) {
    showToast('No fue posible enviar el correo de recuperacion. Intenta nuevamente en unos minutos.');
    return;
  }
  $('#authDialog').close();
  showToast('Enviamos un correo para crear una nueva contrasena. Usa solamente el enlace mas reciente.');
}

function isPasswordRecoveryRedirect() {
  const hash = new URLSearchParams(window.location.hash.slice(1));
  const query = new URLSearchParams(window.location.search);
  return hash.get('type') === 'recovery' || query.get('type') === 'recovery';
}

function showAuthRedirectError() {
  const hash = new URLSearchParams(window.location.hash.slice(1));
  const query = new URLSearchParams(window.location.search);
  const code = hash.get('error_code') || query.get('error_code');
  if (code === 'otp_expired') {
    showToast('Ese enlace ya vencio o fue utilizado. Solicita un correo nuevo desde Olvide mi contrasena.');
  }
}

function openPasswordDialog() {
  if ($('#authDialog').open) $('#authDialog').close();
  $('#passwordForm').reset();
  if (!$('#passwordDialog').open) $('#passwordDialog').showModal();
}

async function updateAdminPassword(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const password = String(form.get('password') || '');
  const confirmation = String(form.get('passwordConfirm') || '');
  if (password.length < 8) {
    showToast('La contrasena debe tener al menos 8 caracteres.');
    return;
  }
  if (password !== confirmation) {
    showToast('Las contrasenas no coinciden.');
    return;
  }
  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    showToast('No fue posible guardar la contrasena. Solicita un enlace de recuperacion nuevo.');
    return;
  }
  $('#passwordDialog').close();
  event.currentTarget.reset();
  window.history.replaceState({}, document.title, `${window.location.pathname}${window.location.search}`);
  showToast('Contrasena actualizada. Ya tienes acceso de administrador.');
}

function prepareCreateForm(dialogId) {
  const isIncome = dialogId === 'incomeDialog';
  const form = $(isIncome ? '#incomeForm' : '#expenseForm');
  form.reset();
  form.elements.recordId.value = '';
  $(isIncome ? '#incomeFormTitle' : '#expenseFormTitle').textContent = isIncome ? 'Nuevo ingreso' : 'Nuevo gasto';
  $(isIncome ? '#incomeSubmit' : '#expenseSubmit').textContent = 'Guardar';
  $(isIncome ? '#incomeCurrentAttachment' : '#expenseCurrentAttachment').textContent = '';
}

function editIncome(id) {
  if (!requireAdmin()) return;
  const row = state.income.find((item) => item.id === id);
  if (!row) return;
  const form = $('#incomeForm');
  form.reset();
  form.elements.recordId.value = row.id;
  form.elements.date.value = row.date || '';
  form.elements.propertyId.value = row.propertyId || '';
  form.elements.tenant.value = row.tenant || '';
  form.elements.amount.value = row.amount || 0;
  form.elements.status.value = row.status || 'Pagado';
  form.elements.notes.value = row.notes || '';
  $('#incomeFormTitle').textContent = 'Editar ingreso';
  $('#incomeSubmit').textContent = 'Guardar cambios';
  $('#incomeCurrentAttachment').textContent = row.attachment ? `Respaldo actual: ${row.attachment.name}` : 'Este ingreso no tiene respaldo adjunto.';
  $('#incomeDialog').showModal();
}

function editExpense(id) {
  if (!requireAdmin()) return;
  const row = state.expenses.find((item) => item.id === id);
  if (!row) return;
  const form = $('#expenseForm');
  form.reset();
  form.elements.recordId.value = row.id;
  form.elements.date.value = row.date || '';
  form.elements.propertyId.value = row.propertyId || '';
  form.elements.category.value = row.category || 'Otro';
  form.elements.vendor.value = row.vendor || '';
  form.elements.detail.value = row.detail || '';
  form.elements.amount.value = row.amount || 0;
  form.elements.status.value = row.status || 'Pagado';
  $('#expenseFormTitle').textContent = 'Editar gasto';
  $('#expenseSubmit').textContent = 'Guardar cambios';
  $('#expenseCurrentAttachment').textContent = row.attachment ? `Respaldo actual: ${row.attachment.name}` : 'Este gasto no tiene respaldo adjunto.';
  $('#expenseDialog').showModal();
}

async function addIncome(event) {
  event.preventDefault();
  if (!requireAdmin()) return;
  const formElement = event.currentTarget;
  const form = new FormData(formElement);
  const date = form.get('date');
  const amount = Number(form.get('amount'));
  const recordId = form.get('recordId');
  const existingIndex = state.income.findIndex((row) => row.id === recordId);
  const existing = existingIndex >= 0 ? state.income[existingIndex] : null;
  const id = existing?.id || crypto.randomUUID();
  const previous = cloneData(state);
  let attachment;
  try {
    attachment = await attachmentFromForm(form, id, existing?.attachment || null);
  } catch (error) {
    showToast(error.message || 'No fue posible guardar el archivo de respaldo.');
    return;
  }
  const income = { id, date, propertyId: form.get('propertyId'), tenant: form.get('tenant'), amount, status: form.get('status'), notes: form.get('notes'), attachment };
  if (existingIndex >= 0) state.income[existingIndex] = income;
  else state.income.push(income);
  $('#monthFilter').value = monthKey(date);
  localStorage.setItem(MONTH_FILTER_KEY, monthKey(date));
  try {
    saveRestorePoint(existing ? 'Antes de editar un ingreso' : 'Antes de agregar un ingreso', previous);
    await persist(); formElement.reset(); $('#incomeDialog').close(); renderAll(); applyAccessMode();
    if (existing?.attachment?.path && attachment?.path !== existing.attachment.path) await deleteAttachment(id, existing.attachment).catch(() => {});
    showToast(existing ? `Ingreso actualizado a ${fmtMoney.format(amount)}.` : `Ingreso de ${fmtMoney.format(amount)} guardado en ${formatMonth(monthKey(date))}.`);
  } catch (error) {
    state = previous;
    if (attachment?.path && attachment.path !== existing?.attachment?.path) await supabase.storage.from(DOCUMENT_BUCKET).remove([attachment.path]).catch(() => {});
    renderAll(); applyAccessMode();
    showToast(error.message || 'No fue posible guardar el ingreso en la nube.');
  }
}

async function addExpense(event) {
  event.preventDefault();
  if (!requireAdmin()) return;
  const formElement = event.currentTarget;
  const form = new FormData(formElement);
  const date = form.get('date');
  const amount = Number(form.get('amount'));
  const recordId = form.get('recordId');
  const existingIndex = state.expenses.findIndex((row) => row.id === recordId);
  const existing = existingIndex >= 0 ? state.expenses[existingIndex] : null;
  const id = existing?.id || crypto.randomUUID();
  const previous = cloneData(state);
  let attachment;
  try {
    attachment = await attachmentFromForm(form, id, existing?.attachment || null);
  } catch (error) {
    showToast(error.message || 'No fue posible guardar el archivo de respaldo.');
    return;
  }
  const expense = { id, date, propertyId: form.get('propertyId'), category: form.get('category'), vendor: form.get('vendor'), detail: form.get('detail'), amount, status: form.get('status'), attachment };
  if (existingIndex >= 0) state.expenses[existingIndex] = expense;
  else state.expenses.push(expense);
  $('#monthFilter').value = monthKey(date);
  localStorage.setItem(MONTH_FILTER_KEY, monthKey(date));
  try {
    saveRestorePoint(existing ? 'Antes de editar un gasto' : 'Antes de agregar un gasto', previous);
    await persist(); formElement.reset(); $('#expenseDialog').close(); renderAll(); applyAccessMode();
    if (existing?.attachment?.path && attachment?.path !== existing.attachment.path) await deleteAttachment(id, existing.attachment).catch(() => {});
    showToast(existing ? `Egreso actualizado a ${fmtMoney.format(amount)}.` : `Egreso de ${fmtMoney.format(amount)} guardado en ${formatMonth(monthKey(date))}.`);
  } catch (error) {
    state = previous;
    if (attachment?.path && attachment.path !== existing?.attachment?.path) await supabase.storage.from(DOCUMENT_BUCKET).remove([attachment.path]).catch(() => {});
    renderAll(); applyAccessMode();
    showToast(error.message || 'No fue posible guardar el egreso en la nube.');
  }
}

async function attachmentFromForm(form, id, currentAttachment = null) {
  const file = form.get('evidence');
  if (!(file instanceof File) || !file.size) return currentAttachment;
  if (file.size > MAX_ATTACHMENT_SIZE) throw new Error('El respaldo supera el maximo permitido de 20 MB.');
  const path = await saveAttachment(id, file);
  return { name: file.name, type: file.type, size: file.size, path };
}

async function openAttachment(id, download) {
  if (!requireAdmin()) return;
  try {
    const file = await getAttachment(id);
    if (!file) {
      showToast('El archivo no esta disponible en este navegador.');
      return;
    }
    const url = URL.createObjectURL(file);
    const link = document.createElement('a');
    link.href = url;
    if (download) link.download = file.name || 'respaldo';
    else link.target = '_blank';
    link.rel = 'noopener';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch {
    showToast('No fue posible abrir el archivo de respaldo.');
  }
}

function showToast(message) {
  const toast = $('#toast');
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add('visible');
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 4200);
}

async function saveProperties() {
  if (!requireAdmin()) return;
  const previous = cloneData(state);
  $$('#propertyCards .property-card').forEach((card) => {
    const property = state.properties[Number(card.dataset.index)];
    $$('[data-field]', card).forEach((input) => property[input.dataset.field] = input.type === 'number' ? Number(input.value) : input.value);
  });
  try {
    saveRestorePoint('Antes de editar propiedades', previous);
    await persist(); renderAll(); applyAccessMode(); showToast('Propiedades guardadas en la nube.');
  } catch (error) {
    state = previous; renderAll(); applyAccessMode();
    showToast(error.message || 'No fue posible guardar las propiedades.');
  }
}

async function saveMortgages() {
  if (!requireAdmin()) return;
  const previous = cloneData(state);
  $$('#mortgageCards .property-card').forEach((card) => {
    const mortgage = state.mortgages[Number(card.dataset.index)];
    $$('[data-field]', card).forEach((input) => mortgage[input.dataset.field] = input.type === 'number' ? Number(input.value) : input.value);
  });
  try {
    saveRestorePoint('Antes de editar dividendos', previous);
    await persist(); renderAll(); applyAccessMode(); showToast('Dividendos guardados en la nube.');
  } catch (error) {
    state = previous; renderAll(); applyAccessMode();
    showToast(error.message || 'No fue posible guardar los dividendos.');
  }
}

async function exportBackup() {
  if (!requireAdmin()) return;
  const attachments = {};
  for (const row of [...state.income, ...state.expenses].filter((item) => item.attachment)) {
    try {
      const file = await getAttachment(row.id);
      if (file) attachments[row.id] = { name: file.name, type: file.type, data: await fileToDataUrl(file) };
    } catch {
      // The financial records remain usable even if an old local file is unavailable.
    }
  }
  const backup = { formatVersion: BACKUP_FORMAT_VERSION, exportedAt: new Date().toISOString(), state: validateState(state), attachments };
  downloadFile(`respaldo-administracion-${new Date().toISOString().slice(0,10)}.json`, JSON.stringify(backup, null, 2), 'application/json');
  showToast('Respaldo completo generado.');
}

async function importBackup(event) {
  if (!requireAdmin()) return;
  const file = event.target.files[0];
  if (!file) return;
  try {
    if (file.size > 140 * 1024 * 1024) throw new Error('El archivo de respaldo supera el límite de 140 MB.');
    const backup = validateBackupDocument(JSON.parse(await file.text()));
    if (!confirm(`El respaldo contiene ${backup.state.income.length} ingresos, ${backup.state.expenses.length} gastos y ${Object.keys(backup.attachments).length} archivos. ¿Reemplazar los datos actuales?`)) return;
    const previous = cloneData(state);
    saveRestorePoint('Antes de importar un respaldo', previous);
    const uploadedPaths = [];
    const importedState = backup.state;
    for (const [id, attachment] of Object.entries(backup.attachments || {})) {
      const attachmentFile = dataUrlToFile(attachment.data, attachment.name, attachment.type);
      const path = await saveAttachment(id, attachmentFile);
      uploadedPaths.push(path);
      const record = [...importedState.income, ...importedState.expenses].find((item) => item.id === id);
      if (record) record.attachment = { name: attachment.name, type: attachment.type, size: attachmentFile.size, path };
    }
    state = importedState;
    try {
      await persist();
    } catch (error) {
      state = previous;
      if (uploadedPaths.length) await supabase.storage.from(DOCUMENT_BUCKET).remove(uploadedPaths).catch(() => {});
      throw error;
    }
    renderAll(); applyAccessMode();
    showToast('Respaldo importado y sincronizado en la nube.');
  } catch (error) {
    showToast(error.message || 'El archivo de respaldo no es valido.');
  } finally {
    event.target.value = '';
  }
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function dataUrlToFile(dataUrl, name, type) {
  const [header, encoded] = dataUrl.split(',');
  const mime = type || header.match(/data:([^;]+)/)?.[1] || 'application/octet-stream';
  const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
  return new File([bytes], name || 'respaldo', { type: mime });
}

function monthlyRows() {
  return [['Propiedad','Ingreso mes','Gasto mes','Resultado mes'], ...state.properties.map((property) => {
    const income = sum(byMonth(state.income).filter((row) => row.propertyId === property.id && row.status === 'Pagado'));
    const expenses = sum(byMonth(state.expenses).filter((row) => row.propertyId === property.id && row.status === 'Pagado'));
    return [propertyName(property.id), income, expenses, income - expenses];
  })];
}

function cashFlowRows() {
  return [['Mes','Ingresos','Egresos','Flujo mensual','Saldo acumulado'], ...cashFlowByMonth().map((row) => [formatMonth(row.month), row.income, row.expenses, row.net, row.accumulated])];
}

function alertRows() {
  return [['Propiedad','Banco','Operacion','Fecha vencimiento','Dias restantes','Dividendo UF','Dividendo CLP'], ...upcomingMortgages(90).map((item) => [propertyName(item.propertyId), item.bank, item.operation, item.dueDate, item.daysLeft, item.referenceDividendUf || 0, item.referenceDividendClp || 0])];
}

function allRows() {
  return [['Tipo','Fecha','Propiedad','Categoria/Arrendatario','Detalle','Monto','Estado','Respaldo'], ...state.income.map((row) => ['Ingreso', row.date, propertyName(row.propertyId), row.tenant || '', row.notes || '', row.amount || 0, row.status, row.attachment?.name || '']), ...state.expenses.map((row) => ['Gasto', row.date, propertyName(row.propertyId), row.category || '', row.detail || '', row.amount || 0, row.status, row.attachment?.name || ''])];
}

function downloadCsv(filename, rows) {
  const csv = rows.map((row) => row.map((cell) => `"${String(safeCsvCell(cell) ?? '').replaceAll('"', '""')}"`).join(',')).join('\n');
  downloadFile(filename, csv, 'text/csv;charset=utf-8');
}

function downloadFile(filename, contents, type) {
  const blob = new Blob([contents], { type });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/'/g, '&#39;');
}

boot();

