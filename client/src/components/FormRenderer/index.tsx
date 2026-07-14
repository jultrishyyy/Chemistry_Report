import { useState, useEffect } from 'react';
import { Input, Select, Checkbox, DatePicker, Tag, Card, Button, Space, Upload, message } from 'antd';
import { PlusOutlined, DeleteOutlined, UploadOutlined, CameraOutlined } from '@ant-design/icons';
import type { FieldDefinition, RecordTemplate, VariantDef, DataMatrixValue } from '../../../../shared/types';
import { buildGroupTree } from '../../../../shared/group-tree';
import { BRAND } from '../../theme';
import { IS_TOUCH } from '../../utils/device';

/** 分区标题：主色竖条 + 标题，给原始记录"规整章节"感 */
function sectionTitle(label: React.ReactNode) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <span style={{ width: 3, height: 14, borderRadius: 2, background: BRAND, display: 'inline-block' }} />
      <span style={{ fontWeight: 600, color: '#1f2733' }}>{label}</span>
    </span>
  );
}
import {
  flattenMatrixValuesToFlatData,
  matrixDataKey,
  normalizeMatrixValue,
  matrixSummaryFlatKey,
  matrixSummaryColumnFlatKey,
  matrixSummaryColCellFlatKey,
  matrixSummaryColSpanFlatKey,
  collectMatrixSummaryDataKeys,
  applyMatrixCellFormulas,
  applyMatrixSummaryFormulas,
  uniqueCode,
} from '../../../../shared/matrix-flatten';
import { execute, topologicalOrder } from '../../../../shared/formula-engine';

interface FormRendererProps {
  template: RecordTemplate;
  data: Record<string, any>;
  onChange: (data: Record<string, any>) => void;
  /** 录入记录 id（存在＝已存草稿/已保存）——用于「导入 Excel」留存附件的下载链接。 */
  recordId?: string | number | null;
  /** 已留存的导入 Excel（附件列表，pending=尚未保存到订单、暂不可下载）。 */
  excelAttachments?: Array<{ id: string; filename: string; pending?: boolean }>;
  /** 用户在顶部导入一份 Excel 后回调（把原文件交给上层留存到订单记录）。 */
  onExcelImported?: (file: File) => void;
  /** 图片上传落盘上下文：决定存到 <根>/<订单号>/<原始记录>/<字段名>。recordDir 传「样品名_测试项目名」。 */
  uploadCtx?: { orderNo?: string; recordDir?: string };
}

function computeDerivedMerged(template: RecordTemplate, rawData: Record<string, any>): Record<string, any> {
  let flat = flattenMatrixValuesToFlatData(template, rawData);
  flat = applyMatrixCellFormulas(template, flat);
  flat = applyMatrixSummaryFormulas(template, flat);
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
        result[code] = `错误: ${field.formula.type}`;
      }
    }
  }
  const derived: Record<string, any> = {};
  for (const f of computedFields) {
    derived[f.code] = result[f.code];
  }
  for (const k of collectMatrixSummaryDataKeys(template, result)) {
    derived[k] = result[k];
  }
  return derived;
}

