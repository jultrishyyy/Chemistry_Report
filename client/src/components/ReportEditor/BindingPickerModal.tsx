/**
 * BindingPickerModal — 可视化数据源选取器
 *
 * 模式：
 *  1. 自定义 / 委托单字段 / 系统字段 —— 表单
 *  2. 原始记录字段 —— 按分组列出可点击的字段卡片
 *  3. 原始记录矩阵单元 —— 渲染矩阵骨架；用户直接点格选中（含样品行 + 列头）
 *  4. 原始记录汇总行 —— 渲染矩阵骨架；用户点汇总行的单元格
 */
import { useState, useEffect, useMemo } from 'react';
import { Modal, Tabs, Input, Select, Tag, Button, Empty, Space, Alert, Switch } from 'antd';
import type { CellBinding, RecordTemplate, FieldDefinition } from '../../../../shared/types';

interface Props {
  open: boolean;
  value: CellBinding;
  linkedRecord: RecordTemplate | null;
  onChange: (b: CellBinding) => void;
  onClose: () => void;
  /**
   * P-Map-11：限制可见来源 tab（白名单 source 键）。缺省 undefined＝全部（按 linkedRecord 过滤）。
   * 项目检测结果表传 ['literal','record_field','record_cell','record_summary','record_header']
   * ——只暴露原始记录来源，统一两套绑定 UI。
   */
  allowedSources?: string[];
  /** 自定义弹窗标题（如「为 项目×标准 选择数据来源」）。 */
  title?: string;
  /**
   * P-Map-11c：绑定的是"试样带"那一行/列里的单元格时，传带子绑定的矩阵 code——
   * 弹窗会出「试样带·当前试样」tab（参数列→record_cell_sample / 样品名→record_sample_label）。
   * 同时 allowedSources 要含 'record_cell_sample'。
   */
  bandMatrixCode?: string;
}

// 委托单【订单级】字段（接口 1.1 PushOrderInfos 订单属性）。与 BindingEditor.tsx 对齐。
const ORDER_KEYS = [
  { value: 'order_no', label: '委托单号' },
  { value: 'customer_name', label: '委托单位' },
  { value: 'sample_name', label: '样品名称（报告范围）' },
  { value: 'received_at', label: '接收日期' },
  { value: 'test_period', label: '检测周期（开始~结束）' },
  { value: 'test_start', label: '检测开始日期' },
  { value: 'test_end', label: '检测结束日期' },
  { value: 'company_address', label: '委托单位地址' },
  { value: 'send_date', label: '送检日期' },
  { value: 'time_required', label: '客户要求期限' },
  { value: 'test_time_required', label: '检测要求期限' },
  { value: 'report_deadline', label: '报告期限' },
  { value: 'authorites', label: '证书单位' },
  { value: 'authorites_address', label: '证书单位地址' },
  { value: 'sale_name', label: '业务员' },
  { value: 'buyer', label: '买家' },
  { value: 'status', label: '委托单状态' },
  { value: 'remark', label: '订单备注' },
];

// 报告【样品信息】字段（接口 1.2 报告样品；首页单样品直接显示，多样品改用「样品信息表」字段）。
const SAMPLE_REPORT_KEYS = [
  { value: 'name', label: '样品名称' },
  { value: 'sort_no', label: '样品编号' },
  { value: 'model', label: '零件号' },
];

// 委托单【样品级】字段（接口 1.1 样品属性）。
const SAMPLE_KEYS = [
  { value: 'sample_name', label: '样品名称' },
  { value: 'barcode', label: '样品条码' },
  { value: 'sort_no', label: '样品序号' },
  { value: 'model', label: '型号' },
];

// 委托单【材料分单 / 测试项目级】字段（接口 1.1 TaskList 属性）。
const TEST_KEYS = [
  { value: 'project_name', label: '检测项目' },
  { value: 'standard', label: '标准号' },
  { value: 'main_engine_factory', label: '主机厂' },
  { value: 'test_method', label: '测试方法' },
  { value: 'test_condition', label: '测试条件' },
  { value: 'sampling_mode', label: '制样方式' },
  { value: 'sampling_requirement', label: '制样要求' },
  { value: 'limit_name', label: '限值名称（牌号）' },
  { value: 'limit_content', label: '限值内容' },
  { value: 'leader', label: '分单负责人' },
  { value: 'start_date', label: '开始测试日期' },
  { value: 'end_date', label: '结束测试日期' },
  { value: 'sample_description', label: '样品描述' },
  { value: 'test_remark', label: '检测备注' },
  { value: 'material_uploader', label: '分单人' },
  { value: 'remark', label: '制样备注' },
];

