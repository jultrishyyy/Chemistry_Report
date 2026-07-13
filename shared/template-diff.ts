/**
 * 模板字段定义 diff（前后端共用，单一事实来源）
 *
 * 配对规则：分组按 group.id、字段按 field.id（编辑器保证 id 稳定：增删/拖拽/改名都不变）。
 * 同 id 改 label/code 因此被识别为"修改"而非"删一个+加一个"。
 * 字段内部做属性级 diff：逐属性列出 from → to，合规审计要的就是
 * "这版相对上版动了哪个字段的哪个属性"。
 *
 * 注意：migration 014 时代存量 diff_from_prev 是旧格式 {key, kind, from, to}
 * （按 groupLabel/fieldCode 配对、无属性明细）。渲染端（TemplateVersionPanel
 * 的 HistoryDrawer）对两种格式都要兼容。
 */
import type { FieldGroup, FieldDefinition } from './types.js';

export interface FieldPropChange {
  prop: string;       // FieldDefinition 属性名，或特殊值 '__group__'（字段被移到了别的分区）
  from: any;
  to: any;
}

export interface TemplateFieldDiff {
  kind: 'added' | 'removed' | 'changed';
  fieldId: string;
  fieldLabel: string;
  groupLabel: string;
  /** kind === 'changed' 时的属性级明细 */
  changes?: FieldPropChange[];
  /** added/removed 时的完整字段定义（供 UI 展开查看） */
  field?: FieldDefinition;
}

/** 属性名 → 中文标签（UI 展示用；未列出的属性按原名显示） */
export const FIELD_PROP_LABELS: Record<string, string> = {
  __group__: '所属分区',
  label: '标签',
  code: '编码',
  type: '类型',
  unit: '单位',
  required: '必填',
  default_value: '默认值',
  options: '选项',
  allow_custom: '允许自定义输入',
  formula: '公式',
  matrix: '数据矩阵配置',
  description: '说明',
  example_value: '示例值',
  style: '格式',
  binding: '取值绑定',
  semantic_role: '自动填充来源',
  hide_label: '隐藏标签',
  rich: '富文本',
  variants: '变体',
  image_phase: '拍摄阶段',
  allow_multiple: '允许多张',
  image_size: '图片尺寸',
  image_layout: '图片布局',
  image_row_ratio: '行内占比',
  image_table_style: '图片表格样式',
  conclusion_table: '结论表配置',
  result_table: '结果表配置',
  equipment_table: '设备表配置',
  image_gallery: '图片表配置',
  allow_override: '允许覆盖',
  store_in_record: '存入记录',
  removable: '录入可删',
};

interface FlatField {
  field: FieldDefinition;
  groupLabel: string;
}

function flatten(groups: FieldGroup[] | null | undefined): Map<string, FlatField> {
  const out = new Map<string, FlatField>();
  for (const g of groups || []) {
    for (const f of (g as any).fields || []) {
      // id 缺失的极旧数据回退到 组/编码 作 key（与旧 diff 行为一致）
      const key = f.id || `${(g as any).label || (g as any).id}/${f.code || f.label}`;
      out.set(key, { field: f, groupLabel: (g as any).label || (g as any).id || '' });
    }
  }
  return out;
}

const same = (a: any, b: any) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** 计算两份 field_definitions 的字段级 + 属性级 diff */
export function diffFieldDefinitions(
  prev: FieldGroup[] | null | undefined,
  curr: FieldGroup[] | null | undefined
): TemplateFieldDiff[] {
  const a = flatten(prev);
  const b = flatten(curr);
  const diffs: TemplateFieldDiff[] = [];

  for (const [key, fb] of b) {
    const fa = a.get(key);
    if (!fa) {
      diffs.push({ kind: 'added', fieldId: key, fieldLabel: fb.field.label || fb.field.code || key, groupLabel: fb.groupLabel, field: fb.field });
      continue;
    }
    const changes: FieldPropChange[] = [];
    if (fa.groupLabel !== fb.groupLabel) {
      changes.push({ prop: '__group__', from: fa.groupLabel, to: fb.groupLabel });
    }
    const props = new Set([...Object.keys(fa.field), ...Object.keys(fb.field)]);
    props.delete('id');
    for (const p of props) {
      const va = (fa.field as any)[p];
      const vb = (fb.field as any)[p];
      if (!same(va, vb)) changes.push({ prop: p, from: va ?? null, to: vb ?? null });
    }
    if (changes.length) {
      diffs.push({
        kind: 'changed', fieldId: key,
        fieldLabel: fb.field.label || fb.field.code || key,
        groupLabel: fb.groupLabel, changes,
      });
    }
  }

  for (const [key, fa] of a) {
    if (!b.has(key)) {
      diffs.push({ kind: 'removed', fieldId: key, fieldLabel: fa.field.label || fa.field.code || key, groupLabel: fa.groupLabel, field: fa.field });
    }
  }

  return diffs;
}
