import assert from 'node:assert/strict';
import type { FieldGroup, RecordTemplate } from './types';
import { buildFieldDefaults, createEmptyMatrixValue, flattenMatrixValuesToFlatData, applyMatrixSummaryFormulas, applyMatrixCellFormulas } from './matrix-flatten.ts';
import { projectLegacyMatrices } from './legacy-matrix-bridge.ts';

/** Compare old/new actual computation, including deliberately distinct values to catch swapped coordinates. */
export function verifyMatrixMigration(before: FieldGroup[], after: FieldGroup[]): number {
  const oldTemplate = { groups: before } as RecordTemplate;
  const newTemplate = { groups: after } as RecordTemplate;
  let comparisons = 0;
  for (const filled of [false, true]) {
    const oldRaw: Record<string, any> = {}, newRaw = buildFieldDefaults(newTemplate);
    for (const old of before.flatMap(g => g.fields)) {
      const next = after.flatMap(g => g.fields).find(f => f.id === old.id && f.code === old.code);
      assert.ok(next, `字段标识丢失 ${old.code}`);
      if (old.type !== 'data_matrix') { assert.deepEqual(next, old); continue; }
      assert.deepEqual(next.legacy_matrix!.config, old.matrix);
      const value = createEmptyMatrixValue(old.matrix!);
      const newValue = newRaw[old.code] ||= {};
      oldRaw[old.code] = value;
      for (const [i, k] of Object.keys(value.cells).entries()) {
        if (filled) value.cells[k] = (i * 13 + 1.237) / 7;
        if (value.cells[k] !== undefined) newValue[next.legacy_matrix!.keys[k]] = value.cells[k];
      }
      for (const s of old.matrix!.summary_rows || []) {
        if (s.source_type.startsWith('input_')) {
          const v = filled ? s.source_type === 'input_choice' ? s.choices?.[0] || '' : s.source_type === 'input_number' ? 17.21 : '汇总文字验证' : s.default_value;
          if (s.per_column) for (const p of old.matrix!.parameters) {
            (value.summary_row_inputs ||= {})[`${s.id}__${p.code}`] = v;
            newValue[next.legacy_matrix!.keys[`summary__${s.id}__${p.code}`]] = v;
          } else if (v !== undefined) { (value.summary_inputs ||= {})[s.id] = v; newValue[next.legacy_matrix!.keys[`summary__${s.id}`]] = v; }
        }
      }
      for (const s of old.matrix!.summary_cols || []) if (s.source_type.startsWith('input_') && filled) {
        for (const sid of value.sample_ids) {
          const v = s.source_type === 'input_number' ? 31.23 : s.source_type === 'input_choice' ? s.choices?.[0] || '' : '列文字验证';
          (value.sumcol_inputs ||= {})[`${s.id}__${sid}`] = v;
          newValue[next.legacy_matrix!.keys[`sumcol__${s.id}__${sid}`]] = v;
        }
      }
    }
    const oldFlat = applyMatrixSummaryFormulas(oldTemplate, applyMatrixCellFormulas(oldTemplate, flattenMatrixValuesToFlatData(oldTemplate, oldRaw)));
    const newFlat = projectLegacyMatrices(newTemplate, newRaw).flat;
    for (const f of after.flatMap(g => g.fields)) if (f.legacy_matrix) {
      for (const old of Object.keys(f.legacy_matrix.keys)) {
        const key = `${f.code}__${old}`;
        const a = oldFlat[key], b = newFlat[key];
        if ((a == null || a === '') && (b == null || b === '')) continue;
        if (a !== '' && b !== '' && a != null && b != null && Number.isFinite(Number(a)) && Number.isFinite(Number(b))) {
          assert.ok(Math.abs(Number(a) - Number(b)) < 1e-10, `${key}: 计算不同 ${a} / ${b}`);
        } else assert.deepEqual(b, a, `${key}: 内容不同`);
        comparisons++;
      }
    }
  }
  return comparisons;
}
