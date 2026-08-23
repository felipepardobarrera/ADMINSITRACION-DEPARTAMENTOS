import assert from 'node:assert/strict';
import test from 'node:test';
import { BACKUP_FORMAT_VERSION, safeCsvCell, validateBackupDocument, validateState } from '../backup-utils.js';

const validState = {
  properties: [{ id: 'DEP-1', unit: '1' }],
  mortgages: [{ id: 'HIP-1', propertyId: 'DEP-1', firstDueDate: '2026-01-31', referenceDividendUf: 10 }],
  income: [{ id: 'ING-1', propertyId: 'DEP-1', date: '2026-08-01', amount: 500000 }],
  expenses: [{ id: 'GAS-1', propertyId: 'DEP-1', date: '2026-08-02', amount: 250000 }],
};

test('acepta y clona un estado válido', () => {
  const result = validateState(validState);
  assert.deepEqual(result, validState);
  assert.notEqual(result, validState);
});

test('rechaza movimientos asociados a propiedades inexistentes', () => {
  const invalid = structuredClone(validState);
  invalid.expenses[0].propertyId = 'NO-EXISTE';
  assert.throws(() => validateState(invalid), /propiedad.*no existe/i);
});

test('rechaza versiones futuras y adjuntos huérfanos', () => {
  assert.throws(() => validateBackupDocument({ formatVersion: BACKUP_FORMAT_VERSION + 1, state: validState }), /no compatible/i);
  assert.throws(() => validateBackupDocument({ state: validState, attachments: { otro: { data: 'data:text/plain;base64,QQ==' } } }), /no corresponde/i);
});

test('neutraliza fórmulas peligrosas al exportar CSV', () => {
  assert.equal(safeCsvCell('=HYPERLINK("https://example.com")'), '\'=HYPERLINK("https://example.com")');
  assert.equal(safeCsvCell('Texto normal'), 'Texto normal');
  assert.equal(safeCsvCell(-1200), -1200);
});
