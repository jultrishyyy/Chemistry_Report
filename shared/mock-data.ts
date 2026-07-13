/**
 * mock-data.ts — 为模板编辑器预览生成示例数据
 *
 * 规则：
 * - 如果字段有 example_value，优先使用
 * - 否则按字段类型自动生成合理的示例值
 * - 矩阵字段生成完整的 cells + 公式计算结果
 */
import type { RecordTemplate, FieldDefinition, DataMatrixConfig } from './types';
import { matrixDataKey, createEmptyMatrixValue, flattenMatrixValuesToFlatData, applyMatrixCellFormulas, applyMatrixSummaryFormulas, applyPerCellFormulas } from './matrix-flatten';
import { execute, topologicalOrder } from './formula-engine';

/**
 * 示例图片目录【占位符】（不写死任何机器路径，可跨服务器部署）。
 *
 * mock 数据把图片 `server_path` 设成 `${MOCK_IMAGE_DIR}/xxx.png`，这串最终被嵌进 typst 源码里。
 * 由于 typst 源码是在【浏览器端】用本 shared 代码生成的，浏览器无从得知服务器上 samples 目录的真实位置，
 * 所以这里只放一个占位符；真正的磁盘绝对路径在【服务端编译 typst 时】由 typst-compiler 把本占位符替换成
 * 该服务器上的 `samples/sample-images` 绝对路径（见 server/src/services/typst-compiler.ts 的 resolveSamplePaths）。
 */
export const MOCK_IMAGE_DIR = '__SAMPLE_IMAGES__';

/** 一张示例照片（ImageItem 形状）。供模板编辑器预览的图片表/图库填样图。 */
export function mockPhotoItem(fname = 'before.png', alt = '示例-原样照片.png') {
  return { name: fname, server_path: `${MOCK_IMAGE_DIR}/${fname}`, url: '', original_name: alt };
}

function randomNum(min: number, max: number, decimals = 1): number {
  const v = min + Math.random() * (max - min);
  return Number(v.toFixed(decimals));
}

function mockFieldValue(field: FieldDefinition, idx = 0): any {
  if (field.example_value !== undefined && field.example_value !== null && field.example_value !== '') {
    return field.example_value;
  }

  switch (field.type) {
    case 'number':
      return randomNum(10, 100);
    case 'text':
      return field.default_value || `示例文本${idx ? idx : ''}`;
    case 'textarea':
      return field.default_value || '示例多行文本内容';
    case 'date':
      return new Date().toISOString().slice(0, 10);
    case 'select':
      return field.options?.[0] || '选项A';
    case 'checkbox':
      return field.options?.slice(0, 2) || ['选项A', '选项B'];
    case 'device_ref':
      // 预览期示例设备：对象带 name+code，展平时显示「设备名称：管理编号」（真实录入只存管理编号数组，
      // 由 deviceMap 反查名称）。
      return [
        { code: 'SHHX2018-G244(1-2)', name: '固相萃取真空装置' },
        { code: 'HX2007-G025', name: '电子分析天平' },
      ];
    case 'computed':
      return null; // will be computed later
    case 'image': {
      // 示例图片：按 image_phase（存量）或字段名里的关键字挑样图，缺省 before
      const lbl = field.label || '';
      const fname = (field.image_phase === 'during' || lbl.includes('中')) ? 'during.png'
        : (field.image_phase === 'after' || lbl.includes('后')) ? 'after.png' : 'before.png';
      return [{ name: fname, server_path: `${MOCK_IMAGE_DIR}/${fname}`, url: '', original_name: `示例-${lbl}.png` }];
    }
    case 'variant_list': {
      if (!field.variants?.length) return [];
      const v = field.variants[0];
      const values: Record<string, any> = {};
      if (v.render === 'inline_fields' && v.fields) {
        for (const sf of v.fields) {
          values[sf.code] = mockFieldValue(sf);
        }
      }
      return [{ variant_id: v.id, values }];
    }
    case 'data_matrix':
      return null; // handled separately
    default:
      return field.default_value || '';
  }
}

