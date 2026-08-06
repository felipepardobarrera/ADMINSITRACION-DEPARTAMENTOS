const DATA_URL = './data/properties.json';
const STORAGE_KEY = 'administracion-departamentos-v1';
const MONTH_FILTER_KEY = 'administracion-departamentos-mes';
const fmtMoney = new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 });
const fmtDate = new Intl.DateTimeFormat('es-CL', { dateStyle: 'medium' });
const fmtMonth = new Intl.DateTimeFormat('es-CL', { month: 'short', year: 'numeric' });
let state;
let toastTimer;
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

async function boot() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    state = JSON.parse(saved);
  } else {
    state = await fetch(DATA_URL).then((r) => r.json());
    persist();
  }
  $('#monthFilter').value = localStorage.getItem(MONTH_FILTER_KEY) || latestActivityMonth() || currentMonth();
  bindEvents();
  renderAll();
}

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function latestActivityMonth() {
  return [...state.income, ...state.expenses].map((row) => monthKey(row.date)).filter(Boolean).sort().at(-1) || '';
}

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
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
  const copy = new Date(date);
  copy.setMonth(copy.getMonth() + months);
  return copy;
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

function cashFlowByMonth() {
  const months = new Map();
  const ensureMonth = (key) => {
    if (!months.has(key)) months.set(key, { month: key, income: 0, expenses: 0, net: 0, accumulated: 0 });
    return months.get(key);
  };

  paid(state.income).forEach((row) => {
    const key = monthKey(row.date);
    if (key) ensureMonth(key).income += Number(row.amount || 0);
  });
  paid(state.expenses).forEach((row) => {
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
  renderProperties();
  renderMortgages();
  renderIncome();
  renderExpenses();
  renderReports();
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
    return `<article class="alert-card ${cls}"><strong>${item.bank} ${item.operation} - ${propertyName(item.propertyId)}</strong><p>Vence ${date}. Faltan ${item.daysLeft} dias. Dividendo referencial: ${amount}.</p></article>`;
  }).join('');
}

function renderPropertyResults() {
  const rows = state.properties.map((property) => {
    const income = sum(byMonth(state.income).filter((row) => row.propertyId === property.id && row.status === 'Pagado'));
    const expenses = sum(byMonth(state.expenses).filter((row) => row.propertyId === property.id && row.status === 'Pagado'));
    return `<tr><td>${propertyName(property.id)}</td><td class="numeric">${fmtMoney.format(income)}</td><td class="numeric">${fmtMoney.format(expenses)}</td><td class="numeric">${fmtMoney.format(income - expenses)}</td></tr>`;
  });
  $('#propertyResults').innerHTML = rows.join('');
}

