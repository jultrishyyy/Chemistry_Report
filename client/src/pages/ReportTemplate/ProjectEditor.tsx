/**
 * ProjectEditor — 项目报告模板编辑器（v3）
 * 复用 FieldEditor，editorMode='report-project'；公共外壳走 useReportTemplateEditor。
 */
import { useState, useMemo } from 'react';
import { Button, Spin, Tag, Alert, Switch, Tooltip, Input } from 'antd';
import { SaveOutlined, EyeOutlined, PlusOutlined, DeleteOutlined, QuestionCircleOutlined, RollbackOutlined } from '@ant-design/icons';
import axios from 'axios';
import FieldEditor from '../../components/FieldEditor';
import EditorSplit from '../../components/EditorSplit';
import TemplateVersionPanel from '../../components/TemplateVersionPanel';
import TypstViewer, { type PosMarker } from '../../components/TypstViewer';
import BindingPickerModal, { BindingSummary } from '../../components/ReportEditor/BindingPickerModal';
import { generateTypst, injectReportFieldsIntoTypst, type ReportRenderCtx } from '../../../../shared/typst-generator';
import { generateMockData } from '../../../../shared/mock-data';
import { validateReportBindings, validateProjectConclusions } from '../../../../shared/binding-integrity';
import type { RecordTemplate, ProjectConclusionDecl, CellBinding } from '../../../../shared/types';
import { PREVIEW_HF_VALUES, STANDARD_HF_LAYOUT } from './preview-hf';
import { useReportTemplateEditor } from './useReportTemplateEditor';

const API = '/api';

// 项目模板的检测结论只能取自【原始记录】（字段 / 矩阵格 / 汇总 / 表头单位 + 自定义），
// 不暴露委托单/样品/测试/报告接口/系统等首页级来源——避免冗余、且结论本就是原始记录的判定值。
const RECORD_ONLY_SOURCES = ['literal', 'record_field', 'record_cell', 'record_summary', 'record_header'];

const EMPTY: RecordTemplate = {
  name: '项目模板',
  version: 1,
  groups: [{ id: 'g_proj', label: '项目内容', layout: 'vertical', fields: [] }],
  // 项目模板默认字体＝仿宋_GB2312（无粗体字体，加粗走 faux-bold 描边）
  layout_options: { theme_config: { font: 'FangSong_GB2312' } },
};

