import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderContentDoc } from './typst-generator';

function positions(source: string, selector = '<picture>') {
  const result = spawnSync('typst', ['query', '--root', '/', '--font-path', 'fonts', '--package-path', 'typst-packages', '-', selector, '--field', 'value'], { input: source, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout) as Array<{ page: number; code?: string }>;
}
for (const mode of ['per', 'shared']) for (const keep of [false, true]) test(`${mode}: joined photo rows paginate even with inherited keep-together=${keep}`, () => {
  const directory = mkdtempSync(join(tmpdir(), 'report-photos-'));
  try {
    const path = join(directory, 'picture.svg');
    writeFileSync(path, '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="blue"/></svg>');
    let source = renderContentDoc({ cover: { ctx: {}, layout_options: { suppress_title: true }, groups: [
      { id: 'before', label: '', hide_title: true, layout: 'vertical', fields: [{ id: 'sp', code: 'sp', type: 'spacer', label: '', spacer_height: '11cm' }] },
      { id: 'photos', label: '', hide_title: true, layout: 'vertical', section_role: 'images', style: { keep_together: keep },
        image_layout: { seamless: true, cols: 2, width_cm: 6, height_cm: 7, title_mode: mode, shared_title: 'Photos' },
        fields: Array.from({ length: 4 }, (_, i) => ({ id: `p${i}`, code: `p${i}`, label: `Photo${i}`, type: 'image', image_photos: [{ server_path: path }] })) },
    ] }, projects: [] } as any);
    source = source.replace('#let data =', '#show image: it => [#context [#metadata((page: here().position().page)) <picture>]#it]\n#let data =');
    assert.deepEqual(positions(source).map(p => p.page), [1, 1, 2, 2]);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('project pagination supports both new-page and continuous flow without mutating the document', () => {
  for (const page_break of [undefined, false, true]) {
    const section = (id: string) => ({ ctx: {}, groups: [{ id, label: '', hide_title: true, layout: 'vertical', fields: [{ id, code: id, type: 'text', label: id, binding: { source: 'literal', text: id } }] }] });
    const doc: any = { cover: section('cover'), projects: [{ ...section('one'), title: 'One', page_break }, { ...section('two'), title: 'Two', page_break }] };
    const before = JSON.stringify(doc);
    const markers = positions(renderContentDoc(doc), '<__fepos__>');
    const one = markers.find(m => m.code === 'proj0::one')!;
    const two = markers.find(m => m.code === 'proj1::two')!;
    assert.equal(two.page > one.page, page_break !== false);
    assert.equal(JSON.stringify(doc), before);
  }
});
