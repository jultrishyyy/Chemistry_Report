import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { buildProjectGroupsFromRecord } from './report-inherit';
import { generateMockData } from './mock-data';
import { readSampleAxes, sampleAxesKey } from './free-grid-samples';
import { renderFreeGridTypst } from './typst-generator';
import { bindSelectedSampleRange } from './free-grid-direct-binding';
import type { FieldDefinition, RecordTemplate } from './types';

for (const axis of ['row', 'col'] as const) {
  const k = (r: string, c: string) => axis === 'row' ? `${r}::${c}` : `${c}::${r}`;
  const axes = (samples: string[], params: string[]) => ({
    rows: (axis === 'row' ? samples : params).map(id => ({ id })),
    columns: (axis === 'row' ? params : samples).map(id => ({ id, label: '' })), cells: {},
  });
  const source: FieldDefinition = { id: 'source', code: 'source', type: 'free_grid', label: 'Source', free_table: {
    ...axes(['s1', 's2', 's3'], ['value']),
    input_cells: Object.fromEntries(['s1', 's2', 's3'].map(ref => [k(ref, 'value'), true])),
    cell_types: Object.fromEntries(['s1', 's2', 's3'].map(ref => [k(ref, 'value'), 'number' as const])),
    sample_bands: [{ id: 'samples', axis, refs: ['s1', 's2', 's3'] }],
  } };
  const record = { name: 'Record', groups: [{ id: 'g', label: 'G', fields: [source] }] } as RecordTemplate;
  const report = (): FieldDefinition => {
    const field: FieldDefinition = { id: 'target', code: 'target', label: 'Target', type: 'free_grid', free_table: {
      ...axes(['header', 't1', 't2', 't3'], ['value', 'average', 'conclusion']),
      cells: { [k('header', 'value')]: 'Result' },
      spans: Object.fromEntries(['average', 'conclusion'].map(col => [k('t1', col), axis === 'row' ? { rowspan: 3, colspan: 1 } : { rowspan: 1, colspan: 3 }])),
      cell_bindings: { [k('t1', 'average')]: { source: 'literal', text: 'AverageShared' }, [k('t1', 'conclusion')]: { source: 'literal', text: 'ConclusionShared' } },
    } };
    Object.assign(field.free_table!, bindSelectedSampleRange(field.free_table!, ['t1', 't2', 't3'].map(ref => k(ref, 'value')), source,
      { source: 'record_free_cell_sample', field_code: 'source', cell_key: k('s1', 'value') }));
    return field;
  };
  test(`${axis}: legacy records without sample metadata omit unfilled template axes`, () => {
    const field = buildProjectGroupsFromRecord(record).groups[0].fields[0];
    const raw = { [`${k('s1', 'value')}::s0`]: 'FilledFirst', [`${k('s2', 'value')}::s0`]: 0,
      [`${k('s3', 'value')}::s0`]: '' };
    const output = renderFreeGridTypst(field, field.free_table!, undefined, { linked_record_template: record, record_raw_data: { source: raw } });
    assert.match(output, /FilledFirst/);
    assert.doesNotMatch(output, /s3#/);
    assert.match(output, /[\[\]]0\]/);
  });
  test(`${axis}: preview shows three samples, with shared merged values spanning all three`, () => {
    const mock = generateMockData(record);
    assert.equal(readSampleAxes(mock.source, 'samples')!.length, 3);
    const field = report();
    const output = renderFreeGridTypst(field, field.free_table!, undefined, { linked_record_template: record, record_raw_data: mock });
    for (const ref of ['s1', 's2', 's3']) assert.ok(output.includes(mock.source[`${k(ref, 'value')}::s0`]));
    assert.equal((output.match(new RegExp(`${axis === 'row' ? 'rowspan' : 'colspan'}: 3`, 'g')) || []).length, 2);
    assert.equal((output.match(/AverageShared/g) || []).length, 1);
    assert.equal((output.match(/ConclusionShared/g) || []).length, 1);
  });
  test(`${axis}: empty samples are omitted without shifting values or shared merges`, () => {
    const raw: Record<string, unknown> = {
      [sampleAxesKey('samples')]: Array.from({ length: 5 }, (_, sample) => ({ ref: `s${Math.min(sample + 1, 3)}`, sample })),
      [`${k('s1', 'value')}::s0`]: '',
      [`${k('s2', 'value')}::s1`]: 0,
      [`${k('s3', 'value')}::s2`]: '  ',
      [`${k('s3', 'value')}::s3`]: 'LastMeasured',
      [`${k('s3', 'value')}::s4`]: null,
    };
    for (const indices of [undefined, [1, 3], [2], []]) {
      const field = report();
      if (indices) field.free_table!.sample_bands![0].sample_filter = { mode: 'indices', indices };
      const output = renderFreeGridTypst(field, field.free_table!, undefined, { linked_record_template: record, record_raw_data: { source: raw } });
      const nonempty = !indices || indices.includes(1);
      assert.equal(output.includes('LastMeasured'), nonempty);
      assert.equal(output.includes('AverageShared'), nonempty);
      assert.equal(output.includes('ConclusionShared'), nonempty);
      if (nonempty) {
        assert.match(output, /[\[\]]0\]/);
        assert.equal((output.match(new RegExp(`${axis === 'row' ? 'rowspan' : 'colspan'}: 2`, 'g')) || []).length, 2);
      }
      const pdf = spawnSync('typst', ['compile', '-', '-'], { input: output, maxBuffer: 5 * 1024 * 1024 });
      assert.equal(pdf.status, 0, pdf.stderr.toString());
    }
  });
  test(`${axis}: four/five actual samples resize both shared merges; filters retain anchor content`, () => {
    for (const count of [4, 5]) for (const filter of [undefined, [1], [1, 3], []]) {
      const field = report();
      if (filter) field.free_table!.sample_bands![0].sample_filter = { mode: 'indices', indices: filter };
      const raw: Record<string, unknown> = { [sampleAxesKey('samples')]: Array.from({ length: count }, (_, sample) => ({ ref: `s${Math.min(sample + 1, 3)}`, sample: Math.max(0, sample - 2) })) };
      for (let i = 0; i < count; i++) raw[`${k(`s${Math.min(i + 1, 3)}`, 'value')}::s${Math.max(0, i - 2)}`] = `Measured${i}`;
      const original = JSON.stringify({ field, raw });
      const output = renderFreeGridTypst(field, field.free_table!, undefined, { linked_record_template: record, record_raw_data: { source: raw } });
      const indices = filter || Array.from({ length: count }, (_, i) => i);
      assert.deepEqual(output.match(/Measured\d/g) || [], indices.map(i => `Measured${i}`));
      if (indices.length > 1) assert.equal((output.match(new RegExp(`${axis === 'row' ? 'rowspan' : 'colspan'}: ${indices.length}`, 'g')) || []).length, 2);
      assert.equal((output.match(/AverageShared/g) || []).length, indices.length ? 1 : 0);
      assert.equal((output.match(/ConclusionShared/g) || []).length, indices.length ? 1 : 0);
      assert.equal(JSON.stringify({ field, raw }), original);
      const pdf = spawnSync('typst', ['compile', '-', '-'], { input: output, maxBuffer: 5 * 1024 * 1024 });
      assert.equal(pdf.status, 0, pdf.stderr.toString());
      assert.equal(pdf.stdout.subarray(0, 5).toString(), '%PDF-');
    }
  });
}