export default function ProjectEditor() {
  const [linkedRecord, setLinkedRecord] = useState<RecordTemplate | null>(null);

  // 公共外壳：加载完成后按 linked_record_template_id 拉关联原始记录
  const ed = useReportTemplateEditor({
    emptyTemplate: EMPTY,
    onLoaded: (data) => {
      if (data?.linked_record_template_id) {
        axios.get(`${API}/record-templates/${data.linked_record_template_id}`)
          .then(r => setLinkedRecord({
            id: r.data.id, name: r.data.name, version: r.data.version,
            groups: r.data.field_definitions, layout_options: r.data.layout_options || {},
          }))
          .catch(() => {});
      } else {
        setLinkedRecord(null);
      }
    },
  });
  const {
    id, navigate, readonly, pendingReview, reload, rollbackTo, template, setTemplate, meta, viewingVersion, versionMeta,
    loading, saving, mockPreview, setMockPreview, viewerRef, selectRequest, setSelectRequest,
    handleSave, confirmLeave,
  } = ed;

  // ─── 6.7 项目检测结论声明（项目名 + 子项目结论列表，存 layout_options）────────────
  const lo = template.layout_options || {};
  const projectName: string = lo.project_name || '';
  const conclusions: ProjectConclusionDecl[] = Array.isArray(lo.conclusions) ? lo.conclusions : [];
  const [conclEdit, setConclEdit] = useState<string | null>(null);   // 正在选数据来源的结论 id
  const [conclOpen, setConclOpen] = useState<boolean | null>(null);   // 结论面板展开态：null=自动(未填则展开/填好则收起)，否则用户手动开合
  const setLayout = (patch: Record<string, any>) =>
    setTemplate({ ...template, layout_options: { ...(template.layout_options || {}), ...patch } });
  const setConclusions = (next: ProjectConclusionDecl[]) => setLayout({ conclusions: next });
  const addConclusion = () => setConclusions([
    ...conclusions,
    { id: `concl_${Date.now()}_${Math.floor(Math.random() * 1e4)}`, sub_name: '', binding: { source: 'literal', text: '' } },
  ]);
  const updateConclusion = (cid: string, patch: Partial<ProjectConclusionDecl>) =>
    setConclusions(conclusions.map(c => c.id === cid ? { ...c, ...patch } : c));
  const removeConclusion = (cid: string) => setConclusions(conclusions.filter(c => c.id !== cid));
  const editingConcl = conclusions.find(c => c.id === conclEdit) || null;
  // 必填校验：项目名 + 至少一条结论且各有数据来源；多子项目时每条须填子项目名
  const conclErrors = validateProjectConclusions(projectName, conclusions);
  // 默认收起一小条（不挡字段编辑视野）；未填时自动展开提醒、填好后自动收起；用户可手动开合
  const conclOpenEff = conclOpen === null ? conclErrors.length > 0 : conclOpen;
  const conclHelp = (
    <div style={{ maxWidth: 320, fontSize: 12, lineHeight: 1.7 }}>
      <div><b>项目名称</b>：最终显示在报告对应章节的<b>标题</b>（如「1) 密度」，序号生成时按结论表自动编）。</div>
      <div style={{ marginTop: 4 }}><b>子项目名称</b>：显示在首页<b>检测结论表</b>里。只有一个项目时可留空＝默认用项目名称；有<b>多个子项目时必须</b>分别填写。</div>
      <div style={{ marginTop: 4 }}><b>数据来源</b>：每条结论指向关联原始记录里该（子）项目的判定值（符合/不符合 等）。</div>
    </div>
  );

  // 实时映射完整性校验：报告绑定 + 检测结论声明 vs 关联原始记录当前版本字段集
  const bindingWarnings = useMemo(
    () => (linkedRecord ? validateReportBindings(template.groups, linkedRecord.groups, conclusions) : []),
    [template, linkedRecord, conclusions]
  );

  const mockData = useMemo(() => linkedRecord ? generateMockData(linkedRecord) : {}, [linkedRecord]);

  const typstPreview = useMemo(() => {
    // 项目报告＝正文页：不出大标题/副标题，也不再自动注入项目名标题（"有什么字段才显示什么"）。
    // 页眉页脚由系统统一写死（标准版式），覆盖整篇报告；预览始终带上标准页眉页脚 + 示例值，所见即所得。
    const previewTpl: RecordTemplate = {
      ...template,
      layout_options: {
        ...(template.layout_options || {}),
        suppress_title: true,
        subtitle: '',
        header_footer: { ...PREVIEW_HF_VALUES, ...STANDARD_HF_LAYOUT, enabled: true },
      },
    };
    const src = generateTypst(previewTpl);
    if (!mockPreview) return src;
    const ctx: ReportRenderCtx = {
      order: { order_no: 'C202512086592', customer_name: '奇瑞汽车', sample_name: '车门内饰板' },
      report_meta: {
        report_no: 'WT示例-01', verify_code: 'GDJL-示例', issue_date: '2026-06-08',
        company_name: '广电计量检测（集团）化学检测中心', customer_name: '奇瑞汽车股份有限公司',
        report_note: '本报告仅对来样负责。', qualification_note: 'CMA  CNAS',
      },
      record_flat_data: mockData,
      record_raw_data: mockData,
      linked_record_template: linkedRecord,
      equipment_rows: [
        { name: '万能材料试验机', model: 'INSTRON 5967', asset_code: 'HX2020-G101', trace_date: '2025-02-08', expire_date: '2026-02-07' },
        { name: '电子天平', model: 'ME204', asset_code: 'HX2018-G023', trace_date: '2025-04-01', expire_date: '2026-03-31' },
      ],
    };
    return injectReportFieldsIntoTypst(src, previewTpl, ctx);
  }, [template, mockPreview, mockData, linkedRecord]);

  if (loading) return <Spin style={{ margin: '100px auto', display: 'block' }} />;

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '8px 16px', borderBottom: '1px solid #d9d9d9', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'nowrap', overflowX: 'auto' }}>
        <Button size="small" onClick={() => viewingVersion ? navigate(-1) : confirmLeave(() => navigate('/report-templates?tab=project'), handleSave)}>← 返回</Button>
        <span style={{ fontSize: 13, color: '#888', flexShrink: 0 }}>项目报告模板</span>
        {viewingVersion && (
          <>
            <Tag color="gold">正在查看历史版本 v{viewingVersion.version_no} · 只读</Tag>
            {(viewingVersion.status === 'superseded' || (viewingVersion.status === 'approved' && (versionMeta?.open_draft?.status === 'draft' || versionMeta?.open_draft?.status === 'pending'))) && (
              <Tooltip title={
                versionMeta?.open_draft?.status === 'pending' ? '撤回正在审核的版本，并把内容恢复为此版本（仍是草稿，无需审核）'
                : versionMeta?.open_draft?.status === 'draft' ? '把当前草稿内容重置为此版本（仍是草稿，无需审核）'
                : '以该历史版本内容创建新的待审核版本（回退），审核通过后生效'}>
                <Button size="small" type="primary" ghost icon={<RollbackOutlined />} onClick={rollbackTo}>
                  {viewingVersion.status === 'approved' ? '恢复为此版本' : '恢复此版本'}
                </Button>
              </Tooltip>
            )}
          </>
        )}
        {pendingReview && (
          <>
            <Tag color="gold">v{pendingReview.version_no} 审核中 · 待审核通过 · 只读</Tag>
            {pendingReview.current_version_id != null && (
              <Button size="small" onClick={() => navigate(`/report-templates/project/editor?id=${id}&version_id=${pendingReview.current_version_id}`)}>
                查看当前生效版本 v{pendingReview.current_version_no}
              </Button>
            )}
          </>
        )}
        {!viewingVersion && id && (
          <TemplateVersionPanel
            kind="report"
            templateId={Number(id)}
            templateName={meta?.name}
            currentVersionNo={versionMeta?.current_version_no}
            openDraft={versionMeta?.open_draft}
            onRefresh={reload}
            editorPathBase="/report-templates/project/editor"
            submitGuard={() => conclErrors.length ? `检测结论未填写完整：${conclErrors[0]}` : null}
          />
        )}
        {linkedRecord
          ? <Tag color="blue">关联：{linkedRecord.name} v{linkedRecord.version}</Tag>
          : <Tag color="red">未关联原始记录</Tag>}
        <div style={{ flex: 1 }} />
        <Tooltip title="开启后用关联记录的 mock 数据填充结果表 / 设备表 / 图片表">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
            <EyeOutlined />
            <Switch size="small" checked={mockPreview} onChange={setMockPreview}
              checkedChildren="示例数据" unCheckedChildren="空白" />
          </span>
        </Tooltip>
        {viewingVersion
          ? <Button size="small" onClick={() => navigate(`/report-templates/project/editor?id=${id}`)}>
              {versionMeta?.open_draft?.status === 'pending' ? '返回审核中的版本' : '回到当前版本编辑'}
            </Button>
          : !pendingReview && <Button size="small" type="primary" icon={<SaveOutlined />} onClick={handleSave} loading={saving}>保存</Button>}
      </div>

      {!linkedRecord && (
        <Alert type="warning" banner showIcon
          message="项目报告模板必须关联一个原始记录模板才能配置数据绑定。请先在列表页创建时指定。" />
      )}

      {bindingWarnings.length > 0 && (
        <Alert type="error" banner showIcon
          message={`映射引用失效：${bindingWarnings.length} 处数据绑定指向了关联原始记录模板中不存在的字段（多半是原始记录改名/删了字段编码）。出报告时这些格子会变空。`}
          description={
            <ul style={{ margin: '4px 0 0', paddingLeft: 18, maxHeight: 120, overflow: 'auto' }}>
              {bindingWarnings.map((w, i) => (
                <li key={i}><b>{w.path}</b>：{w.reason}（{w.detail}）</li>
              ))}
            </ul>
          } />
      )}

      {editingConcl && (
        <BindingPickerModal
          open={!!editingConcl}
          value={editingConcl.binding}
          linkedRecord={linkedRecord}
          allowedSources={RECORD_ONLY_SOURCES}
          title="本项目检测结论 · 选择原始记录里的判定/结论来源"
          onChange={(b: CellBinding) => { updateConclusion(editingConcl.id, { binding: b }); }}
          onClose={() => setConclEdit(null)}
        />
      )}

      <EditorSplit
        left={
          <div style={{ height: '100%', display: 'flex', flexDirection: 'column', ...(readonly ? { pointerEvents: 'none', opacity: 0.75 } : {}) }}>
            {/* 模板名称（左侧顶部）——其下方紧跟「本项目检测结论」面板 */}
            <div style={{ flex: '0 0 auto', padding: '8px 12px 6px', fontWeight: 600, fontSize: 15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {meta?.name || '项目模板'}
            </div>
            {/* ─── 6.7 本项目检测结论：放在左侧·模板名称下方（不遮挡右侧 PDF 预览），含填写说明 ─── */}
            <details open={conclOpenEff} style={{ flex: '0 0 auto', borderBottom: '1px solid #eee', background: '#fafcff' }}>
              <summary onClick={(e) => { e.preventDefault(); setConclOpen(!conclOpenEff); }}
                style={{ padding: '6px 12px', cursor: 'pointer', fontWeight: 500, fontSize: 13, userSelect: 'none', display: 'flex', alignItems: 'center', gap: 6, listStyle: 'none' }}>
                <span style={{ fontSize: 11, color: '#999', transition: 'transform .15s', transform: conclOpenEff ? 'rotate(90deg)' : 'none' }}>▸</span>
                本项目检测结论
                <Tooltip title={conclHelp}><QuestionCircleOutlined style={{ color: '#999' }} /></Tooltip>
                {!conclOpenEff && projectName.trim() && <span style={{ fontSize: 12, color: '#888', fontWeight: 400 }}>· {projectName.trim()}</span>}
                {conclErrors.length > 0
                  ? <Tag color="error" style={{ marginLeft: 'auto', marginRight: 0 }}>必填未完成</Tag>
                  : <Tag color="success" style={{ marginLeft: 'auto', marginRight: 0 }}>已填写</Tag>}
              </summary>
              <div style={{ padding: '6px 12px 10px' }}>
                <div style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 12, marginBottom: 3 }}>项目名称 <span style={{ color: '#ff4d4f' }}>*</span>
                    <span style={{ color: '#999', marginLeft: 4 }}>报告章节标题</span></div>
                  <Input size="small" placeholder="如 密度 / 力学性能" value={projectName}
                    status={!projectName.trim() ? 'error' : undefined}
                    onChange={(e) => setLayout({ project_name: e.target.value || undefined })} />
                </div>
                {!linkedRecord && (
                  <Alert type="info" showIcon style={{ marginBottom: 8 }}
                    message="未关联原始记录模板，无法选结论数据来源。请在列表页创建时指定关联记录。" />
                )}
                <div style={{ fontSize: 12, marginBottom: 4 }}>项目结论 <span style={{ color: '#ff4d4f' }}>*</span>
                  <span style={{ color: '#999', marginLeft: 4 }}>显示在检测结论表</span></div>
                {conclusions.length === 0 && (
                  <div style={{ fontSize: 11, color: '#bbb', margin: '2px 0' }}>尚未添加结论</div>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 220, overflow: 'auto' }}>
                  {conclusions.map((c, i) => (
                    <div key={c.id} style={{ border: '1px solid #eee', borderRadius: 6, padding: 6, background: '#fff' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 11, color: '#999' }}>{i + 1}</span>
                        <Input size="small" style={{ flex: 1 }}
                          placeholder={conclusions.length > 1 ? '子项目名称（必填）' : '子项目名称（可空＝用项目名）'}
                          status={conclusions.length > 1 && !(c.sub_name || '').trim() ? 'error' : undefined}
                          value={c.sub_name ?? ''} onChange={(e) => updateConclusion(c.id, { sub_name: e.target.value || undefined })} />
                        <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => removeConclusion(c.id)} />
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                        <span style={{ fontSize: 11, color: '#888', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          来源：<BindingSummary value={c.binding} linkedRecord={linkedRecord} />
                        </span>
                        <Button size="small" onClick={() => setConclEdit(c.id)} disabled={!linkedRecord}>选择数据来源</Button>
                      </div>
                    </div>
                  ))}
                </div>
                <Button size="small" type="dashed" icon={<PlusOutlined />} style={{ marginTop: 8 }}
                  onClick={addConclusion}>添加结论 / 子项目</Button>
                {conclErrors.length > 0 && (
                  <div style={{ marginTop: 6, fontSize: 11, color: '#ff4d4f', lineHeight: 1.6 }}>
                    {conclErrors.map((e, i) => <div key={i}>• {e}</div>)}
                  </div>
                )}
              </div>
            </details>
            <div style={{ flex: '1 1 auto', minHeight: 0 }}>
              <FieldEditor template={template} onChange={setTemplate}
                editorMode="report-project" linkedRecord={linkedRecord}
                onFieldFocus={(code, groupId) => viewerRef.current?.scrollToMarker(code, groupId)}
                selectRequest={selectRequest} />
            </div>
          </div>
        }
        right={
          <TypstViewer ref={viewerRef} source={typstPreview} mode="view" height="calc(100vh - 50px)"
            enableSync downloadName={`${meta?.name || '项目模板'}.pdf`}
            onMarkerClick={(m: PosMarker) => setSelectRequest({ kind: m.kind, code: m.code, token: Date.now() })} />
        }
      />
    </div>
  );
}