function mockMatrixValue(cfg: DataMatrixConfig): any {
  const v = createEmptyMatrixValue(cfg);
  for (let si = 0; si < v.sample_ids.length; si++) {
    const sid = v.sample_ids[si];
    for (const p of v.parameters) {
      const hasColFormula = !!(p.cell_formula?.trim());
      if (hasColFormula) continue;
      // Leave last row partially empty to demonstrate dash display
      if (si === v.sample_ids.length - 1 && Math.random() > 0.5) continue;
      if (cfg.cell_type === 'number') {
        v.cells[matrixDataKey(sid, p.code)] = randomNum(5, 95);
      } else {
        v.cells[matrixDataKey(sid, p.code)] = '示例';
      }
    }
  }
  return v;
}

/**
 * 预览用：给 report_photo_table 字段（首页·原样照片表）填一张示例照片（仅当字段本身没有真实照片时）。
 * 照片存在字段定义里（field.photo_table.photos），所以用克隆模板的方式注入，供模板编辑器「示例数据」预览
 * 看到带样图的图片表。真实报告渲染不经过此函数（照片由文员上传，没传则显示「（无图片）」）。
 */
export function withMockPhotoTables(template: RecordTemplate): RecordTemplate {
  const mock = { name: 'before.png', server_path: `${MOCK_IMAGE_DIR}/before.png`, url: '', original_name: '示例-原样照片.png' };
  return {
    ...template,
    groups: (template.groups || []).map(g => ({
      ...g,
      fields: (g.fields || []).map(f => {
        if (f.type === 'report_photo_table' && !(f.photo_table?.photos?.length)) {
          return { ...f, photo_table: { ...(f.photo_table || {}), photos: [mock] } };
        }
        return f;
      }),
    })),
  };
}

/** 生成「原始（嵌套）」示例数据 = record_data.raw_data 的形状（字段 code → 原始值/矩阵值对象）。
 *  与 generateMockData 不同：后者返回展平+派生后的显示数据；本函数返回未展平的原始录入值。 */
export function generateMockRawData(template: RecordTemplate): Record<string, any> {
  const data: Record<string, any> = {};
  for (const g of template.groups) {
    for (const f of g.fields) {
      if (f.type === 'spacer') {
        continue; // 版式间隔无数据
      } else if (f.type === 'data_matrix' && f.matrix) {
        data[f.code] = mockMatrixValue(f.matrix);
      } else if (f.type !== 'computed') {
        data[f.code] = mockFieldValue(f);
      }
    }
  }
  return data;
}

export function generateMockData(template: RecordTemplate): Record<string, any> {
  const data = generateMockRawData(template);

  // Flatten matrix values and compute formulas
  let flat = flattenMatrixValuesToFlatData(template, data);
  flat = applyMatrixCellFormulas(template, flat);
  flat = applyPerCellFormulas(template, flat);
  flat = applyMatrixSummaryFormulas(template, flat);

  // Compute derived fields
  const allFields = template.groups.flatMap(g => g.fields);
  const computedFields = allFields.filter(f => f.type === 'computed' && f.formula);
  const ordered = topologicalOrder(computedFields.map(f => ({ code: f.code, formula: f.formula! })));
  const result: Record<string, any> = { ...flat };
  for (const code of ordered) {
    const field = computedFields.find(f => f.code === code);
    if (field?.formula) {
      try {
        result[code] = execute(field.formula, result);
      } catch {
        result[code] = '—';
      }
    }
  }

  // Merge computed values back
  for (const f of computedFields) {
    if (f.example_value !== undefined && f.example_value !== null && f.example_value !== '') {
      result[f.code] = f.example_value;
    } else {
      data[f.code] = result[f.code];
    }
  }

  // Return the full flat data (includes matrix flat keys + scalar fields + computed)
  return result;
}