// 报告接口【页眉页脚 / 抬头字段】（接口 1.2 PushReportInfos → ReportMeta）。
// 中英文按 Language 已在服务端 buildReportMetaFromReq 选中；这里仍列出 _en 以便英文报告显式绑定。
const REPORT_META_KEYS = [
  { value: 'report_no', label: '报告编号' },
  { value: 'cover_report_no', label: '首页报告编号' },
  { value: 'verify_code', label: '检验码' },
  { value: 'issue_date', label: '签发日期' },
  { value: 'company_name', label: '公司名称' },
  { value: 'company_name_en', label: '公司名称（英）' },
  { value: 'company_address', label: '公司地址' },
  { value: 'company_address2', label: '公司地址2' },
  { value: 'company_address_en', label: '公司地址（英）' },
  { value: 'company_address2_en', label: '公司地址2（英）' },
  { value: 'fax', label: '传真' },
  { value: 'fax_en', label: '传真（英）' },
  { value: 'phone', label: '电话' },
  { value: 'phone_en', label: '电话（英）' },
  { value: 'website', label: '网址' },
  { value: 'report_note', label: '报告备注' },
  { value: 'report_note_en', label: '报告备注（英）' },
  { value: 'qualification_note', label: '资质备注' },
  { value: 'qualification_note_en', label: '资质备注（英）' },
  { value: 'customer_name', label: '客户名称' },
  { value: 'customer_address', label: '客户地址' },
];

const SYSTEM_KEYS = [
  { value: 'today', label: '今天日期' },
  { value: 'now', label: '当前时间' },
];

// P-Map-4：这些来源需要"某个具体样品/项目"的上下文（per-project resolve），只在**项目报告**（有关联原始记录）里有意义。
// 首页/封面是订单级、没有单一样品/项目上下文 → 隐藏它们，避免映射弹窗太杂乱（首页只留 自定义/委托单/报告接口/系统）。
const PROJECT_ONLY_KEYS = ['sample', 'test', 'record_field', 'record_cell', 'record_summary'];

