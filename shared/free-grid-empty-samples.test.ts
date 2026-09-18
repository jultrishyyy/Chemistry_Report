import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sampleHasEnteredData } from './free-grid-binding';
import type { FieldDefinition } from './types';

for (const axis of ['row', 'col'] as const) {
  test(`${axis}: presence uses entered values across the source sample, excluding template and derived metadata`, () => {
    const key = (s: string, p: string) => axis === 'row' ? `${s}::${p}` : `${p}::${s}`;
    const params = ['value', 'other', 'formula', 'index', 'header', 'fixed', 'outside'];
    const ft: NonNullable<FieldDefinition['free_table']> = {
      rows: (axis === 'row' ? ['s'] : params).map(id => ({ id })),
      columns: (axis === 'row' ? params : ['s']).map(id => ({ id, label: '' })),
      cells: { [key('s', 'value')]: 'TemplateDefault' },
      sample_bands: [{ id: 'samples', axis, refs: ['s'], cross_refs: params.filter(p => p !== 'outside') }],
      cell_formulas: { [key('s', 'formula')]: { type: 'sum', sources: [] } },
      sample_index_cells: { [key('s', 'index')]: true },
      header_cells: { [key('s', 'header')]: true },
      fixed_text_cells: { [key('s', 'fixed')]: true },
    };
    const metadata = {
      '__sample_count__::samples': 3,
      [`${key('s', 'value')}::s1::__unit__`]: 'mm',
      [`${key('s', 'index')}::s1`]: 2,
      [`${key('s', 'header')}::s1`]: 'Header',
      [`${key('s', 'fixed')}::s1`]: 'Fixed',
      [`${key('s', 'outside')}::s1`]: 'Shared value',
      [`${key('s', 'formula')}::s1`]: 0,
    };
    for (const ref of [undefined, 's']) {
      const has = (raw: Record<string, unknown>) => sampleHasEnteredData(ft, raw, 'samples', 1, ref);
      assert.equal(has(metadata), false);
      for (const value of ['', ' \n ', null, undefined, []]) assert.equal(has({ ...metadata, [`${key('s', 'value')}::s1`]: value }), false);
      for (const value of [0, '0', false, 'Text', ['Choice']]) assert.equal(has({ ...metadata, [`${key('s', 'other')}::s1`]: value }), true);
      assert.equal(has({ ...metadata, [`__formula_override__::${key('s', 'formula')}::s1`]: { value: 0 } }), true);
      assert.equal(has({ [key('s', 'value')]: 'LegacyValue' }), true);
      assert.equal(has({ [key('s', 'value')]: 'LegacyValue', [`${key('s', 'value')}::s1`]: '' }), false);
      assert.equal(has({ [`${key('s', 'value')}::s0`]: 'OtherSample' }), false);
    }
  });
}
