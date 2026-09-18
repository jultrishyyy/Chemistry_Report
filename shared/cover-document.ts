import type { FieldDefinition, RecordTemplate } from './types';
import { coverCanEditInline, coverGroupCanFlow, coverInlineValue } from './cover-template-editing';
import { encodeReportRichDocument, storedReportRichDocument } from './report-rich-document';

/** Transient, versioned editing projection. Never persist this over a legacy template. */
export interface CoverDocument {
  version: 1;
  source: RecordTemplate;
  sections: Array<{
    groupId: string;
    blocks: Array<{
      fieldId: string;
      kind: 'text' | 'image' | 'table' | 'spacer' | 'compatibility';
      /** Only text is editable in phase two. Other blocks retain their complete source. */
      value?: string;
    }>;
  }>;
}

function canProjectText(field: FieldDefinition): boolean {
  // A reference currently stores a binding, not field-level fallback/format semantics.
  // Keep those cases intact until the document renderer explicitly supports them.
  if (field.binding && field.binding.source !== 'literal' && field.default_value != null) return false;
  if (field.semantic_role || field.page_break_before) return false;
  // Legacy rich strings have a different whitespace grammar: no implicit migration.
  if (field.rich && field.binding?.source === 'literal' && !storedReportRichDocument(field.binding.text)) return false;
  return coverCanEditInline(field);
}

/** Lossless opening: retain source metadata, order, explicit spacers and special layouts. */
export function projectCoverDocument(template: RecordTemplate): CoverDocument {
  const source = structuredClone(template);
  const groupIds = new Set<string>();
  const sections = source.groups.map(group => {
    if (!group.id || groupIds.has(group.id)) throw new Error('分区编号重复或缺失，无法安全建立正文');
    groupIds.add(group.id);
    const ids = new Set<string>();
    const flow = coverGroupCanFlow(group);
    return { groupId: group.id, blocks: group.fields.map(field => {
      if (!field.id || ids.has(field.id)) throw new Error('字段编号重复或缺失，无法安全建立正文');
      ids.add(field.id);
      const base = { fieldId: field.id };
      if (!flow) return { ...base, kind: 'compatibility' as const };
      if (canProjectText(field)) return { ...base, kind: 'text' as const, value: coverInlineValue(field, source.layout_options?.theme_config?.label_weight !== 'regular') };
      if (field.type === 'spacer') return { ...base, kind: 'spacer' as const };
      if (field.type === 'static_content' && field.static_kind === 'images') return { ...base, kind: 'image' as const };
      if (field.type === 'static_content' && field.static_kind === 'table') return { ...base, kind: 'table' as const };
      return { ...base, kind: 'compatibility' as const };
    }) };
  });
  return { version: 1, source, sections };
}

/**
 * Phase-two writeback: text edits only, with stale-source and structure checks.
 * Reordering/deleting blocks needs an explicit later transaction, never inferred.
 * An untouched projection returns the exact current template (no migration/history entry).
 */
export function applyCoverDocument(current: RecordTemplate, document: CoverDocument): RecordTemplate {
  if (document.version !== 1) throw new Error('不支持的首页文档版本');
  if (JSON.stringify(current) !== JSON.stringify(document.source)) throw new Error('模板已变化，请重新打开正文后编辑');
  const initial = projectCoverDocument(current);
  const structure = (doc: CoverDocument) => doc.sections.map(section => ({
    ...section, blocks: section.blocks.map(({ value: _value, ...block }) => block),
  }));
  if (JSON.stringify(structure(document)) !== JSON.stringify(structure(initial))) throw new Error('正文结构已变化，不能覆盖原模板');
  let next: RecordTemplate | undefined;
  document.sections.forEach((section, gi) => section.blocks.forEach((block, fi) => {
    if (block.kind !== 'text') {
      if (block.value !== undefined) throw new Error('特殊版式不能转换为正文');
      return;
    }
    if (block.value === initial.sections[gi].blocks[fi].value) return;
    const rich = typeof block.value === 'string' ? storedReportRichDocument(block.value) : null;
    if (!rich || encodeReportRichDocument(rich) !== block.value) throw new Error('正文包含不支持的格式，未保存修改');
    next ??= structuredClone(current);
    const field = next.groups[gi].fields[fi];
    field.rich = true;
    field.hide_label = true;
    delete field.unit;
    field.binding = { source: 'literal', text: block.value! };
  }));
  return next || current;
}