function renderProperties() {
  $('#propertyCards').innerHTML = state.properties.map((property, index) => `
    <article class="property-card" data-index="${index}">
      <div class="card-head"><div><h3>${propertyName(property.id)}</h3><span class="badge">${property.status}</span></div><strong>${property.role}</strong></div>
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
      <div class="card-head"><div><h3>${mortgage.bank} ${mortgage.operation}</h3><span class="badge">${propertyName(mortgage.propertyId)}</span></div><strong>${fmtDate.format(due)}</strong></div>
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
  $('#incomeRows').innerHTML = [...state.income].sort((a, b) => b.date.localeCompare(a.date)).map((row) => `<tr><td>${row.date}</td><td>${propertyName(row.propertyId)}</td><td>${escapeHtml(row.tenant || '')}</td><td class="numeric">${fmtMoney.format(row.amount || 0)}</td><td>${row.status}</td><td>${escapeHtml(row.notes || '')}</td><td><button class="danger" data-delete-income="${row.id}" type="button">Eliminar</button></td></tr>`).join('');
}

function renderExpenses() {
  $('#expenseRows').innerHTML = [...state.expenses].sort((a, b) => b.date.localeCompare(a.date)).map((row) => `<tr><td>${row.date}</td><td>${propertyName(row.propertyId)}</td><td>${escapeHtml(row.category || '')}</td><td>${escapeHtml(row.detail || '')}</td><td class="numeric">${fmtMoney.format(row.amount || 0)}</td><td>${row.status}</td><td><button class="danger" data-delete-expense="${row.id}" type="button">Eliminar</button></td></tr>`).join('');
}

function renderReports() {
  $('#reportProperties').textContent = state.properties.length;
  $('#reportMortgageUf').textContent = state.mortgages.reduce((t, m) => t + Number(m.referenceDividendUf || 0), 0).toLocaleString('es-CL', { maximumFractionDigits: 4 });
  $('#reportExpectedRent').textContent = fmtMoney.format(state.properties.reduce((t, p) => t + Number(p.monthlyRent || 0), 0));
  $('#reportExpensesAll').textContent = fmtMoney.format(sum(state.expenses));
}

function fillPropertyOptions() {
  $$('select[name="propertyId"]').forEach((select) => {
    select.innerHTML = state.properties.map((property) => `<option value="${property.id}">${propertyName(property.id)}</option>`).join('');
  });
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
  $$('[data-open]').forEach((button) => button.addEventListener('click', () => $(`#${button.dataset.open}`).showModal()));
  $$('[data-close]').forEach((button) => button.addEventListener('click', () => button.closest('dialog').close()));
  $('#incomeForm').addEventListener('submit', addIncome);
  $('#expenseForm').addEventListener('submit', addExpense);
  $('#saveProperties').addEventListener('click', saveProperties);
  $('#saveMortgages').addEventListener('click', saveMortgages);
  $('#exportBackup').addEventListener('click', exportBackup);
  $('#importBackup').addEventListener('change', importBackup);
  $('#downloadMonthly').addEventListener('click', () => downloadCsv('resultado-mensual.csv', monthlyRows()));
  $('#downloadCashflow').addEventListener('click', () => downloadCsv('flujo-de-caja.csv', cashFlowRows()));
  $('#downloadCalendar').addEventListener('click', () => downloadCsv('vencimientos.csv', alertRows()));
  $('#downloadAll').addEventListener('click', () => downloadCsv('administracion-completa.csv', allRows()));
  document.addEventListener('click', (event) => {
    const incomeId = event.target.dataset.deleteIncome;
    const expenseId = event.target.dataset.deleteExpense;
    if (incomeId) { state.income = state.income.filter((row) => row.id !== incomeId); persist(); renderAll(); }
    if (expenseId) { state.expenses = state.expenses.filter((row) => row.id !== expenseId); persist(); renderAll(); }
  });
}

function addIncome(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const date = form.get('date');
  const amount = Number(form.get('amount'));
  state.income.push({ id: crypto.randomUUID(), date, propertyId: form.get('propertyId'), tenant: form.get('tenant'), amount, status: form.get('status'), notes: form.get('notes') });
  $('#monthFilter').value = monthKey(date);
  localStorage.setItem(MONTH_FILTER_KEY, monthKey(date));
  persist(); event.currentTarget.reset(); $('#incomeDialog').close(); renderAll();
  showToast(`Ingreso de ${fmtMoney.format(amount)} guardado en ${formatMonth(monthKey(date))}.`);
}

function addExpense(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const date = form.get('date');
  const amount = Number(form.get('amount'));
  state.expenses.push({ id: crypto.randomUUID(), date, propertyId: form.get('propertyId'), category: form.get('category'), vendor: form.get('vendor'), detail: form.get('detail'), amount, status: form.get('status') });
  $('#monthFilter').value = monthKey(date);
  localStorage.setItem(MONTH_FILTER_KEY, monthKey(date));
  persist(); event.currentTarget.reset(); $('#expenseDialog').close(); renderAll();
  showToast(`Egreso de ${fmtMoney.format(amount)} guardado en ${formatMonth(monthKey(date))}.`);
}

function showToast(message) {
  const toast = $('#toast');
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add('visible');
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 4200);
}

function saveProperties() {
  $$('#propertyCards .property-card').forEach((card) => {
    const property = state.properties[Number(card.dataset.index)];
    $$('[data-field]', card).forEach((input) => property[input.dataset.field] = input.type === 'number' ? Number(input.value) : input.value);
  });
  persist(); renderAll();
}

function saveMortgages() {
  $$('#mortgageCards .property-card').forEach((card) => {
    const mortgage = state.mortgages[Number(card.dataset.index)];
    $$('[data-field]', card).forEach((input) => mortgage[input.dataset.field] = input.type === 'number' ? Number(input.value) : input.value);
  });
  persist(); renderAll();
}

function exportBackup() {
  downloadFile(`respaldo-administracion-${new Date().toISOString().slice(0,10)}.json`, JSON.stringify(state, null, 2), 'application/json');
}

async function importBackup(event) {
  const file = event.target.files[0];
  if (!file) return;
  state = JSON.parse(await file.text());
  persist(); renderAll(); event.target.value = '';
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
  return [['Tipo','Fecha','Propiedad','Categoria/Arrendatario','Detalle','Monto','Estado'], ...state.income.map((row) => ['Ingreso', row.date, propertyName(row.propertyId), row.tenant || '', row.notes || '', row.amount || 0, row.status]), ...state.expenses.map((row) => ['Gasto', row.date, propertyName(row.propertyId), row.category || '', row.detail || '', row.amount || 0, row.status])];
}

function downloadCsv(filename, rows) {
  const csv = rows.map((row) => row.map((cell) => `"${String(cell ?? '').replaceAll('"', '""')}"`).join(',')).join('\n');
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
