import { useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Alert, Button, Checkbox, Collapse, Modal, Select, Space, Table, Tabs, Tooltip, Upload, message } from 'antd';
import ExcelSheetPreview from './ExcelSheetPreview';
import { QuestionCircleOutlined, UploadOutlined } from '@ant-design/icons';
import axios from 'axios';
import type { FieldDefinition } from '../../../shared/types';
import { chooseImportSheet, columnName, describeImportTarget, findImportRegions, importConfig, planExcelImport, rangeName, reviewImportAssignments, sourceParameterLabels, suggestImportMapping, type ImportRange, type ImportSheet } from '../../../shared/excel-import';

type Choice = { sheet?: string; range?: ImportRange; axis: 'row' | 'col'; mapping: number[]; reasons: string[]; skip: boolean; rowPage: number; colPage: number };
export default function ExcelImportWizard({ fields, data, onApply, renderPreview }: {
  fields: FieldDefinition[]; data: Record<string, any>; onApply: (updates: Record<string, any>, file: File) => void;
  renderPreview?: (field: FieldDefinition, simulated: Record<string, any>) => ReactNode;
}) {
  const [loading, setLoading] = useState(false), [open, setOpen] = useState(false);
  const [step, setStep] = useState<'choose' | 'review'>('choose');
  const [validation, setValidation] = useState('');
  const [sheets, setSheets] = useState<ImportSheet[]>([]), [file, setFile] = useState<File | null>(null);
  const [choices, setChoices] = useState<Record<string, Choice>>({}), [baseline, setBaseline] = useState('');
  const [reuseConfirmed, setReuseConfirmed] = useState(false), [active, setActive] = useState('');
  const committing = useRef(false);
  const update = (code: string, patch: Partial<Choice>) => { setChoices(current => ({ ...current, [code]: { ...current[code], ...patch } })); setReuseConfirmed(false); setValidation(''); };
  const configure = (field: FieldDefinition, sheet: ImportSheet | undefined, axis: 'row' | 'col', range?: ImportRange): Choice => {
    const target = describeImportTarget(field, data[field.code]);
    const config = importConfig(field);
    let selectedRange = range;
    if (!selectedRange && sheet) {
      const regions = findImportRegions(sheet, axis, target.params);
      selectedRange = regions[0];
      if (config?.mode !== 'auto' && config?.data_start_row != null && config?.data_start_col != null) {
        const r0 = config.data_start_row, c0 = config.data_start_col;
        const rows = sheet.grid.length, cols = Math.max(0, ...sheet.grid.map(row => row.length));
        if (r0 < rows && c0 < cols) selectedRange = { r0, c0,
          r1: Math.min(rows - 1, r0 + (axis === 'row' ? Math.max(target.cells.length, (regions.find(r => r.r0 >= r0)?.r1 ?? r0) - r0 + 1) : target.params.length) - 1),
          c1: Math.min(cols - 1, c0 + (axis === 'row' ? target.params.length : Math.max(1, target.cells.length)) - 1) };
      }
    }
    const suggestion = sheet && selectedRange ? suggestImportMapping(target.params, sourceParameterLabels(sheet, selectedRange, axis)) : { indexes: [], reasons: [] };
    return { sheet: sheet?.name, range: selectedRange, axis, mapping: suggestion.indexes, reasons: suggestion.reasons, skip: false,
      rowPage: 1, colPage: 1 };
  };
  const upload = async (incoming: File) => {
    if (new Set(fields.map(field => field.code)).size !== fields.length) { message.error('模板中存在重复表格标识，请先修正模板后再导入'); return; }
    if (!/\.xlsx$/i.test(incoming.name)) { message.warning('请将文件另存为.xlsx后导入'); return; }
    setLoading(true);
    try {
      const form = new FormData(); form.append('file', incoming);
      const response = await axios.post<{ sheets: ImportSheet[] }>('/api/excel-import/workbook', form);
      const parsed = response.data.sheets;
      const next: Record<string, Choice> = {};
      fields.forEach(field => {
        const name = chooseImportSheet(importConfig(field)?.sheet_name, parsed);
        next[field.code] = configure(field, parsed.find(sheet => sheet.name === name), describeImportTarget(field, data[field.code]).axis);
      });
      setSheets(parsed); setChoices(next); setFile(incoming); setBaseline(JSON.stringify(data)); setReuseConfirmed(false); setActive(fields[0]?.code); committing.current = false; setValidation(''); setStep('choose'); setOpen(true);
    } catch (error: any) { message.error(error.response?.data?.error || error.message || '读取失败，请重新上传'); }
    finally { setLoading(false); }
  };
  const plans = useMemo(() => Object.fromEntries(fields.map(field => {
    const choice = choices[field.code], sheet = sheets.find(s => s.name === choice?.sheet);
    return [field.code, choice && !choice.skip && choice.range && sheet ? planExcelImport(field, data[field.code], sheet, choice.range, choice.axis, choice.mapping) : null];
  })), [fields, choices, sheets, data]);
  const participating = fields.filter(f => !choices[f.code]?.skip);
  const simulated = { ...data, ...Object.fromEntries(participating.filter(f => plans[f.code] && !plans[f.code]!.issues.length).map(f => [f.code, plans[f.code]!.value])) };
  const review = reviewImportAssignments(fields.map(field => ({ code: field.code, sheet: choices[field.code]?.sheet, range: choices[field.code]?.range,
    skip: !!choices[field.code]?.skip, reviewed: true, valid: !!plans[field.code] && !plans[field.code]!.issues.length })), reuseConfirmed);
  const overlaps = review.overlaps.map(pair => pair.map(code => fields.find(f => f.code === code)?.label || code).join(' / '));
  const ready = review.ready;
  const close = () => { setOpen(false); setSheets([]); setChoices({}); setFile(null); setValidation(''); };
  const apply = () => {
    if (!file || committing.current) return;
    if (!ready) {
      const invalid = participating.find(field => !plans[field.code] || plans[field.code]!.issues.length);
      const reason = !participating.length ? '请至少保留一张需要导入的表格。' : invalid
        ? `「${invalid.label}」${plans[invalid.code]?.issues.join('；') || '尚未确定来源工作表或数据区域，请选择来源并框选区域，或跳过此表格。'}`
        : '部分表格使用了重叠的来源区域，请确认是否需要复用数据。';
      if (invalid) setActive(invalid.code);
      setValidation(reason); setStep('review'); return;
    }
    if (baseline !== JSON.stringify(data)) {
      setBaseline(JSON.stringify(data));
      setStep('review'); setValidation('录入数据已变化，请查看最新预览后再次确认导入。');
      message.warning('录入数据已变化，预览已重新计算，请重新核对并确认'); return;
    }
    const updates = Object.fromEntries(participating.map(f => [f.code, plans[f.code]!.value]));
    committing.current = true;
    try { onApply(updates, file); }
    catch (error: any) { committing.current = false; message.error(error.message || '应用导入失败，请重试'); return; }
    close();
  };
  return <>
    <Upload disabled={loading} accept=".xlsx" showUploadList={false} beforeUpload={incoming => { void upload(incoming); return false; }}>
      <Button type="primary" ghost loading={loading} icon={<UploadOutlined />}>导入 Excel</Button>
    </Upload>
    <Modal title="选择导入方式" open={open && step === 'choose'} onCancel={close} footer={null} width="min(480px, 96vw)">
      <p style={{ overflowWrap: 'anywhere' }}>{file?.name}</p>
      <p>直接导入将自动匹配各表格的数据，可能覆盖已有录入值；需要查看或调整来源时，请选择核对导入信息。</p>
      <Space wrap style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button onClick={() => setStep('review')}>核对导入信息</Button>
        <Button type="primary" onClick={apply}>直接导入</Button>
      </Space>
    </Modal>
    <Modal className="excel-import-modal" title={<div title={file?.name}>导入 Excel{file ? <span className="excel-import-filename"> · {file.name}</span> : null}</div>}
      open={open && step === 'review'} width="min(1200px, 96vw)" style={{ top: '3vh', paddingBottom: 0 }}
      styles={{ body: { maxHeight: 'calc(94dvh - 150px)', overflowY: 'auto', overflowX: 'hidden', minWidth: 0 } }} destroyOnHidden
      onCancel={close} onOk={apply}
      okText={`确认导入 ${participating.length} 张表格`} cancelText="取消">
      {!!validation && <Alert type="warning" showIcon message={validation} style={{ marginTop: 8 }} />}
      {sheets.some(sheet => sheet.unavailable_reason) && <Alert type="warning" showIcon style={{ marginTop: 8 }}
        message="部分工作表数据量过大，未加载；其它工作表仍可正常导入"
        description={sheets.filter(sheet => sheet.unavailable_reason).map(sheet => sheet.unavailable_reason).join('；')} />}
      <div style={{ margin: '10px 0' }}>本次导入 {participating.length} 张表格，跳过 {fields.length - participating.length} 张；覆盖 {participating.reduce((n, f) => n + (plans[f.code]?.overwritten || 0), 0)} 格，新增 {participating.reduce((n, f) => n + (plans[f.code]?.added || 0), 0)} 个试样。</div>
      {!!overlaps.length && <Alert type="warning" message={`来源区域重叠：${overlaps.join('；')}`} description={<Checkbox checked={reuseConfirmed} onChange={e => setReuseConfirmed(e.target.checked)}>确认这些表格需要复用来源数据</Checkbox>} />}
      <Tabs activeKey={active} onChange={setActive} items={fields.map(field => {
        const choice = choices[field.code]; if (!choice) return { key: field.code, label: field.label, children: null };
        const target = describeImportTarget(field, data[field.code]);
        const sheet = sheets.find(s => s.name === choice.sheet), plan = plans[field.code];
        const labels = sheet && choice.range ? sourceParameterLabels(sheet, choice.range, choice.axis) : [];
        const candidates = sheet ? findImportRegions(sheet, choice.axis, target.params) : [];
        const selected = choice.range;
        const pickRegion = (range: ImportRange) => {
          if (!sheet) return;
          const next = configure(field, sheet, choice.axis, range);
          update(field.code, { ...next, rowPage: choice.rowPage, colPage: choice.colPage });
        };
        const ignored = labels.filter((_, i) => !choice.mapping.includes(i));
        return { key: field.code, label: <span className="excel-import-tab-label" title={field.label}>{field.label} · {choice.skip ? '已跳过' : plan && !plan.issues.length ? '待导入' : '需调整'}</span>, children: <div className="excel-import-tab-content">
          <Space>
            <Button type={choice.skip ? 'primary' : 'default'} onClick={() => update(field.code, { skip: !choice.skip })}>{choice.skip ? '恢复导入此表格' : '跳过此表格'}</Button>
            <Tooltip title="跳过此表格就是本次不导入这个表格，已有内容保持不变，不影响其他表格。"><Button type="text" shape="circle" size="small" aria-label="跳过此表格说明" icon={<QuestionCircleOutlined />} /></Tooltip>
          </Space>
          <Space wrap>
            <span>来源Sheet</span><Select style={{ width: 230 }} value={choice.sheet} disabled={choice.skip} placeholder="请选择工作表" options={sheets.map(s => ({ value: s.name, label: `${s.name}${s.unavailable_reason ? '（未加载）' : s.hidden ? '（隐藏）' : ''}` }))}
              onChange={name => update(field.code, configure(field, sheets.find(s => s.name === name), choice.axis))} />
          </Space>
          {!choice.skip && !sheet && <Alert type="warning" message={importConfig(field)?.sheet_name ? `未找到配置的Sheet“${importConfig(field)!.sheet_name}”，请选择替代Sheet或跳过` : '工作簿包含多个Sheet，请选择此表的来源或跳过'} />}
          {!choice.skip && sheet?.unavailable_reason && <Alert type="warning" showIcon message={sheet.unavailable_reason} description="请选择其它来源Sheet，或本次跳过此表；不会导入不完整的数据。" />}
          {!choice.skip && sheet && !sheet.unavailable_reason && <>
            {candidates.length > 1 && <Alert type="warning" message="发现多个候选数据区域，请核对当前区域是否属于这张表；不要将汇总、限值或编号误作为检测数据。" />}
            <Space wrap>
              <span>{selected ? `导入区域：${rangeName(selected)}` : '请框选需要导入的数据区域'}</span>
              <Select aria-label="Excel数据排列" value={choice.axis} style={{ width: 210 }} options={[{ value: 'row', label: '每行一个试样（参数在列）' }, { value: 'col', label: '每列一个试样（参数在行）' }]}
                onChange={axis => update(field.code, configure(field, sheet, axis))} />
            </Space>
            <ExcelSheetPreview sheet={sheet} selected={selected} availableRanges={candidates} writingCells={plan?.changes.map(change => change.source) || []}
              rowPage={choice.rowPage} colPage={choice.colPage}
              onPage={page => setChoices(current => ({ ...current, [field.code]: { ...current[field.code], ...page } }))}
              onPick={pickRegion} />
            {!!sheet.notices.length && <Alert type="warning" message={`Sheet有${sheet.notices.length}项解析提示`} description={<div style={{ maxHeight: 100, overflow: 'auto' }}>{sheet.notices.map((n, i) => <div key={i}>{n}</div>)}</div>} />}
            {selected && <>
              <Collapse items={[{ key: 'mapping', label: `调整参数对应（按${choice.axis === 'row' ? '列' : '行'}）`, children: <Table size="small" tableLayout="fixed" scroll={{ x: 520 }} pagination={false} rowKey="id" dataSource={target.params.map((param, index) => ({ ...param, index }))} columns={[
                { title: '原始记录参数', dataIndex: 'label', render: (label, param) => `${label}${param.unit ? `（${param.unit}）` : ''}` },
                { title: choice.axis === 'row' ? 'Excel 来源列' : 'Excel 来源行', render: (_, param) => <Select style={{ width: '100%' }} value={choice.mapping[param.index] ?? -1}
                  options={[{ value: -1, label: '不导入此参数' }, ...labels.map((label, i) => ({ value: i, label: `${choice.axis === 'row' ? `${columnName(selected.c0 + i)} 列` : `第 ${selected.r0 + i + 1} 行`} · ${label}` }))]}
                  onChange={index => { const mapping = [...choice.mapping], reasons = [...choice.reasons]; mapping[param.index] = index; reasons[param.index] = '人工对应'; update(field.code, { mapping, reasons }); }} /> },
              ]} /> }]} />
              {choice.mapping.some(index => index < 0) && <Alert type="info" message={`未导入的参数：${target.params.filter((_, i) => (choice.mapping[i] ?? -1) < 0).map(param => param.label).join('、')}。这些参数保留原值，不会用其他列或行补位。`} />}
              {choice.reasons.some(reason => reason.startsWith('近似名称') || reason.startsWith('按顺序')) && <Alert type="warning" showIcon message="部分参数使用相近名称或无表头的顺序匹配，请核对。" description="可展开“调整参数对应”修改来源行或列，也可重新框选区域。" />}
              {!!ignored.length && <Alert type="warning" message="选区中部分行或列未对应参数，不会导入；可展开“调整参数对应”修改。" />}
              {!!plan?.issues.length && <Alert type="warning" message={plan.issues.join('；')} />}
              {(choice.mapping.some(index => index < 0) || ignored.length > 0 || (plan?.skipped || 0) > 0 || !!plan?.issues.length
                || choice.reasons.some(reason => reason.startsWith('近似名称') || reason.startsWith('按顺序'))
                || (choice.axis === 'row' ? selected.r1 - selected.r0 + 1 : selected.c1 - selected.c0 + 1) < target.cells.length) &&
                <Alert type="info" showIcon message="填充不全或匹配不正确？也可以直接从 Excel 复制所需区域，关闭此窗口后，在原始记录表格中点击要开始填入的格子并粘贴。" />}
              {plan && <>
                <div>将写入 {plan.changes.length} 格，覆盖 {plan.overwritten} 格，新增 {plan.added} 个试样，跳过 {plan.skipped} 格。空值不覆盖，已有多余试样保留。</div>
                {renderPreview && !plan.issues.length && <section style={{ minWidth: 0, border: '1px solid #d9d9d9', borderRadius: 6, padding: 10 }}>
                  <strong>导入后表格预览</strong>
                  {renderPreview(field, simulated)}
                </section>}
              </>}
            </>}
          </>}
        </div> };
      })} />
    </Modal>
  </>;
}
