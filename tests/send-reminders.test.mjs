import assert from 'node:assert/strict';
import test from 'node:test';
import { buildEmail, nextDueDate } from '../scripts/send-reminders.mjs';

test('calcula correctamente vencimientos al final de mes', () => {
  const mortgage = { firstDueDate: '2026-01-31', dueDay: 31 };
  assert.equal(nextDueDate(mortgage, new Date(2026, 1, 1)).toISOString().slice(0, 10), '2026-02-28');
  assert.equal(nextDueDate(mortgage, new Date(2026, 1, 28)).toISOString().slice(0, 10), '2026-02-28');
  assert.equal(nextDueDate(mortgage, new Date(2026, 2, 1)).toISOString().slice(0, 10), '2026-03-31');
});

test('escapa datos editables en el correo HTML', () => {
  const html = buildEmail([{ mortgage: { bank: '<script>', operation: '1', referenceDividendClp: 100 }, property: { unit: '507', address: 'A & B' }, dueDate: new Date(2026, 7, 5) }], 3);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /A &amp; B/);
});