export default function BindingPickerModal({ open, value, linkedRecord, onChange, onClose, allowedSources, title, bandMatrixCode }: Props) {
  // 从 value 推断初始 tab
  const initialTab = (() => {
    if (value.source === 'literal') return 'literal';
    if (value.source === 'order') return 'order';
    if (value.source === 'order_samples') return 'order_samples';
    if (value.source === 'sample') return 'sample';
    if (value.source === 'test') return 'test';
    if (value.source === 'report_meta') return 'report_meta';
    if (value.source === 'report_sample') return 'report_sample';
    if (value.source === 'system') return 'system';
    if (value.source === 'record_field') return 'record_field';
    if (value.source === 'record_cell' || value.source === 'record_summary') return 'record_table';
    if (value.source === 'record_header') return 'record_header';
    if (value.source === 'record_cell_sample' || value.source === 'record_sample_label' || value.source === 'record_sample_index') return 'record_band';
    return 'literal';
  })();
  const [tab, setTab] = useState(initialTab);

  useEffect(() => { if (open) setTab(initialTab); /* eslint-disable-next-line */ }, [open]);

  // 当前临时值（本地编辑，确定后提交）
  const [draft, setDraft] = useState<CellBinding>(value);
  useEffect(() => { if (open) setDraft(value); }, [open, value]);

  const matrixFields = useMemo(() => {
    if (!linkedRecord) return [];
    const list: FieldDefinition[] = [];
    for (const g of linkedRecord.groups) {
      for (const f of g.fields) if (f.type === 'data_matrix' && f.matrix) list.push(f);
    }
    return list;
  }, [linkedRecord]);

  const scalarFieldsByGroup = useMemo(() => {
    if (!linkedRecord) return [];
    return linkedRecord.groups.map(g => ({
      group: g,
      // 排除：矩阵/图片（另有 tab）、版式占位 spacer、以及【溯源信息】里的 semantic_role 字段
      // （主检/审核/检测日期/审核日期——系统自动注入的审计字段，配项目模板映射时不需要、徒增冗余）。
      fields: g.fields.filter(f => f.type !== 'data_matrix' && f.type !== 'image' && f.type !== 'spacer' && !f.semantic_role),
    })).filter(g => g.fields.length > 0);
  }, [linkedRecord]);

  const commit = () => {
    onChange(draft);
    onClose();
  };

  // 来源是否在当前模板可见：有关联原始记录（项目报告）= 全显示；否则（首页/封面）隐藏 per-project 来源。
  // P-Map-11：再叠加 allowedSources 白名单（如项目结果表只留原始记录来源）。
  const isVisible = (k: string) => {
    // 'record_band' tab 覆盖 record_cell_sample + record_sample_label 两源
    if (k === 'record_band') return !allowedSources || allowedSources.includes('record_cell_sample') || allowedSources.includes('record_sample_label') || allowedSources.includes('record_sample_index');
    // 'record_table' tab 合并数据格(record_cell) + 汇总(record_summary)两源到同一张表
    if (k === 'record_table') return !allowedSources || allowedSources.includes('record_cell') || allowedSources.includes('record_summary');
    return (!!linkedRecord || !PROJECT_ONLY_KEYS.includes(k)) &&
      (!allowedSources || allowedSources.includes(k));
  };
  const bandMatrixField = bandMatrixCode ? matrixFields.find(m => m.code === bandMatrixCode) : undefined;

  // 样品清单当前草稿（非该 source 时给默认值，便于 UI 受控）
  const osDraft = draft.source === 'order_samples'
    ? draft
    : { source: 'order_samples' as const, numbered: true, layout: 'inline' as const };

  return (
    <Modal
      title={title || '选择数据来源'}
      open={open}
      onCancel={onClose}
      onOk={commit}
      okText="确定"
      width={900}
      style={{ top: 24 }}
      // 内容过高时弹窗内容区限高并出纵向滚动条，不再溢出屏幕（标题/底部按钮固定，仅内容滚）
      styles={{ body: { maxHeight: 'calc(100vh - 160px)', overflowY: 'auto' } }}
      destroyOnClose
    >
      <Tabs
        activeKey={isVisible(tab) ? tab : 'literal'}
        onChange={(k) => {
          setTab(k);
          // 切 tab 时重置 draft 为该 source 的初始结构
          if (k === 'literal') setDraft({ source: 'literal', text: draft.source === 'literal' ? draft.text : '' });
          else if (k === 'order') setDraft({ source: 'order', key: draft.source === 'order' ? draft.key : 'order_no' });
          else if (k === 'order_samples') setDraft(draft.source === 'order_samples' ? draft : { source: 'order_samples', numbered: true, layout: 'inline' });
          else if (k === 'sample') setDraft({ source: 'sample', key: draft.source === 'sample' ? draft.key : 'sample_name' });
          else if (k === 'test') setDraft({ source: 'test', key: draft.source === 'test' ? draft.key : 'project_name' });
          else if (k === 'report_meta') setDraft({ source: 'report_meta', key: draft.source === 'report_meta' ? draft.key : 'company_name' });
          else if (k === 'system') setDraft({ source: 'system', key: draft.source === 'system' ? draft.key : 'today' });
          else if (k === 'record_field') setDraft({ source: 'record_field', field_code: draft.source === 'record_field' ? draft.field_code : '' });
          else if (k === 'report_sample') setDraft(draft.source === 'report_sample' ? draft : { source: 'report_sample', key: 'name' });
          // record_table（数据表格）：不重置 draft——用户在表里点数据格(→record_cell)或汇总格(→record_summary)即选
          else if (k === 'record_table') { /* keep draft; pick by clicking a cell/summary */ }
          else if (k === 'record_header') setDraft(draft.source === 'record_header' ? draft : { source: 'record_header', matrix_code: '', param_code: '' });
          else if (k === 'record_band') setDraft(
            (draft.source === 'record_cell_sample' || draft.source === 'record_sample_label' || draft.source === 'record_sample_index') ? draft
              : { source: 'record_sample_label', matrix_code: bandMatrixCode || '' });
        }}
        items={[
          {
            key: 'literal',
            label: '自定义',
            children: (
              <div>
                <Alert type="info" showIcon style={{ marginBottom: 12 }}
                  message="自定义：直接写一段固定文字（如「GB/T 1040.1-2025」）" />
                <Input
                  size="large"
                  placeholder="固定文字"
                  value={draft.source === 'literal' ? draft.text : ''}
                  onChange={(e) => setDraft({ source: 'literal', text: e.target.value })}
                />
                <div style={{ marginTop: 12, fontSize: 12, color: '#888' }}>
                  当前预览：<Tag color="default">{draft.source === 'literal' ? (draft.text || '(空)') : ''}</Tag>
                </div>
              </div>
            ),
          },
          {
            key: 'order',
            label: '委托单字段',
            children: (
              <div>
                <Alert type="info" showIcon style={{ marginBottom: 12 }} message="委托单字段：生成报告时取自当前订单上下文" />
                <SourceKeyList keys={ORDER_KEYS}
                  selectedKey={draft.source === 'order' ? draft.key : undefined}
                  onPick={(v) => setDraft({ source: 'order', key: v as any })}
                  placeholder="搜索委托单字段…" />
              </div>
            ),
          },
          {
            key: 'report_sample',
            label: '样品信息',
            children: (
              <div>
                <Alert type="info" showIcon style={{ marginBottom: 12 }}
                  message="样品信息（取自接口样品 SampleName / SampleSortNo / Model）"
                  description="系统按出报告时的实际样品数自动切换，无需为单/多样品分别建模板：【单样品】直接显示该样品的值；【多样品】首页不堆叠，统一显示下方占位文案（样品明细由检测结论表前的「样品信息表」字段自动列出）。" />
                <Space direction="vertical" style={{ width: '100%' }}>
                  {SAMPLE_REPORT_KEYS.map(k => (
                    <Button key={k.value} block style={{ textAlign: 'left' }}
                      type={draft.source === 'report_sample' && draft.key === k.value ? 'primary' : 'default'}
                      onClick={() => setDraft({ source: 'report_sample', key: k.value as any, multi_text: draft.source === 'report_sample' ? draft.multi_text : undefined })}>
                      <strong>{k.label}</strong>
                    </Button>
                  ))}
                  {draft.source === 'report_sample' && (
                    <Input addonBefore="多样品占位文案" placeholder="见后续页。"
                      value={draft.multi_text ?? ''}
                      onChange={(e) => setDraft({ ...draft, multi_text: e.target.value || undefined })} />
                  )}
                </Space>
              </div>
            ),
          },
          {
            key: 'order_samples',
            label: '样品清单',
            children: (
              <div>
                <Alert type="info" showIcon style={{ marginBottom: 12 }}
                  message="样品清单（报告范围，带编号）"
                  description="把委托单里全部样品拼成「1#：名称、2#：名称…」。单个样品时自动不显编号。具体值生成报告时按订单样品自动填。" />
                <Space direction="vertical" size={14} style={{ width: '100%' }}>
                  <Space size={8}>
                    <span style={{ fontSize: 13, width: 48, display: 'inline-block' }}>带编号</span>
                    <Switch checked={osDraft.numbered !== false}
                      onChange={(v) => setDraft({ ...osDraft, numbered: v })} />
                    <span style={{ fontSize: 12, color: '#888' }}>如 <b>1#：中央通道</b>（单样品时自动不显编号）</span>
                  </Space>
                  <Alert type="warning" showIcon style={{ marginTop: 4 }}
                    message="多样品请改用「样品信息表」字段"
                    description="首页单样品直接绑「委托单字段 → 样品名称/零件号」；多样品在检测结论前加一个「样品信息表」字段自动列出。此处的拼接排版已不再使用。" />
                </Space>
              </div>
            ),
          },
          {
            key: 'sample',
            label: '委托单·样品',
            children: (
              <div>
                <Alert type="info" showIcon style={{ marginBottom: 12 }}
                  message="样品字段：取自当前报告项目所属样品（接口 1.1 样品属性）" />
                <SourceKeyList keys={SAMPLE_KEYS}
                  selectedKey={draft.source === 'sample' ? draft.key : undefined}
                  onPick={(v) => setDraft({ source: 'sample', key: v as any })}
                  placeholder="搜索样品字段…" />
              </div>
            ),
          },
          {
            key: 'test',
            label: '委托单·测试项目',
            children: (
              <div>
                <Alert type="info" showIcon style={{ marginBottom: 12 }}
                  message="测试项目字段：取自当前报告项目对应的材料分单（接口 1.1 TaskList 属性）" />
                <SourceKeyList keys={TEST_KEYS}
                  selectedKey={draft.source === 'test' ? draft.key : undefined}
                  onPick={(v) => setDraft({ source: 'test', key: v as any })}
                  placeholder="搜索测试项目字段…" />
              </div>
            ),
          },
          {
            key: 'report_meta',
            label: '报告抬头信息',
            children: (
              <div>
                <Alert type="info" showIcon style={{ marginBottom: 12 }}
                  message="报告抬头信息：报告的公司名称/地址/客户名称/报告备注/资质备注等页眉页脚与抬头信息"
                  description="出报告时由系统自动带入（来自报告取号推送），首页/封面正文可直接引用，无需文员手填。中英文按报告语种自动选中。" />
                <SourceKeyList keys={REPORT_META_KEYS}
                  selectedKey={draft.source === 'report_meta' ? draft.key : undefined}
                  onPick={(v) => setDraft({ source: 'report_meta', key: v as any })}
                  placeholder="搜索报告抬头字段…" />
              </div>
            ),
          },
          {
            key: 'system',
            label: '系统字段',
            children: (
              <div>
                <Alert type="info" showIcon style={{ marginBottom: 12 }} message="系统字段：生成报告时由系统自动计算" />
                <SourceKeyList keys={SYSTEM_KEYS}
                  selectedKey={draft.source === 'system' ? draft.key : undefined}
                  onPick={(v) => setDraft({ source: 'system', key: v as any })} />
              </div>
            ),
          },
          {
            key: 'record_field',
            label: '原始记录字段',
            children: linkedRecord ? (
              <div>
                <Alert type="info" showIcon style={{ marginBottom: 12 }}
                  message={`从「${linkedRecord.name}」中选一个普通字段`}
                  description="点击下方任意字段卡片即可绑定" />
                {scalarFieldsByGroup.map(({ group, fields }) => (
                  <div key={group.id} style={{ marginBottom: 16 }}>
                    <div style={{ fontWeight: 'bold', marginBottom: 6, color: '#555' }}>{group.label}</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {fields.map(f => {
                        const selected = draft.source === 'record_field' && draft.field_code === f.code;
                        return (
                          <Button
                            key={f.code}
                            type={selected ? 'primary' : 'default'}
                            onClick={() => setDraft({ source: 'record_field', field_code: f.code })}
                            style={{ minWidth: 160, textAlign: 'left', height: 'auto', padding: '8px 12px' }}
                          >
                            <div>
                              <strong>{f.label}</strong>
                              {f.type !== 'text' && <Tag style={{ marginLeft: 6, fontSize: 10 }}>{f.type}</Tag>}
                            </div>
                            <div style={{ fontSize: 10, color: selected ? 'rgba(255,255,255,0.8)' : '#888', fontFamily: 'monospace', marginTop: 2 }}>{f.code}</div>
                          </Button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            ) : <Empty description="未关联原始记录" />,
          },
          {
            key: 'record_table',
            label: '数据表格',
            disabled: matrixFields.length === 0,
            children: linkedRecord ? (
              <MatrixCellPicker matrixFields={matrixFields} value={draft} onPick={setDraft} mode="both" />
            ) : <Empty />,
          },
          {
            key: 'record_header',
            label: '单位/要求（跟随录入）',
            disabled: matrixFields.length === 0,
            children: linkedRecord ? (
              <MatrixHeaderPicker matrixFields={matrixFields} value={draft} onPick={setDraft} />
            ) : <Empty />,
          },
          {
            key: 'record_band',
            label: '所有试样',
            children: bandMatrixField ? (
              <BandCellPicker matrixField={bandMatrixField} value={draft} onPick={setDraft} />
            ) : <Empty description="未指定试样矩阵（先在画布上把某行/列设为「按试样展开」）" />,
          },
        ].filter(it => isVisible(it.key))}
      />

      {/* 底部预览当前选中的绑定 */}
      <div style={{ marginTop: 12, padding: 10, background: '#f0f5ff', border: '1px solid #91caff', borderRadius: 4 }}>
        <strong style={{ fontSize: 12 }}>当前选择：</strong>
        <span style={{ marginLeft: 8 }}>
          <BindingSummary value={draft} linkedRecord={linkedRecord} />
        </span>
      </div>
    </Modal>
  );
}

// ─── 固定字段列表（委托单/接口/系统等）：带搜索、可点击选中，不再显示英文代码 ───
// 字段多（委托单/报告接口各十几~二十个）时用搜索快速定位；英文代码对用户无意义故隐藏。
function SourceKeyList({ keys, selectedKey, onPick, placeholder }: {
  keys: { value: string; label: string }[];
  selectedKey?: string;
  onPick: (v: string) => void;
  placeholder?: string;
}) {
  const [q, setQ] = useState('');
  const kw = q.trim().toLowerCase();
  const filtered = kw ? keys.filter(k => k.label.toLowerCase().includes(kw)) : keys;
  return (
    <div>
      {keys.length > 6 && (
        <Input.Search allowClear placeholder={placeholder || '搜索字段名…'} value={q}
          onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 10 }} />
      )}
      <Space direction="vertical" style={{ width: '100%' }}>
        {filtered.map(k => (
          <Button key={k.value} block style={{ textAlign: 'left' }}
            type={selectedKey === k.value ? 'primary' : 'default'}
            onClick={() => onPick(k.value)}>
            <strong>{k.label}</strong>
          </Button>
        ))}
        {filtered.length === 0 && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无匹配字段" />}
      </Space>
    </div>
  );
}

// ─── 矩阵格点选择器：渲染矩阵骨架供点击 ─────────────────────────────
function MatrixCellPicker({ matrixFields, value, onPick, mode }: {
  matrixFields: FieldDefinition[];
  value: CellBinding;
  onPick: (b: CellBinding) => void;
  mode: 'cell' | 'summary' | 'both';
}) {
  const canCell = mode === 'cell' || mode === 'both';
  const canSum = mode === 'summary' || mode === 'both';
  // 当前选中的矩阵：以 value 中的 matrix_code 为准，否则第一个
  const currentCode = (value.source === 'record_cell' || value.source === 'record_summary')
    ? value.matrix_code : matrixFields[0]?.code;
  const [active, setActive] = useState(currentCode || matrixFields[0]?.code || '');

  useEffect(() => { if (currentCode && currentCode !== active) setActive(currentCode); /* eslint-disable-next-line */ }, [currentCode]);

  const mf = matrixFields.find(m => m.code === active) || matrixFields[0];
  if (!mf || !mf.matrix) return <Empty description="此原始记录中无矩阵字段" />;

  const cfg = mf.matrix;
  const params = cfg.parameters || [];
  const n = cfg.default_sample_count || 1;
  const summaries = cfg.summary_rows || [];
  const prefix = cfg.row_header_prefix || '试样';
  const labels = (cfg.default_sample_labels || []) as string[];
  const rowLabel = (i: number) => labels[i] ?? `${prefix}${i + 1}`;

  return (
    <div>
      {matrixFields.length > 1 && (
        <Select size="small" style={{ width: 300, marginBottom: 12 }}
          value={active} onChange={setActive}
          options={matrixFields.map(m => ({ value: m.code, label: m.matrix?.kind === 'stats' ? `${m.label}（统计）` : m.label }))} />
      )}

      <Alert type="info" showIcon style={{ marginBottom: 12 }}
        message={mode === 'both' ? '点数据单元（绿色）绑某试样某参数；汇总行整行绑一个值，统计行（逐列，如「平均值」）须点中具体某列的格子'
          : mode === 'cell' ? '点击下方矩阵中的任意数据单元（绿色）来绑定' : '汇总行整行可绑；统计行（逐列，如「平均值」）须点中具体某列的格子'}
        description={(() => {
          const statN = summaries.filter(s => s.source_type === 'per_column_aggregate' || !!s.per_column).length;
          const sumN = summaries.length - statN;
          const parts = [sumN ? `${sumN} 个汇总行` : '', statN ? `${statN} 个统计行(逐列)` : ''].filter(Boolean);
          return `当前矩阵：${mf.label}，${n} 行 × ${params.length} 列${parts.length ? `，含 ${parts.join(' + ')}` : ''}`;
        })()} />

      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr>
              <th style={th}>{cfg.axis_header || '试样'}</th>
              {params.map(p => <th key={p.code} style={th}>{p.label}{p.unit ? ` (${p.unit})` : ''}</th>)}
            </tr>
          </thead>
          <tbody>
            {/* 样品数据行 */}
            {Array.from({ length: n }, (_, i) => (
              <tr key={i}>
                <td style={{ ...th, fontWeight: 'bold' }}>{rowLabel(i)}</td>
                {params.map(p => {
                  const isSelected = value.source === 'record_cell'
                    && value.matrix_code === mf.code && value.sample_idx === i && value.param_code === p.code;
                  const clickable = canCell;
                  return (
                    <td key={p.code}
                      style={{
                        ...td, textAlign: 'center', minWidth: 80,
                        cursor: clickable ? 'pointer' : 'not-allowed',
                        background: isSelected ? '#1677ff' : clickable ? '#f6ffed' : '#fafafa',
                        color: isSelected ? '#fff' : '#389e0d',
                        fontWeight: isSelected ? 'bold' : 'normal',
                      }}
                      onClick={() => clickable && onPick({ source: 'record_cell', matrix_code: mf.code, sample_idx: i, param_code: p.code })}>
                      {isSelected ? '✓ 已选' : clickable ? '点击选中' : '—'}
                    </td>
                  );
                })}
              </tr>
            ))}

            {/* 汇总行 */}
            {summaries.map(sr => {
              // 逐列汇总行（统计行）：per_column_aggregate（自动统计）或 per_column=true（手填/逐格公式，如「平均值」）
              // 都按【每列一格】存值（键 …__summary__rowId__paramCode），故须逐列选中→绑定带 param_code，
              // 否则按整行绑（无 param_code）出报告时取不到值。与 matrix-flatten / typst-generator 的判定保持一致。
              const isPerCol = sr.source_type === 'per_column_aggregate' || !!sr.per_column;
              return (
                <tr key={sr.id}>
                  <td style={{ ...th, fontWeight: 'bold', background: '#fff7e6' }}>{sr.label}</td>
                  {isPerCol ? (
                    params.map(p => {
                      const isSelected = value.source === 'record_summary'
                        && value.matrix_code === mf.code && value.row_id === sr.id && value.param_code === p.code;
                      const clickable = canSum;
                      return (
                        <td key={p.code}
                          style={{
                            ...td, textAlign: 'center',
                            cursor: clickable ? 'pointer' : 'not-allowed',
                            background: isSelected ? '#1677ff' : clickable ? '#fffbe6' : '#fafafa',
                            color: isSelected ? '#fff' : '#d48806',
                            fontWeight: isSelected ? 'bold' : 'normal',
                          }}
                          onClick={() => clickable && onPick({ source: 'record_summary', matrix_code: mf.code, row_id: sr.id, param_code: p.code })}>
                          {isSelected ? '✓ 已选' : clickable ? '点击选中' : '—'}
                        </td>
                      );
                    })
                  ) : (
                    (() => {
                      const isSelected = value.source === 'record_summary'
                        && value.matrix_code === mf.code && value.row_id === sr.id && !value.param_code;
                      const clickable = canSum;
                      return (
                        <td colSpan={params.length}
                          style={{
                            ...td, textAlign: 'center',
                            cursor: clickable ? 'pointer' : 'not-allowed',
                            background: isSelected ? '#1677ff' : clickable ? '#fffbe6' : '#fafafa',
                            color: isSelected ? '#fff' : '#d48806',
                            fontWeight: isSelected ? 'bold' : 'normal',
                          }}
                          onClick={() => clickable && onPick({ source: 'record_summary', matrix_code: mf.code, row_id: sr.id })}>
                          {isSelected ? '✓ 已选' : clickable ? '点击选中此汇总行' : '—'}
                        </td>
                      );
                    })()
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── 矩阵表头（录入单位/备注）选择器：选矩阵 + 参数列 → record_header ───────
function MatrixHeaderPicker({ matrixFields, value, onPick }: {
  matrixFields: FieldDefinition[];
  value: CellBinding;
  onPick: (b: CellBinding) => void;
}) {
  const currentCode = value.source === 'record_header' ? value.matrix_code : matrixFields[0]?.code;
  const [active, setActive] = useState(currentCode || matrixFields[0]?.code || '');
  useEffect(() => { if (currentCode && currentCode !== active) setActive(currentCode); /* eslint-disable-next-line */ }, [currentCode]);
  const mf = matrixFields.find(m => m.code === active) || matrixFields[0];
  if (!mf || !mf.matrix) return <Empty description="此原始记录中无矩阵字段" />;
  const params = mf.matrix.parameters || [];
  return (
    <div>
      <Alert type="info" showIcon style={{ marginBottom: 12 }}
        message="让这个表头跟随【录入时所选的单位/备注】"
        description="数据录入时，每个参数列的表头括号里可以选单位（mm/min、cm/min…）或备注（客户要求 / 标准要求）。在下面点一个参数列，这个表头就会显示那一列【录入时实际选的】值；录入没选时退回该列的默认单位。" />
      {matrixFields.length > 1 && (
        <div style={{ marginBottom: 8 }}>
          <span style={{ fontSize: 12, color: '#888', marginRight: 6 }}>原始记录矩阵：</span>
          <Select size="small" style={{ width: 240 }}
            value={active} onChange={setActive}
            options={matrixFields.map(m => ({ value: m.code, label: m.label }))} />
        </div>
      )}
      <div style={{ fontSize: 12, color: '#555', marginBottom: 6 }}>点一个参数列（取它的录入单位/备注）：</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {params.map(p => {
          const selected = value.source === 'record_header' && value.matrix_code === mf.code && value.param_code === p.code;
          const tag = p.unit_options?.length ? '录入可选' : (p.unit ? '固定单位' : '');
          return (
            <Button key={p.code}
              type={selected ? 'primary' : 'default'}
              onClick={() => onPick({ source: 'record_header', matrix_code: mf.code, param_code: p.code })}
              style={{ minWidth: 150, textAlign: 'left', height: 'auto', padding: '8px 12px' }}>
              <div><strong>{p.label}</strong>{tag ? <Tag color={p.unit_options?.length ? 'green' : 'default'} style={{ marginLeft: 6, fontSize: 10 }}>{tag}</Tag> : null}</div>
              <div style={{ fontSize: 10, color: selected ? 'rgba(255,255,255,0.8)' : '#888', marginTop: 2 }}>
                {p.unit_options?.length ? `录入时可选：${p.unit_options.join(' / ')}` : (p.unit ? `单位：${p.unit}` : '无单位/备注')}
              </div>
            </Button>
          );
        })}
        {params.length === 0 && <Empty description="此矩阵无参数列" />}
      </div>
    </div>
  );
}

// ─── 试样带·当前试样 选择器：点矩阵【列头】=取该列值 / 点【试样】列=取样品名 ─────
function BandCellPicker({ matrixField, value, onPick }: {
  matrixField: FieldDefinition;
  value: CellBinding;
  onPick: (b: CellBinding) => void;
}) {
  if (!matrixField.matrix) return <Empty description="该矩阵无参数列" />;
  const cfg = matrixField.matrix;
  const code = matrixField.code;
  const params = cfg.parameters || [];
  const n = Math.min(cfg.default_sample_count || 2, 3);
  const prefix = cfg.row_header_prefix || '试样';
  const labelSel = value.source === 'record_sample_label' && value.matrix_code === code;
  const indexSel = value.source === 'record_sample_index' && value.matrix_code === code;
  const paramSel = (pc: string) => value.source === 'record_cell_sample' && value.matrix_code === code && value.param_code === pc;
  return (
    <div>
      <Alert type="info" showIcon style={{ marginBottom: 12 }}
        message={`「${matrixField.label}」里：每个【试样】是一行、每个参数是一列`}
        description="会按实际录入的试样数自动展开（一个试样一份）。下面三选一：① 点「试样序号」= 自动 1,2,3…；② 点最左「试样」列头 = 取试样名称；③ 点某【参数列头】= 每个试样取该列的值。" />
      <div style={{ marginBottom: 10 }}>
        <Button type={indexSel ? 'primary' : 'default'}
          onClick={() => onPick({ source: 'record_sample_index', matrix_code: code })}>
          试样序号（自动 1, 2, 3 …）{indexSel ? ' ✓' : ''}
        </Button>
        <span style={{ marginLeft: 8, fontSize: 11, color: '#888' }}>用于「试样编号」列：按展开顺序自动递增</span>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr>
              <th
                onClick={() => onPick({ source: 'record_sample_label', matrix_code: code })}
                style={{ ...th, cursor: 'pointer', background: labelSel ? '#1677ff' : '#e6f4ff', color: labelSel ? '#fff' : '#1677ff', fontWeight: 'bold' }}
                title="点此：每个试样取【试样名称】">
                {cfg.axis_header || '试样'}{labelSel ? ' ✓' : ''}
              </th>
              {params.map(p => {
                const sel = paramSel(p.code);
                return (
                  <th key={p.code}
                    onClick={() => onPick({ source: 'record_cell_sample', matrix_code: code, param_code: p.code })}
                    style={{ ...th, cursor: 'pointer', minWidth: 90, background: sel ? '#1677ff' : '#f6ffed', color: sel ? '#fff' : '#389e0d', fontWeight: 'bold' }}
                    title={`点此：每个试样取【${p.label}】列的值`}>
                    {p.label}{p.unit ? ` (${p.unit})` : ''}{sel ? ' ✓' : ''}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: n }, (_, i) => (
              <tr key={i}>
                <td style={{ ...td, fontWeight: 'bold', color: '#888', background: '#fafafa' }}>{prefix}{i + 1}</td>
                {params.map(p => (
                  <td key={p.code} style={{ ...td, textAlign: 'center', color: '#ccc' }}>
                    {paramSel(p.code) ? '↑取此列' : '…'}
                  </td>
                ))}
              </tr>
            ))}
            <tr><td colSpan={params.length + 1} style={{ ...td, textAlign: 'center', color: '#bbb', background: '#fafafa' }}>…按实际试样数展开…</td></tr>
          </tbody>
        </table>
      </div>
      {params.length === 0 && <Empty description="此矩阵无参数列" />}
    </div>
  );
}

/** 紧凑型 binding 概要：用在单元格按钮上显示当前绑定内容 */
export function BindingSummary({ value, linkedRecord }: { value: CellBinding; linkedRecord?: RecordTemplate | null }) {
  const matrixLabel = (code: string) => {
    if (linkedRecord) for (const g of linkedRecord.groups) {
      const mf = g.fields.find(x => x.code === code);
      if (mf) return mf.label;
    }
    return code;
  };
  const paramLabel = (code: string, param: string) => {
    if (linkedRecord) for (const g of linkedRecord.groups) {
      const mf = g.fields.find(x => x.code === code);
      if (mf && mf.matrix) { const p = mf.matrix.parameters.find(p => p.code === param); if (p) return p.label; }
    }
    return param;
  };
  if (value.source === 'record_header') {
    return <span><Tag color="cyan">表头</Tag><span style={{ marginLeft: 4 }}>{matrixLabel(value.matrix_code)} · {paramLabel(value.matrix_code, value.param_code)} 录入单位</span></span>;
  }
  if (value.source === 'record_cell_sample') {
    return <span><Tag color="green">试样</Tag><span style={{ marginLeft: 4 }}>{matrixLabel(value.matrix_code)} · 所有试样 · {paramLabel(value.matrix_code, value.param_code)}</span></span>;
  }
  if (value.source === 'record_sample_label') {
    return <span><Tag color="green">试样</Tag><span style={{ marginLeft: 4 }}>{matrixLabel(value.matrix_code)} · 所有试样名</span></span>;
  }
  if (value.source === 'record_sample_index') {
    return <span><Tag color="green">试样</Tag><span style={{ marginLeft: 4 }}>试样序号（自动 1,2,3…）</span></span>;
  }
  if (value.source === 'literal') {
    return <span><Tag color="default">自定义</Tag><span style={{ marginLeft: 4 }}>{value.text || '(空)'}</span></span>;
  }
  if (value.source === 'order') {
    const label = ORDER_KEYS.find(k => k.value === value.key)?.label || value.key;
    return <span><Tag color="purple">委托单</Tag><span style={{ marginLeft: 4 }}>{label}</span></span>;
  }
  if (value.source === 'order_samples') {
    return <span><Tag color="purple">委托单</Tag><span style={{ marginLeft: 4 }}>样品清单{value.numbered !== false ? '（带编号' : '（无编号'}{value.layout === 'lines' ? '·分行）' : '·一行）'}</span></span>;
  }
  if (value.source === 'sample') {
    const label = SAMPLE_KEYS.find(k => k.value === value.key)?.label || value.key;
    return <span><Tag color="purple">样品</Tag><span style={{ marginLeft: 4 }}>{label}</span></span>;
  }
  if (value.source === 'test') {
    const label = TEST_KEYS.find(k => k.value === value.key)?.label || value.key;
    return <span><Tag color="purple">测试项目</Tag><span style={{ marginLeft: 4 }}>{label}</span></span>;
  }
  if (value.source === 'report_meta') {
    const label = REPORT_META_KEYS.find(k => k.value === value.key)?.label || value.key;
    return <span><Tag color="geekblue">报告抬头</Tag><span style={{ marginLeft: 4 }}>{label}</span></span>;
  }
  if (value.source === 'report_sample') {
    const label = SAMPLE_REPORT_KEYS.find(k => k.value === value.key)?.label || value.key;
    return <span><Tag color="cyan">样品信息</Tag><span style={{ marginLeft: 4 }}>{label}</span></span>;
  }
  if (value.source === 'system') {
    const label = SYSTEM_KEYS.find(k => k.value === value.key)?.label || value.key;
    return <span><Tag color="purple">系统</Tag><span style={{ marginLeft: 4 }}>{label}</span></span>;
  }
  if (value.source === 'record_field') {
    let label = value.field_code;
    if (linkedRecord) {
      for (const g of linkedRecord.groups) {
        const f = g.fields.find(x => x.code === value.field_code);
        if (f) { label = f.label; break; }
      }
    }
    return <span><Tag color="blue">字段</Tag><span style={{ marginLeft: 4 }}>{label || '(未选)'}</span></span>;
  }
  if (value.source === 'record_cell') {
    let mfLabel = value.matrix_code;
    let pLabel = value.param_code;
    let rowLabel = '';
    if (linkedRecord) {
      for (const g of linkedRecord.groups) {
        const mf = g.fields.find(x => x.code === value.matrix_code);
        if (mf && mf.matrix) {
          mfLabel = mf.label;
          const p = mf.matrix.parameters.find(p => p.code === value.param_code);
          if (p) pLabel = p.label;
          // 行名直接取原表格的行标签（default_sample_labels），无则回退「{前缀} N」
          const prefix = mf.matrix.row_header_prefix || '试样';
          rowLabel = mf.matrix.default_sample_labels?.[value.sample_idx] || `${prefix} ${value.sample_idx + 1}`;
          break;
        }
      }
    }
    if (!rowLabel) rowLabel = `行${value.sample_idx + 1}`;  // 无关联记录时兜底
    return <span><Tag color="green">矩阵格</Tag><span style={{ marginLeft: 4 }}>{mfLabel} · {rowLabel} · {pLabel}</span></span>;
  }
  if (value.source === 'record_summary') {
    let mfLabel = value.matrix_code;
    let rowLabel = value.row_id;
    if (linkedRecord) {
      for (const g of linkedRecord.groups) {
        const mf = g.fields.find(x => x.code === value.matrix_code);
        if (mf && mf.matrix) {
          mfLabel = mf.label;
          const r = mf.matrix.summary_rows?.find(r => r.id === value.row_id);
          if (r) rowLabel = r.label;
          break;
        }
      }
    }
    return <span><Tag color="gold">汇总</Tag><span style={{ marginLeft: 4 }}>{mfLabel} · {rowLabel}{value.param_code ? ` / ${value.param_code}` : ''}</span></span>;
  }
  return <span style={{ color: '#aaa' }}>（未配置）</span>;
}

const th: React.CSSProperties = { border: '1px solid #ddd', padding: '6px 10px', background: '#fafafa' };
const td: React.CSSProperties = { border: '1px solid #ddd', padding: '6px 10px' };