export default function FormRenderer({ template, data, onChange, recordId, excelAttachments, onExcelImported, uploadCtx }: FormRendererProps) {
  const handleChange = (code: string, value: any) => {
    const newRaw = { ...data, [code]: value };
    const derived = computeDerivedMerged(template, newRaw);
    onChange({ ...newRaw, ...derived });
  };
  // Excel 导入面板放在【第一张可导入数据表】之前（数据表区域，不再悬在表单最顶部）
  const firstImportMatrixId = template.groups
    .flatMap(g => g.fields)
    .find(f => f.type === 'data_matrix' && f.matrix?.excel_import?.enabled)?.id;

  const renderField = (field: FieldDefinition) => {
    const value = data[field.code];

    // 版式·间隔：纯排版空白，录入端不可交互，仅示意占位（实际高度按模板，PDF 上才精确）
    if (field.type === 'spacer') {
      return (
        <div key={field.id} style={{
          height: 18, margin: '2px 0', borderRadius: 3,
          background: 'repeating-linear-gradient(135deg,#f4f6fa,#f4f6fa 6px,#eef1f6 6px,#eef1f6 12px)',
          color: '#aab', fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>间隔 {field.spacer_height || '1cm'}</div>
      );
    }

    if (field.semantic_role) {
      const roleLabel: Record<string, string> = {
        inspector: '主检', inspector_date: '检测日期',
        reviewer: '审核', reviewer_date: '审核日期',
      };
      const isReviewerSlot = field.semantic_role === 'reviewer' || field.semantic_role === 'reviewer_date';
      return (
        <div key={field.id} style={fieldRowStyle}>
          <label style={labelStyle}>{field.label}：</label>
          {value ? (
            <Tag color={isReviewerSlot ? 'green' : 'blue'}>{String(value)}</Tag>
          ) : (
            <Tag style={{ color: '#999' }}>{isReviewerSlot ? '待审核' : '—'}</Tag>
          )}
          <span style={{ color: '#aaa', fontSize: 11, marginLeft: 4 }}>
            系统自动填充（{roleLabel[field.semantic_role]}）
          </span>
        </div>
      );
    }

    if (field.type === 'computed') {
      return (
        <div key={field.id} style={fieldRowStyle}>
          <label style={labelStyle}>{field.label}：</label>
          <Tag color="purple">{value !== null && value !== undefined ? String(value) : '—'}</Tag>
          {field.unit && <span style={{ color: '#999', marginLeft: 4 }}>{field.unit}</span>}
        </div>
      );
    }

    if (field.type === 'data_matrix') {
      if (!field.matrix) return null;
      return (
        <div key={field.id}>
          {field.id === firstImportMatrixId && (
            <UnifiedExcelImport
              template={template} data={data} onChange={onChange}
              recordId={recordId} attachments={excelAttachments} onExcelImported={onExcelImported} />
          )}
          <DataMatrixField
            field={field}
            formData={data}
            value={value}
            onChange={(v) => handleChange(field.code, v)}
          />
        </div>
      );
    }

    if (field.type === 'free_grid') {
      const ft = field.free_table;
      if (!ft?.columns?.length || !ft?.rows?.length) return null;
      const cols = ft.columns, rows = ft.rows;
      const spans = ft.spans || {}, cells = ft.cells || {}, headerCells = ft.header_cells || {}, inputCells = ft.input_cells || {};
      const gridVal: Record<string, string> = (value && typeof value === 'object' && !Array.isArray(value)) ? value : {};
      // 被合并主格覆盖的格（行列序号）——与出片端 renderFreeGridTypst 同口径
      const colIdx = new Map(cols.map((c, i) => [c.id, i]));
      const rowIdx = new Map(rows.map((r, i) => [r.id, i]));
      const covered = new Set<string>();
      for (const [k, sp] of Object.entries(spans)) {
        const [rid, cid] = k.split('::'); const ri = rowIdx.get(rid), ci = colIdx.get(cid);
        if (ri == null || ci == null) continue;
        const cs = Math.min(Math.max(sp?.colspan ?? 1, 1), cols.length - ci);
        const rs = Math.min(Math.max(sp?.rowspan ?? 1, 1), rows.length - ri);
        for (let dr = 0; dr < rs; dr++) for (let dc = 0; dc < cs; dc++) { if (dr || dc) covered.add(`${ri + dr},${ci + dc}`); }
      }
      const setCell = (k: string, v: string) => handleChange(field.code, { ...gridVal, [k]: v });
      return (
        <div key={field.id} style={{ margin: '6px 0' }}>
          {!field.hide_label && <label style={labelStyle}>{field.label}：</label>}
          <div style={{ overflowX: 'auto', marginTop: 4 }}>
            <table style={{ borderCollapse: 'collapse' }}>
              <tbody>
                {rows.map((r, ri) => (
                  <tr key={r.id}>
                    {cols.map((c, ci) => {
                      if (covered.has(`${ri},${ci}`)) return null;
                      const k = `${r.id}::${c.id}`;
                      const sp = spans[k];
                      const cspan = Math.min(Math.max(sp?.colspan ?? 1, 1), cols.length - ci);
                      const rspan = Math.min(Math.max(sp?.rowspan ?? 1, 1), rows.length - ri);
                      const isHeader = !!headerCells[k], isInput = !!inputCells[k];
                      return (
                        <td key={c.id} colSpan={cspan > 1 ? cspan : undefined} rowSpan={rspan > 1 ? rspan : undefined}
                          style={{ border: '1px solid #d9d9d9', padding: (isInput || ft.cell_options?.[k]?.length) ? 0 : '4px 8px', minWidth: 60, textAlign: 'center', background: isHeader ? '#fafafa' : '#fff', fontWeight: isHeader ? 700 : 400 }}>
                          {ft.cell_options?.[k]?.length ? (
                            <Select size="small" variant="borderless" style={{ minWidth: 76, width: '100%' }} value={gridVal[k] || undefined}
                              placeholder="选择" allowClear options={ft.cell_options[k].map((o: string) => ({ value: o, label: o }))}
                              onChange={(v) => setCell(k, (v as string) || '')} />
                          ) : isInput ? (
                            <span style={{ display: 'inline-flex', alignItems: 'center', width: '100%' }}>
                              <Input size="small" variant="borderless" value={gridVal[k] ?? ''} onChange={(e) => setCell(k, e.target.value)} style={{ textAlign: 'center' }} />
                              {ft.cell_unit_options?.[k]?.length
                                ? <Select size="small" variant="borderless" style={{ minWidth: 50 }} value={gridVal[`${k}::__unit__`] || undefined} placeholder="单位"
                                    options={ft.cell_unit_options[k].map((u: string) => ({ value: u, label: u }))} onChange={(v) => setCell(`${k}::__unit__`, (v as string) || '')} />
                                : ft.cell_units?.[k] ? <span style={{ color: '#999', fontSize: 11, paddingRight: 4 }}>{ft.cell_units[k]}</span> : null}
                            </span>
                          ) : (
                            <span>{cells[k] ?? ''}{ft.cell_units?.[k] ? `（${ft.cell_units[k]}）` : ''}</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      );
    }

    if (field.type === 'variant_list') {
      return (
        <VariantListField
          key={field.id}
          field={field}
          value={value}
          onChange={(v) => handleChange(field.code, v)}
        />
      );
    }

    return (
      <div key={field.id} style={fieldRowStyle}>
        <label style={labelStyle}>
          {field.label}
          {field.required && <span style={{ color: 'red' }}>*</span>}
          ：
        </label>
        {renderInput(field, value, (v) => handleChange(field.code, v), uploadCtx)}
        {field.unit && <span style={{ color: '#999', marginLeft: 4 }}>{field.unit}</span>}
        {field.description && <span style={{ color: '#aaa', fontSize: 11, marginLeft: 8 }}>{field.description}</span>}
      </div>
    );
  };

  return (
    <div style={{ padding: 16, overflowY: 'auto', height: '100%' }}>
      {/* 嵌套分区：子分区渲染为父 Card 内的 inner Card（存储平铺，按 group-tree 分桶）。Excel 导入面板已下移到第一张数据表之前 */}
      {buildGroupTree(template.groups).map(({ group, children }) => (
        <Card
          key={group.id} size="small" title={sectionTitle(group.label)}
          style={{ marginBottom: 14, borderColor: '#e8ecf3' }}
          styles={{ header: { background: '#fafbfd', borderBottom: '1px solid #eef1f6', minHeight: 40 } }}
        >
          {group.fields.map(renderField)}
          {children.map(child => (
            <Card
              key={child.id} type="inner" size="small" title={sectionTitle(child.label)}
              style={{ margin: '10px 0 4px 12px', borderColor: '#e8ecf3' }}
              styles={{ header: { background: '#fafbfd' } }}
            >
              {child.fields.map(renderField)}
            </Card>
          ))}
        </Card>
      ))}
    </div>
  );
}

const fieldRowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8,
  padding: '7px 2px', borderBottom: '1px dashed #eef1f6',
};
const labelStyle: React.CSSProperties = { fontWeight: 600, color: '#344054', minWidth: 96 };

function renderInput(field: FieldDefinition, value: any, onChange: (v: any) => void, uploadCtx?: { orderNo?: string; recordDir?: string }) {
  switch (field.type) {
    case 'text':
      return <Input size="small" value={typeof value === 'object' ? '' : (value || '')} onChange={(e) => onChange(e.target.value)} style={{ width: 240 }} />;

    case 'number':
      return (
        <Input size="small" value={value ?? ''} onChange={(e) => onChange(e.target.value)} style={{ width: 120 }}
          placeholder={field.default_value ? String(field.default_value) : ''} />
      );

    case 'date':
      return <DatePicker size="small" onChange={(_d, ds) => onChange(ds)} />;

    case 'select':
      return <SelectWithCustom field={field} value={value} onChange={onChange} />;

    case 'checkbox':
      return <CheckboxWithCustom field={field} value={value} onChange={onChange} />;

    case 'textarea':
      return <Input.TextArea value={value || ''} onChange={(e) => onChange(e.target.value)} rows={2} style={{ width: 320 }} />;

    case 'device_ref':
      return <DeviceRefField field={field} value={value} onChange={onChange} />;

    case 'image':
      return <ImageField field={field} value={value} onChange={onChange} uploadCtx={uploadCtx} />;

    default:
      return <Input size="small" value={value || ''} onChange={(e) => onChange(e.target.value)} style={{ width: 240 }} />;
  }
}

function renderVariantSubfield(sf: FieldDefinition, value: any, onChange: (v: any) => void) {
  switch (sf.type) {
    case 'date':
      return <DatePicker size="small" onChange={(_d, ds) => onChange(ds)} />;
    case 'select':
      return <SelectWithCustom field={sf} value={value} onChange={onChange} style={{ width: 140 }} />;
    case 'textarea':
      return <Input.TextArea size="small" rows={1} style={{ width: 160 }} value={value || ''} onChange={(e) => onChange(e.target.value)} />;
    case 'number':
      return (
        <Input size="small" style={{ width: 80 }} value={value ?? ''}
          placeholder={sf.default_value ? String(sf.default_value) : ''}
          onChange={(e) => onChange(e.target.value)} />
      );
    default:
      return (
        <Input size="small" style={{ width: 80 }} value={value ?? ''}
          onChange={(e) => onChange(e.target.value)} />
      );
  }
}

function SelectWithCustom({
  field,
  value,
  onChange,
  style,
}: {
  field: FieldDefinition;
  value: any;
  onChange: (v: any) => void;
  style?: React.CSSProperties;
}) {
  const isCustom = value && typeof value === 'object' && 'custom' in value;
  const selectVal = isCustom ? '__custom__' : value;
  const opts = (field.options || []).map(o => ({ value: o, label: o }));
  if (field.allow_custom) opts.push({ value: '__custom__', label: '其他（自定义）' });

  return (
    <Space size={4}>
      <Select size="small" value={selectVal} onChange={(v) => {
        if (v === '__custom__') onChange({ custom: '' });
        else onChange(v);
      }} style={style || { width: 160 }} options={opts} placeholder="请选择" />
      {isCustom && (
        <Input size="small" placeholder="填写其他" style={{ width: 180 }}
          value={(value as any).custom || ''}
          onChange={(e) => onChange({ custom: e.target.value })} />
      )}
    </Space>
  );
}

function CheckboxWithCustom({ field, value, onChange }: { field: FieldDefinition; value: any; onChange: (v: any) => void }) {
  const arr: any[] = Array.isArray(value) ? value : [];
  const checked = arr.filter(v => typeof v === 'string');
  const customItem = arr.find(v => v && typeof v === 'object' && 'custom' in v);
  const customChecked = !!customItem;

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
      <Checkbox.Group value={checked} onChange={(vals) => {
        const next: any[] = [...vals];
        if (customItem) next.push(customItem);
        onChange(next);
      }}
        options={(field.options || []).map(o => ({ value: o, label: o }))} />
      {field.allow_custom && (
        <>
          <Checkbox checked={customChecked} onChange={(e) => {
            if (e.target.checked) onChange([...checked, { custom: '' }]);
            else onChange(checked);
          }}>其他</Checkbox>
          {customChecked && (
            <Input size="small" placeholder="填写其他" style={{ width: 180 }}
              value={(customItem as any).custom || ''}
              onChange={(e) => onChange([...checked, { custom: e.target.value }])} />
          )}
        </>
      )}
    </div>
  );
}

/**
 * DeviceRefField — 测试设备字段（从设备库按管理编号/仪器名称搜索）
 * 存储值：string[]（asset_code 数组）
 *
 * UX：输入框模糊搜索设备库；下拉显示"仪器名称 (型号) — 管理编号 [状态]"；选中即把 asset_code 加入数组
 * 已选项以 chip 显示设备名+管理编号；可移除
 */
function DeviceRefField({ value, onChange }: { field: FieldDefinition; value: any; onChange: (v: any) => void }) {
  const codes: string[] = Array.isArray(value) ? value : [];
  const [search, setSearch] = useState('');
  const [options, setOptions] = useState<any[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [selectedDetails, setSelectedDetails] = useState<Record<string, any>>({});

  // 已选 asset_code → 详情（用于显示 chip）
  useEffect(() => {
    const missing = codes.filter(c => !selectedDetails[c]);
    if (!missing.length) return;
    fetch(`/api/equipment/lookup?codes=${encodeURIComponent(missing.join(','))}`)
      .then(r => r.json())
      .then((rows: any[]) => {
        const next = { ...selectedDetails };
        rows.forEach(r => { next[r.asset_code] = r; });
        setSelectedDetails(next);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codes.join('|')]);

  // 远程搜索（debounce 300ms）
  useEffect(() => {
    if (!search.trim()) { setOptions([]); return; }
    setSearchLoading(true);
    const t = setTimeout(() => {
      fetch(`/api/equipment?keyword=${encodeURIComponent(search.trim())}&limit=20`)
        .then(r => r.json())
        .then(d => setOptions(d.items || []))
        .catch(() => setOptions([]))
        .finally(() => setSearchLoading(false));
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const remove = (code: string) => onChange(codes.filter(c => c !== code));

  return (
    <div style={{ width: '100%' }}>
      <Select
        size="small"
        showSearch
        value={null}
        loading={searchLoading}
        searchValue={search}
        onSearch={setSearch}
        filterOption={false}
        placeholder="按管理编号、仪器名称、型号搜索设备库"
        notFoundContent={search ? (searchLoading ? '搜索中…' : '未找到匹配设备') : '输入关键字开始搜索'}
        style={{ minWidth: 320, marginBottom: 6 }}
        onSelect={(v) => {
          if (codes.includes(String(v))) {
            message.warning('该设备已添加');
          } else {
            const detail = options.find(o => o.asset_code === v);
            if (detail) setSelectedDetails(prev => ({ ...prev, [String(v)]: detail }));
            onChange([...codes, String(v)]);
          }
          setSearch('');
        }}
        options={options.map(o => ({
          value: o.asset_code,
          label: (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <div>
                <strong>{o.name}</strong>
                {o.model && <span style={{ color: '#888', fontSize: 11, marginLeft: 4 }}>{o.model}</span>}
                <div style={{ fontSize: 11, color: '#666', fontFamily: 'monospace' }}>{o.asset_code}</div>
              </div>
              {o.status && <Tag color={o.status === '合格' ? 'green' : o.status === '已超期' ? 'red' : 'default'}>{o.status}</Tag>}
            </div>
          ),
        }))}
      />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {codes.length === 0 && <span style={{ fontSize: 12, color: '#aaa' }}>（暂无设备）</span>}
        {codes.map(c => {
          const d = selectedDetails[c];
          return (
            <Tag key={c} closable onClose={() => remove(c)} style={{ margin: 0 }}>
              {d ? (
                <>
                  <strong>{d.name}</strong>
                  <span style={{ color: '#888', fontFamily: 'monospace', marginLeft: 4 }}>({c})</span>
                </>
              ) : (
                <span style={{ fontFamily: 'monospace' }}>{c}</span>
              )}
            </Tag>
          );
        })}
      </div>
    </div>
  );
}

/**
 * ImageField — 图片字段（一字段一图，可选多张）
 * 值结构：[{ name, url, original_name }]
 */
function ImageField({ field, value, onChange, uploadCtx }: { field: FieldDefinition; value: any; onChange: (v: any) => void; uploadCtx?: { orderNo?: string; recordDir?: string } }) {
  const items: any[] = Array.isArray(value) ? value : [];
  const allowMultiple = field.allow_multiple !== false;

  const handleUpload = async (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    // 落盘上下文：订单号 / 原始记录(样品_测试项目) / 字段名 → 按结构分文件夹存
    if (uploadCtx?.orderNo) fd.append('order_no', uploadCtx.orderNo);
    if (uploadCtx?.recordDir) fd.append('record_dir', uploadCtx.recordDir);
    fd.append('field_name', field.label || field.code);
    try {
      const res = await fetch('/api/images/upload', { method: 'POST', body: fd });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      onChange(allowMultiple ? [...items, data] : [data]);
    } catch (e: any) {
      message.error('上传失败：' + (e.message || ''));
    }
    return false; // prevent antd default
  };

  const removeAt = (idx: number) => onChange(items.filter((_, i) => i !== idx));
  const moveAt = (idx: number, dir: -1 | 1) => {
    const t = idx + dir; if (t < 0 || t >= items.length) return;
    const next = [...items]; [next[idx], next[t]] = [next[t], next[idx]]; onChange(next);
  };

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'flex-start' }}>
      {items.map((it, i) => (
        <div key={i} style={{ position: 'relative', width: 88, height: 88, border: '1px solid #ddd', borderRadius: 4, overflow: 'hidden' }}>
          <img src={it.url} alt={it.original_name || it.name}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          <Button size="small" type="text" danger icon={<DeleteOutlined />}
            style={{ position: 'absolute', top: 2, right: 2, background: 'rgba(255,255,255,0.85)', padding: 0, width: 22, height: 22 }}
            onClick={() => removeAt(i)} />
          {items.length > 1 && (
            <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, display: 'flex', justifyContent: 'space-between', background: 'rgba(255,255,255,0.8)' }}>
              <Button size="small" type="text" disabled={i === 0} onClick={() => moveAt(i, -1)} style={{ padding: 0, height: 18, width: 28, fontSize: 12 }}>‹</Button>
              <Button size="small" type="text" disabled={i === items.length - 1} onClick={() => moveAt(i, 1)} style={{ padding: 0, height: 18, width: 28, fontSize: 12 }}>›</Button>
            </div>
          )}
        </div>
      ))}
      {(allowMultiple || items.length === 0) && (
        <Space direction="vertical" size={6}>
          <Upload accept="image/*" showUploadList={false} beforeUpload={handleUpload}>
            <Button size="small" icon={<PlusOutlined />} style={{ width: 88, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ fontSize: 11 }}>选图</span>
            </Button>
          </Upload>
          {IS_TOUCH && (
            <Upload accept="image/*" capture="environment" showUploadList={false} beforeUpload={handleUpload}>
              <Button size="small" icon={<CameraOutlined />} style={{ width: 88, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ fontSize: 11 }}>拍照</span>
              </Button>
            </Upload>
          )}
        </Space>
      )}
    </div>
  );
}

interface VariantEntry {
  variant_id: string;
  values: Record<string, any>;
}

function VariantListField({ field, value, onChange }: { field: FieldDefinition; value: any; onChange: (v: any) => void }) {
  const entries: VariantEntry[] = Array.isArray(value) ? value : [];
  const variants: VariantDef[] = field.variants || [];

  const addEntry = () => {
    const first = variants[0];
    if (!first) return;
    const initVals: Record<string, any> = {};
    for (const sf of first.fields || []) {
      if (sf.default_value !== undefined) initVals[sf.code] = sf.default_value;
    }
    onChange([...entries, { variant_id: first.id, values: initVals }]);
  };

  const removeEntry = (idx: number) => onChange(entries.filter((_, i) => i !== idx));

  const updateEntry = (idx: number, patch: Partial<VariantEntry>) => {
    const next = [...entries];
    next[idx] = { ...next[idx], ...patch };
    onChange(next);
  };

  const updateSubField = (idx: number, code: string, val: any) => {
    const next = [...entries];
    next[idx] = { ...next[idx], values: { ...next[idx].values, [code]: val } };
    onChange(next);
  };

  const removeSubField = (idx: number, code: string) => {
    const next = [...entries];
    const newVals = { ...next[idx].values };
    delete newVals[code];
    next[idx] = { ...next[idx], values: newVals };
    onChange(next);
  };

  return (
    <div style={{ marginBottom: 6, padding: '4px 0', width: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
        <label style={labelStyle}>
          {field.label}
          {field.required && <span style={{ color: 'red' }}>*</span>}
          ：
        </label>
        <Button size="small" icon={<PlusOutlined />} onClick={addEntry} type="dashed">添加条目</Button>
        {field.description && <span style={{ color: '#aaa', fontSize: 11, marginLeft: 8 }}>{field.description}</span>}
      </div>

      {entries.length === 0 && (
        <div style={{ marginLeft: 90, color: '#bbb', fontSize: 12 }}>（尚未添加条目）</div>
      )}

      {entries.map((entry, idx) => {
        const variant = variants.find(v => v.id === entry.variant_id);
        return (
          <div key={idx} style={{ marginLeft: 90, marginBottom: 4, padding: 6, background: '#fafafa', border: '1px solid #f0f0f0', borderRadius: 4 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
              <Select size="small" value={entry.variant_id} style={{ width: 200 }}
                options={variants.map(v => ({ value: v.id, label: v.label }))}
                onChange={(vid) => {
                  const newVar = variants.find(v => v.id === vid);
                  const initVals: Record<string, any> = {};
                  for (const sf of newVar?.fields || []) {
                    if (sf.default_value !== undefined) initVals[sf.code] = sf.default_value;
                  }
                  updateEntry(idx, { variant_id: vid, values: initVals });
                }}
              />
              {variant?.render === 'literal' ? (
                <Tag color="blue">{variant.literal_value}</Tag>
              ) : (
                (variant?.fields || []).filter(sf => entry.values[sf.code] !== undefined || !sf.removable).map(sf => (
                  <span key={sf.code} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ fontSize: 12, color: '#666' }}>{sf.label}</span>
                    {renderVariantSubfield(sf, entry.values[sf.code], val => updateSubField(idx, sf.code, val))}
                    {sf.unit && <span style={{ fontSize: 12, color: '#999' }}>{sf.unit}</span>}
                    {sf.removable && (
                      <Button size="small" type="text" icon={<DeleteOutlined />}
                        onClick={() => removeSubField(idx, sf.code)} title="移除该子字段" />
                    )}
                  </span>
                ))
              )}
              <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => removeEntry(idx)} title="删除该条目" />
            </div>

            {variant?.render === 'inline_fields' && (
              <div style={{ marginTop: 4 }}>
                {(variant.fields || []).filter(sf => sf.removable && entry.values[sf.code] === undefined).map(sf => (
                  <Button key={sf.code} size="small" type="link" style={{ padding: '0 4px', fontSize: 11 }}
                    onClick={() => updateSubField(idx, sf.code, sf.default_value ?? '')}>
                    + {sf.label}
                  </Button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function DataMatrixField({
  field,
  value,
  formData,
  onChange,
}: {
  field: FieldDefinition;
  value: any;
  formData: Record<string, any>;
  onChange: (v: any) => void;
}) {
  const cfg = field.matrix!;
  const v = normalizeMatrixValue(cfg, value) as DataMatrixValue;

  const updateCell = (sid: string, pcode: string, val: any) => {
    const k = matrixDataKey(sid, pcode);
    onChange({ ...v, cells: { ...v.cells, [k]: val } });
  };

  const addSample = () => {
    // 开放权限（P2）：默认允许增减样品行，除非模板显式锁定（=== false）
    if (cfg.allow_add_remove_samples === false) return;
    const idx = v.sample_ids.length + 1;
    const sid = `s${Date.now()}`;
    const cells = { ...v.cells };
    for (const p of v.parameters) {
      // 新增行也应用参数列默认值
      cells[matrixDataKey(sid, p.code)] = (p.default_value ?? '') !== '' ? p.default_value : '';
    }
    onChange({
      ...v,
      sample_ids: [...v.sample_ids, sid],
      sample_labels: { ...v.sample_labels, [sid]: `${cfg.row_header_prefix || '试样'} ${idx}` },
      cells,
    });
  };

  const removeSample = (sid: string) => {
    if (cfg.allow_add_remove_samples === false) return;
    const cells = { ...v.cells };
    for (const p of v.parameters) {
      delete cells[matrixDataKey(sid, p.code)];
    }
    const sample_labels = { ...v.sample_labels };
    delete sample_labels[sid];
    onChange({
      ...v,
      sample_ids: v.sample_ids.filter(id => id !== sid),
      sample_labels,
      cells,
    });
  };

  const addParameter = () => {
    if (!cfg.allow_add_remove_parameters) return;
    const n = v.parameters.length + 1;
    // 编码系统自动生成，防撞已有列（含被删后再加的场景）
    const code = uniqueCode(`col_${n}`, v.parameters.map(p => p.code));
    const np = { id: `p${Date.now()}`, code, label: `参数${n}` };
    const cells = { ...v.cells };
    for (const sid of v.sample_ids) {
      cells[matrixDataKey(sid, np.code)] = '';
    }
    onChange({ ...v, parameters: [...v.parameters, np], cells });
  };

  const removeParameter = (pcode: string) => {
    if (!cfg.allow_add_remove_parameters) return;
    const cells = { ...v.cells };
    for (const sid of v.sample_ids) {
      delete cells[matrixDataKey(sid, pcode)];
    }
    onChange({
      ...v,
      parameters: v.parameters.filter(p => p.code !== pcode),
      cells,
    });
  };

  const setParamLabel = (idx: number, label: string) => {
    const parameters = [...v.parameters];
    parameters[idx] = { ...parameters[idx], label };
    onChange({ ...v, parameters });
  };

  const cellInput = (sid: string, p: { code: string }) => {
    const k = matrixDataKey(sid, p.code);
    const flatKey = `${field.code}__${k}`;
    const paramDef = v.parameters.find(pp => pp.code === p.code);
    const isFormulaCol = !!(paramDef?.cell_formula && paramDef.cell_formula.trim());
    // per-cell formula check
    const hasCellFormula = !!(cfg.cell_formulas && cfg.cell_formulas[k]);
    const cellVal = v.cells[k];
    // 按行公式列 或 per-cell 公式：显示 flat 里算出的值
    if (isFormulaCol || hasCellFormula) {
      const computed = formData[flatKey];
      const display = computed === null || computed === undefined || computed === ''
        ? '—' : String(computed);
      return (
        <Tag color="purple" style={{ margin: 0, minWidth: 72, textAlign: 'center' }}>{display}</Tag>
      );
    }
    if (cfg.cell_type === 'number') {
      return (
        <Input size="small" style={{ width: 72 }} value={cellVal ?? ''}
          onChange={(e) => updateCell(sid, p.code, e.target.value)} />
      );
    }
    return (
      <Input size="small" style={{ width: 72 }} value={cellVal ?? ''} onChange={(e) => updateCell(sid, p.code, e.target.value)} />
    );
  };

  const updateSummaryInput = (rowId: string, val: any) => {
    onChange({
      ...v,
      summary_inputs: { ...(v.summary_inputs || {}), [rowId]: val },
    });
  };

  // 逐列录入型汇总行：每个参数列一格，存 v.summary_row_inputs，key = `${rowId}__${paramCode}`
  const updateSummaryRowInput = (rowId: string, paramCode: string, val: any) => {
    onChange({
      ...v,
      summary_row_inputs: { ...(v.summary_row_inputs || {}), [`${rowId}__${paramCode}`]: val },
    });
  };

  // 录入型汇总列：每个样品行一格，存 v.sumcol_inputs，key = `${colId}__${sampleId}`
  const updateSumcolInput = (colId: string, sid: string, val: any) => {
    onChange({
      ...v,
      sumcol_inputs: { ...(v.sumcol_inputs || {}), [`${colId}__${sid}`]: val },
    });
  };

  return (
    <div style={{ marginBottom: 12, overflowX: 'auto' }}>
      <div style={{ fontWeight: 'bold', marginBottom: 6 }}>{field.label}{field.required && <span style={{ color: 'red' }}>*</span>}</div>
      <table style={{ borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr>
            {/* undefined=默认"试样"，''=模板显式留空 */}
            <th style={thStyle}>{cfg.axis_header ?? '试样'}</th>
            {v.parameters.map((p, pi) => (
              <th key={p.code} style={thStyle}>
                {cfg.allow_edit_parameter_labels_at_entry ? (
                  <Input size="small" style={{ width: 88 }} value={p.label}
                    onChange={(e) => setParamLabel(pi, e.target.value)} />
                ) : (
                  <span>{p.label}</span>
                )}
                <UnitCell
                  param={p}
                  value={v.parameter_unit_overrides?.[p.code] ?? p.unit ?? ''}
                  onChange={(u) => onChange({
                    ...v,
                    parameter_unit_overrides: { ...(v.parameter_unit_overrides || {}), [p.code]: u },
                  })}
                />
                {cfg.allow_add_remove_parameters && (
                  <Button size="small" type="link" danger onClick={() => removeParameter(p.code)}>×</Button>
                )}
              </th>
            ))}
            {(cfg.summary_cols || []).map(sc => (
              <th key={sc.id} style={{ ...thStyle, background: '#fff7e6' }}>
                <div>
                  {sc.label}
                  <HeaderNoteCell
                    note={sc.unit}
                    options={sc.unit_options}
                    allowCustom={sc.unit_allow_custom}
                    stored={v.sumcol_unit_overrides?.[sc.id]}
                    onSet={(u) => onChange({
                      ...v,
                      sumcol_unit_overrides: { ...(v.sumcol_unit_overrides || {}), [sc.id]: u },
                    })}
                  />
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {v.sample_ids.map((sid, ri) => (
            <tr key={sid}>
              <td style={tdStyle}>
                {/* 行分组表头（纯展示，PDF 端合并为竖向超级行头；录入期新增行无分组） */}
                {cfg.sample_groups?.[ri] && (
                  <Tag color="blue" style={{ fontSize: 10, marginRight: 4 }}>▭ {cfg.sample_groups[ri]}</Tag>
                )}
                {cfg.allow_edit_sample_labels_at_entry !== false ? (
                  <Input size="small" style={{ width: 88 }}
                    value={v.sample_labels?.[sid] ?? cfg.default_sample_labels?.[ri] ?? `${cfg.row_header_prefix || '试样'} ${ri + 1}`}
                    onChange={(e) => onChange({
                      ...v,
                      sample_labels: { ...v.sample_labels, [sid]: e.target.value },
                    })}
                  />
                ) : (
                  <span style={{ fontWeight: 'bold', fontSize: 12 }}>
                    {v.sample_labels?.[sid] ?? cfg.default_sample_labels?.[ri] ?? `${cfg.row_header_prefix || '试样'} ${ri + 1}`}
                  </span>
                )}
                {/* 行表头备注（统一表头模型）：行列倒置使用时行头也能带单位/可选单位 */}
                <HeaderNoteCell
                  note={cfg.sample_notes?.[ri]?.note}
                  options={cfg.sample_notes?.[ri]?.note_options}
                  allowCustom={cfg.sample_notes?.[ri]?.note_allow_custom}
                  stored={v.sample_note_overrides?.[sid]}
                  onSet={(note) => onChange({
                    ...v,
                    sample_note_overrides: { ...(v.sample_note_overrides || {}), [sid]: note },
                  })}
                />
                {cfg.allow_add_remove_samples !== false && (
                  <Button size="small" type="link" danger onClick={() => removeSample(sid)}>删行</Button>
                )}
              </td>
              {v.parameters.map(p => (
                <td key={p.code} style={tdStyle}>{cellInput(sid, p)}</td>
              ))}
              {(cfg.summary_cols || []).map(sc => {
                const tdBase = { ...tdStyle, background: '#fffbe6', textAlign: 'center' as const };
                // 汇总列（跨行单值, per_row===false）：首行 rowspan 一个输入，存 v.sumcol_inputs[colId]（无 sid）
                if (sc.per_row === false) {
                  if (ri !== 0) return null;
                  const spanTd = { ...tdStyle, background: '#fff7e6', textAlign: 'center' as const, verticalAlign: 'middle' as const };
                  const cur = (v.sumcol_inputs?.[sc.id] as any) ?? '';
                  const setSpan = (val: any) => onChange({ ...v, sumcol_inputs: { ...(v.sumcol_inputs || {}), [sc.id]: val } });
                  if (sc.source_type === 'input_text' || sc.source_type === 'input_number') {
                    return (
                      <td key={sc.id} rowSpan={v.sample_ids.length} style={spanTd}>
                        <Input size="small" style={{ minWidth: 90 }} value={cur}
                          onChange={(e) => setSpan(e.target.value)}
                          placeholder={sc.source_type === 'input_number' ? '数字' : '文字'} />
                      </td>
                    );
                  }
                  if (sc.source_type === 'input_choice') {
                    const isCustom = cur && typeof cur === 'object' && 'custom' in cur;
                    const selectVal = isCustom ? '__custom__' : (cur as string | undefined);
                    const opts = (sc.choices || []).map(o => ({ value: o, label: o }));
                    if (sc.allow_custom) opts.push({ value: '__custom__', label: '其他（自定义）' });
                    return (
                      <td key={sc.id} rowSpan={v.sample_ids.length} style={spanTd}>
                        <Space size={2} direction="vertical" style={{ width: '100%' }}>
                          <Select size="small" style={{ minWidth: 100 }} value={selectVal} placeholder="选择" options={opts}
                            onChange={(vv) => setSpan(vv === '__custom__' ? { custom: '' } : vv)} />
                          {isCustom && (
                            <Input size="small" placeholder="自定义" value={(cur as any).custom || ''}
                              onChange={(e) => setSpan({ custom: e.target.value })} />
                          )}
                        </Space>
                      </td>
                    );
                  }
                  // literal / formula → 只读
                  const sx = sc.source_type === 'literal' ? (sc.literal || '—') : formData[matrixSummaryColSpanFlatKey(field.code, sc.id)];
                  return <td key={sc.id} rowSpan={v.sample_ids.length} style={spanTd}>{sx === null || sx === undefined || sx === '' ? '—' : String(sx)}</td>;
                }
                const ck = `${sc.id}__${sid}`;
                // 统计列(数字)某格配了公式 → 该格自动算、只读显示（与试样格公式一致）
                if (sc.source_type === 'input_number' && sc.cell_formulas?.[sid]) {
                  const x = formData[matrixSummaryColCellFlatKey(field.code, sc.id, sid)];
                  return <td key={sc.id} style={tdBase} title="本格按公式自动计算">{x === null || x === undefined || x === '' ? '—' : String(x)}</td>;
                }
                // 录入型汇总列：每行可编辑（文本 / 数字 / 选择），存 v.sumcol_inputs
                if (sc.source_type === 'input_text' || sc.source_type === 'input_number') {
                  const cur = (v.sumcol_inputs?.[ck] as string) ?? '';
                  return (
                    <td key={sc.id} style={tdBase}>
                      <Input size="small" style={{ minWidth: 90 }} value={cur}
                        onChange={(e) => updateSumcolInput(sc.id, sid, e.target.value)}
                        placeholder={sc.source_type === 'input_number' ? '数字' : '文字'} />
                    </td>
                  );
                }
                if (sc.source_type === 'input_choice') {
                  const cur = v.sumcol_inputs?.[ck];
                  const isCustom = cur && typeof cur === 'object' && 'custom' in cur;
                  const selectVal = isCustom ? '__custom__' : (cur as string | undefined);
                  const opts = (sc.choices || []).map(o => ({ value: o, label: o }));
                  if (sc.allow_custom) opts.push({ value: '__custom__', label: '其他（自定义）' });
                  return (
                    <td key={sc.id} style={tdBase}>
                      <Space size={2} direction="vertical" style={{ width: '100%' }}>
                        <Select size="small" style={{ minWidth: 100 }} value={selectVal} placeholder="选择" options={opts}
                          onChange={(vv) => updateSumcolInput(sc.id, sid, vv === '__custom__' ? { custom: '' } : vv)} />
                        {isCustom && (
                          <Input size="small" placeholder="自定义" value={(cur as any).custom || ''}
                            onChange={(e) => updateSumcolInput(sc.id, sid, { custom: e.target.value })} />
                        )}
                      </Space>
                    </td>
                  );
                }
                // 固定 / 聚合 / 公式 → 只读显示
                let display: string;
                if (sc.source_type === 'literal') {
                  display = sc.literal || '—';
                } else {
                  const x = formData[matrixSummaryColCellFlatKey(field.code, sc.id, sid)];
                  display = x === null || x === undefined || x === '' ? '—' : String(x);
                }
                return <td key={sc.id} style={tdBase}>{display}</td>;
              })}
            </tr>
          ))}
          {(cfg.summary_rows || []).map(sr => {
            const n = v.parameters.length || 1;

            // 逐列手动录入（per_column + input_*）：每个参数列一个输入框
            if (sr.per_column && (sr.source_type === 'input_text' || sr.source_type === 'input_number' || sr.source_type === 'input_choice')) {
              return (
                <tr key={sr.id}>
                  <td style={{ ...tdStyle, fontWeight: 'bold', background: '#e6f4ff' }}>
                    <SummaryLabelCell sr={sr} value={v} onChange={onChange} />
                  </td>
                  {v.parameters.map(p => {
                    const cur = v.summary_row_inputs?.[`${sr.id}__${p.code}`];
                    const hasFormula = !!sr.cell_formulas?.[p.code];
                    if (hasFormula) {
                      // 配了公式的列：只读，显示算好的值（来自 derived/formData）
                      const x = formData[matrixSummaryColumnFlatKey(field.code, sr.id, p.code)];
                      const display = x === null || x === undefined || x === '' ? '—' : String(x);
                      return (
                        <td key={p.code} style={{ ...tdStyle, background: '#fffbe6', textAlign: 'center' }} title="本格由公式自动计算">{display}</td>
                      );
                    }
                    return (
                      <td key={p.code} style={{ ...tdStyle, textAlign: 'center', background: '#f0f7ff' }}>
                        {sr.source_type === 'input_choice' ? (
                          <Select size="small" style={{ minWidth: 90 }} value={(cur as any) ?? undefined} placeholder="选择"
                            options={(sr.choices || []).map(o => ({ value: o, label: o }))}
                            onChange={(vv) => updateSummaryRowInput(sr.id, p.code, vv)} />
                        ) : (
                          <Input size="small" style={{ width: 80 }} value={(cur as any) ?? ''}
                            onChange={(e) => updateSummaryRowInput(sr.id, p.code, e.target.value)}
                            placeholder={sr.source_type === 'input_number' ? '数字' : ''} />
                        )}
                      </td>
                    );
                  })}
                  {(cfg.summary_cols || []).map(sc => (
                    <td key={sc.id} style={{ ...tdStyle, background: '#fafafa' }} />
                  ))}
                </tr>
              );
            }

            // per_column_aggregate: 每列独立一格
            if (sr.source_type === 'per_column_aggregate') {
              return (
                <tr key={sr.id}>
                  <td style={{ ...tdStyle, fontWeight: 'bold', background: '#fafafa' }}>
                    <SummaryLabelCell sr={sr} value={v} onChange={onChange} />
                  </td>
                  {v.parameters.map(p => {
                    const k = matrixSummaryColumnFlatKey(field.code, sr.id, p.code);
                    const x = formData[k];
                    const display = x === null || x === undefined || x === '' ? '—' : String(x);
                    return (
                      <td key={p.code} style={{ ...tdStyle, background: '#f6ffed', textAlign: 'center' }}>
                        {display}
                      </td>
                    );
                  })}
                  {(cfg.summary_cols || []).map(sc => (
                    <td key={sc.id} style={{ ...tdStyle, background: '#fafafa' }} />
                  ))}
                </tr>
              );
            }

            const span = Math.min(Math.max(sr.value_colspan ?? n, 1), n);

            const renderValue = (): React.ReactNode => {
              if (sr.source_type === 'literal') {
                return (sr.literal ?? '') === '' ? '—' : String(sr.literal);
              }
              if (sr.source_type === 'input_text') {
                const cur = v.summary_inputs?.[sr.id] ?? '';
                return (
                  <Space size={4} style={{ width: '100%' }}>
                    <Input size="small" style={{ minWidth: 240 }} value={cur}
                      onChange={(e) => updateSummaryInput(sr.id, e.target.value)}
                      placeholder={sr.placeholder || '请输入文字'} />
                    {sr.unit && <span style={{ color: '#888' }}>{sr.unit}</span>}
                  </Space>
                );
              }
              if (sr.source_type === 'input_number') {
                const cur = v.summary_inputs?.[sr.id] ?? '';
                return (
                  <Space size={4}>
                    <Input size="small" style={{ width: 120 }} value={cur}
                      onChange={(e) => updateSummaryInput(sr.id, e.target.value)}
                      placeholder="输入数字" />
                    {sr.unit && <span style={{ color: '#888' }}>{sr.unit}</span>}
                  </Space>
                );
              }
              if (sr.source_type === 'input_choice') {
                const cur = v.summary_inputs?.[sr.id];
                const isCustom = cur && typeof cur === 'object' && 'custom' in cur;
                const selectVal = isCustom ? '__custom__' : cur;
                const opts = (sr.choices || []).map(o => ({ value: o, label: o }));
                if (sr.allow_custom) opts.push({ value: '__custom__', label: '其他（自定义）' });
                return (
                  <Space size={4}>
                    <Select size="small" style={{ minWidth: 140 }} value={selectVal}
                      placeholder="请选择"
                      options={opts}
                      onChange={(vv) => {
                        if (vv === '__custom__') updateSummaryInput(sr.id, { custom: '' });
                        else updateSummaryInput(sr.id, vv);
                      }} />
                    {isCustom && (
                      <Input size="small" style={{ width: 120 }} placeholder="自定义"
                        value={(cur as any).custom || ''}
                        onChange={(e) => updateSummaryInput(sr.id, { custom: e.target.value })} />
                    )}
                  </Space>
                );
              }
              if (sr.source_type === 'formula') {
                const sk = matrixSummaryFlatKey(field.code, sr.id);
                const x = formData[sk];
                return x === null || x === undefined || x === '' ? '—' : String(x);
              }
              // legacy computed_field
              const x = formData[sr.field_code || ''];
              return x === null || x === undefined || x === '' ? '—' : String(x);
            };

            const content = renderValue();
            return (
              <tr key={sr.id}>
                <td style={{ ...tdStyle, fontWeight: 'bold', background: '#fafafa' }}>
                  <SummaryLabelCell sr={sr} value={v} onChange={onChange} />
                </td>
                {span >= n ? (
                  <td colSpan={n} style={{ ...tdStyle, background: '#f6ffed' }}>{content}</td>
                ) : (
                  <>
                    <td colSpan={span} style={{ ...tdStyle, background: '#f6ffed' }}>{content}</td>
                    {v.parameters.slice(span).map(p => (
                      <td key={`pad-${sr.id}-${p.code}`} style={tdStyle} />
                    ))}
                  </>
                )}
                {(cfg.summary_cols || []).map(sc => (
                  <td key={sc.id} style={{ ...tdStyle, background: '#fafafa' }} />
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
      <Space style={{ marginTop: 8 }}>
        {cfg.allow_add_remove_samples !== false && (
          <Button size="small" type="dashed" icon={<PlusOutlined />} onClick={addSample}>增加行</Button>
        )}
        {cfg.allow_add_remove_parameters && (
          <Button size="small" type="dashed" icon={<PlusOutlined />} onClick={addParameter}>增加列</Button>
        )}
        {/* Excel 导入已上移到表单顶部「导入 Excel」统一入口（一份 Excel 填充所有表格） */}
      </Space>
    </div>
  );
}

const thStyle: React.CSSProperties = { border: '1px solid #ddd', padding: 4, background: '#fafafa' };
const tdStyle: React.CSSProperties = { border: '1px solid #ddd', padding: 4 };

/**
 * 把一张 Excel 数据块（grid）填进一个矩阵值，返回新值 + 提示。纯函数（无 UI），顶部统一导入复用。
 * - 行/列数不一致按模板配置自动补/截断/保留原值（与旧逐表导入一致）；
 * - 公式格（列级 cell_formula / 单元格 cell_formulas）跳过；
 * - **小数位：导入即按列级(存量覆盖)/表级 `decimals` 四舍五入并补零直接落库**（不再保留 Excel 原样精度）。
 */
function fillMatrixFromGrid(
  config: import('../../../../shared/types').DataMatrixConfig,
  value: DataMatrixValue,
  fullGrid: any[][],
): { value: DataMatrixValue; notices: string[] } {
  const notices: string[] = [];
  const prefix = config.row_header_prefix || '试样';

  const lockRows = config.allow_add_remove_samples === false;
  let grid = fullGrid;
  if (lockRows && fullGrid.length > value.sample_ids.length) {
    grid = fullGrid.slice(0, value.sample_ids.length);
    notices.push(`模板固定 ${value.sample_ids.length} 行，Excel 有 ${fullGrid.length} 行，已导入前 ${grid.length} 行`);
  } else if (fullGrid.length > value.sample_ids.length) {
    notices.push(`Excel 有 ${fullGrid.length} 行，已自动补行——新行行名是默认值，可双击修改`);
  }
  if (fullGrid.length < value.sample_ids.length) {
    notices.push(`Excel 只有 ${fullGrid.length} 行（当前 ${value.sample_ids.length} 行），其余行保留原值，可自行删行`);
  }

  const maxCols = grid.reduce((m, r) => Math.max(m, r.length), 0);
  const newParams = [...value.parameters];
  if (maxCols > newParams.length) {
    if (config.allow_add_remove_parameters) {
      const used = newParams.map(p => p.code);
      for (let i = newParams.length; i < maxCols; i++) {
        const code = uniqueCode(`col_${i + 1}`, used);
        used.push(code);
        newParams.push({ id: `p${Date.now()}_${i}`, code, label: `参数${i + 1}` });
      }
      notices.push(`Excel 有 ${maxCols} 列（模板 ${value.parameters.length} 列），已自动补列——请自行修改新列表头`);
    } else {
      notices.push(`Excel 有 ${maxCols} 列（模板 ${newParams.length} 列），模板不允许增删列，多余列已忽略`);
    }
  } else if (maxCols < newParams.length) {
    notices.push(`Excel 只有 ${maxCols} 列（模板 ${newParams.length} 列），缺的列保留原值`);
  }

  const formulaCols = newParams.filter(p => p.cell_formula?.trim()).map(p => p.label);
  let skippedFormulaCells = 0;

  const newCells = { ...value.cells };
  const newSampleIds = [...value.sample_ids];
  const newLabels = { ...value.sample_labels };
  grid.forEach((rowArr, ri) => {
    let sid: string;
    if (ri < newSampleIds.length) {
      sid = newSampleIds[ri];
    } else {
      sid = `s${Date.now()}_${ri}`;
      newSampleIds.push(sid);
      newLabels[sid] = `${prefix} ${newSampleIds.length}`;
    }
    rowArr.forEach((val: any, ci: number) => {
      if (ci >= newParams.length) return;
      if (val === '' || val === null || val === undefined) return;
      const p = newParams[ci];
      const key = matrixDataKey(sid, p.code);
      if (p.cell_formula?.trim() || config.cell_formulas?.[key]) { skippedFormulaCells++; return; }
      // 小数位：列级（存量覆盖）优先，否则整表统一——导入即四舍五入并补零，直接成为录入值
      const dec = p.decimals ?? config.decimals;
      newCells[key] = (dec !== undefined && dec !== null && val !== '' && !isNaN(Number(val)))
        ? Number(val).toFixed(dec)
        : val;
    });
  });
  if (formulaCols.length) {
    notices.push(`「${formulaCols.join('」「')}」列配置了按行公式，已跳过导入——由公式按其他列自动计算`);
  } else if (skippedFormulaCells) {
    notices.push(`${skippedFormulaCells} 个格子配置了公式，已跳过导入——由公式自动计算`);
  }

  return {
    value: { ...value, parameters: newParams, cells: newCells, sample_ids: newSampleIds, sample_labels: newLabels },
    notices,
  };
}

/**
 * 顶部统一 Excel 导入：一份 Excel 一次导入，按每张数据表配置的 Sheet 自动搜寻并填充（多表一次搞定）；
 * 导入的原文件交给上层留存到订单记录（可随时下载）。无任何开启 Excel 导入的数据表时不渲染。
 */
function UnifiedExcelImport({
  template, data, onChange, recordId, attachments, onExcelImported,
}: {
  template: RecordTemplate;
  data: Record<string, any>;
  onChange: (data: Record<string, any>) => void;
  recordId?: string | number | null;
  attachments?: Array<{ id: string; filename: string; pending?: boolean }>;
  onExcelImported?: (file: File) => void;
}) {
  const [loading, setLoading] = useState(false);
  const matrixFields = template.groups
    .flatMap(g => g.fields)
    .filter(f => f.type === 'data_matrix' && f.matrix?.excel_import?.enabled);
  if (matrixFields.length === 0) return null;

  const handleUpload = async (file: File) => {
    setLoading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const parseRes = await fetch('/api/excel-import/parse', { method: 'POST', body: formData });
      const { sheets, tempPath } = await parseRes.json();

      const updates: Record<string, any> = {};
      const notices: string[] = [];
      let filled = 0;
      for (const f of matrixFields) {
        const cfg = f.matrix!;
        const map = cfg.excel_import!;
        const sheet = (sheets as any[]).find(s => s.name === map.sheet_name);
        if (!sheet) { notices.push(`表格「${f.label}」未找到 Sheet "${map.sheet_name}"，已跳过`); continue; }
        const extractRes = await fetch('/api/excel-import/extract', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tempPath,
            sheetName: map.sheet_name,
            dataStartRow: map.data_start_row ?? 2,
            dataStartCol: map.data_start_col ?? 0,
          }),
        });
        const { grid } = await extractRes.json() as { grid: any[][] };
        if (!grid || grid.length === 0) { notices.push(`表格「${f.label}」在 Sheet "${map.sheet_name}" 未读到数据`); continue; }
        const cur = normalizeMatrixValue(cfg, data[f.code]) as DataMatrixValue;
        const { value: nv, notices: ns } = fillMatrixFromGrid(cfg, cur, grid);
        updates[f.code] = nv;
        filled++;
        for (const n of ns) notices.push(`「${f.label}」${n}`);
      }

      if (filled === 0) {
        message.warning('没有任何表格被填充——请检查 Excel 的 Sheet 名是否与各数据表配置一致');
      } else {
        const newRaw = { ...data, ...updates };
        const derived = computeDerivedMerged(template, newRaw);
        onChange({ ...newRaw, ...derived });
        message.success(`已从 Excel 导入并填充 ${filled} 张数据表`);
        onExcelImported?.(file);
      }
      for (const n of notices) message.info(n, 6);
    } catch (err: any) {
      message.error(`导入失败: ${err.message || '未知错误'}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10,
      padding: '8px 12px', marginBottom: 14,
      background: '#f6ffed', border: '1px solid #b7eb8f', borderRadius: 8,
    }}>
      <Upload accept=".xlsx,.xls" showUploadList={false} beforeUpload={(file) => { handleUpload(file); return false; }}>
        <Button type="primary" ghost icon={<UploadOutlined />} loading={loading}>导入 Excel（自动填充所有数据表）</Button>
      </Upload>
      <span style={{ fontSize: 11, color: '#52864e' }}>
        一份 Excel 一次导入：按各数据表配置的 Sheet 自动搜寻填充；数值按设定小数位自动取整（公式格跳过）。
      </span>
      {attachments && attachments.length > 0 && (
        <span style={{ fontSize: 12, color: '#555', display: 'inline-flex', alignItems: 'center', gap: 8, flexBasis: '100%' }}>
          <span style={{ color: '#888' }}>已留存 Excel：</span>
          {attachments.map(a => (
            (recordId && !a.pending)
              ? <a key={a.id} href={`/api/excel-import/${recordId}/attachments/${a.id}`} target="_blank" rel="noreferrer">{a.filename}</a>
              : <span key={a.id} style={{ color: '#999' }} title="保存后可下载">{a.filename}（保存后可下载）</span>
          ))}
        </span>
      )}
    </div>
  );
}

/**
 * 表头备注（统一表头模型）：以小括号显示在表头标签后。
 * - 只有固定 note：静态 (note)，如单位；
 * - 配了 options：括号里变下拉（如 客户要求/标准要求），可选"其他"自定义；
 * 所选值由调用方写入 DataMatrixValue 的对应 *_overrides，PDF 端同步显示。
 */
function HeaderNoteCell({
  note, options, allowCustom, stored, onSet,
}: {
  note?: string;
  options?: string[];
  allowCustom?: boolean;
  /** 录入已选值；undefined = 未选 */
  stored?: string;
  onSet: (v: string) => void;
}) {
  const opts = options || [];
  if (!opts.length) {
    return note ? <span style={{ color: '#888', fontSize: 11, marginLeft: 2, fontWeight: 'normal' }}>({note})</span> : null;
  }
  const isCustom = stored !== undefined && !opts.includes(stored);
  const selectVal = isCustom ? '__custom__' : stored;
  return (
    <span style={{ marginLeft: 4, display: 'inline-flex', alignItems: 'center', gap: 4, fontWeight: 'normal' }}>
      (
      <Select size="small" style={{ minWidth: 88 }} value={selectVal} placeholder="选择"
        options={[
          ...opts.map(o => ({ value: o, label: o })),
          ...(allowCustom ? [{ value: '__custom__', label: '其他' }] : []),
        ]}
        onChange={(v) => { if (v === '__custom__') onSet(''); else onSet(v); }} />
      {isCustom && (
        <Input size="small" style={{ width: 80 }} value={stored} placeholder="自定义"
          onChange={(e) => onSet(e.target.value)} />
      )}
      )
    </span>
  );
}

/** 汇总行首列：固定标签 + 表头备注（如「判定要求 (客户要求)」，备注可配可选项） */
function SummaryLabelCell({
  sr,
  value,
  onChange,
}: {
  sr: import('../../../../shared/types').MatrixSummaryRowDef;
  value: import('../../../../shared/types').DataMatrixValue;
  onChange: (v: import('../../../../shared/types').DataMatrixValue) => void;
}) {
  return (
    <>
      {sr.label}
      <HeaderNoteCell
        note={sr.note}
        options={sr.note_options}
        allowCustom={sr.note_allow_custom}
        stored={value.summary_note_overrides?.[sr.id]}
        onSet={(note) => onChange({
          ...value,
          summary_note_overrides: { ...(value.summary_note_overrides || {}), [sr.id]: note },
        })}
      />
    </>
  );
}

function UnitCell({
  param,
  value,
  onChange,
}: {
  param: import('../../../../shared/types').MatrixParameterDef;
  value: string;
  onChange: (v: string) => void;
}) {
  const hasOptions = !!(param.unit_options && param.unit_options.length);
  if (!hasOptions) {
    if (!param.unit) return null;
    return <span style={{ color: '#888', fontSize: 11, marginLeft: 2 }}>({param.unit})</span>;
  }
  const opts = [...(param.unit_options || [])];
  const isCustom = !!value && !opts.includes(value);
  const selectVal = isCustom ? '__custom__' : (value || undefined);
  return (
    <span style={{ marginLeft: 4, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      (
      <Select size="small" style={{ minWidth: 64 }}
        value={selectVal}
        placeholder="单位"
        onChange={(v) => {
          if (v === '__custom__') onChange('');
          else onChange(v);
        }}
        options={[
          ...opts.map(o => ({ value: o, label: o })),
          ...(param.unit_allow_custom ? [{ value: '__custom__', label: '其他' }] : []),
        ]}
      />
      {isCustom || (param.unit_allow_custom && selectVal === '__custom__') ? (
        <Input size="small" style={{ width: 72 }} value={isCustom ? value : ''}
          placeholder="自定义"
          onChange={(e) => onChange(e.target.value)} />
      ) : null}
      )
    </span>
  );
}
