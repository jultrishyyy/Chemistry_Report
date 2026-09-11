/**
 * ProjectEditor — 项目报告模板编辑器（v3）
 * 复用 FieldEditor，editorMode='report-project'；公共外壳走 useReportTemplateEditor。
 */
import { useState, useMemo, useEffect, useRef } from 'react';
import { Button, Spin, Tag, Alert, Segmented, Tooltip, Modal, message, Dropdown } from 'antd';
import { EyeOutlined, QuestionCircleOutlined, RollbackOutlined, ImportOutlined, MoreOutlined, ClearOutlined } from '@ant-design/icons';
import FieldEditor from '../../components/FieldEditor';
import EditorSplit from '../../components/EditorSplit';
import TemplateVersionPanel from '../../components/TemplateVersionPanel';
import EditorToolbar from '../../components/EditorToolbar';
import DocumentCollaborationStatus from '../../components/DocumentCollaborationStatus';
import EditAttemptGuard from '../../components/EditAttemptGuard';
import EditorHistoryControls from '../../components/EditorHistoryControls';
import ReportTemplateGroupActions from '../../components/ReportTemplateGroupActions';
import TypstViewer, { markerHighlightForField, type PosMarker } from '../../components/TypstViewer';
import BindingPickerModal, { BindingSummary } from '../../components/ReportEditor/BindingPickerModal';
import { generateTypst, injectReportFieldsIntoTypst, type ReportRenderCtx } from '../../../../shared/typst-generator';
import { extractRecordConclusion } from '../../../../shared/record-conclusion';
import { generateMockData } from '../../../../shared/mock-data';
import { validateReportBindings, validateProjectConclusions } from '../../../../shared/binding-integrity';
import { buildProjectGroupsFromRecord, DEFAULT_PROJECT_THEME_CONFIG, detectProjectConclusionBinding } from '../../../../shared/report-inherit';
import { fetchRecordTemplateForLink } from '../../utils/recordTemplateLink';
import type { RecordTemplate, ProjectConclusionDecl, CellBinding } from '../../../../shared/types';
import { PREVIEW_HF_VALUES, STANDARD_HF_LAYOUT } from './preview-hf';
import { useReportTemplateEditor } from './useReportTemplateEditor';

// 项目模板的检测结论只能取自【原始记录】（字段 / 矩阵格 / 汇总 / 表头单位 + 自定义），
// 不暴露委托单/样品/测试/报告接口/系统等首页级来源——避免冗余、且结论本就是原始记录的判定值。
const RECORD_ONLY_SOURCES = ['literal', 'record_field', 'record_cell', 'record_summary', 'record_header'];

const EMPTY: RecordTemplate = {
  name: '项目模板',
  version: 1,
  groups: [{ id: 'g_proj', label: '项目内容', layout: 'vertical', fields: [] }],
  // 项目模板默认文档样式＝弯曲强度&弯曲模量模板（字体/字号/字段间距/分区加粗/页边距）
  layout_options: { theme_config: { ...DEFAULT_PROJECT_THEME_CONFIG } },
};

export default function ProjectEditor() {
  const [linkedRecord, setLinkedRecord] = useState<RecordTemplate | null>(null);
  const linkedRecordRequestRef = useRef(0);
  const autoInheritRef = useRef<string | null>(null);
  const autoConclusionRef = useRef<string | null>(null);

  // 公共外壳：加载完成后按 linked_record_template_id 拉关联原始记录
  const ed = useReportTemplateEditor({
    emptyTemplate: EMPTY,
    onLoaded: (data) => {
      const requestNo = ++linkedRecordRequestRef.current;
      const expectedRecordId = Number(data?.linked_record_template_id);
      setLinkedRecord(null);
      if (expectedRecordId) {
        // 有效字段结构：优先生效版本，无生效版本(存量未审核)回退最新草稿——否则拉取/预览拿到空字段
        fetchRecordTemplateForLink(expectedRecordId)
          .then(record => {
            if (linkedRecordRequestRef.current === requestNo && Number(record.id) === expectedRecordId) setLinkedRecord(record);
          })
          .catch(() => {});
      }
    },
  });
  const {
    id, navigate, readonly, permissionPreview, pendingReview, lease, reload, rollbackTo, template, setTemplate, meta, viewingVersion, versionMeta,
    loading, saving, mockPreview, setMockPreview, viewerRef, selectRequest, setSelectRequest,
    handleSave, confirmLeave, undo, redo, reset, canUndo, canRedo, canReset, collaborationChanges,
  } = ed;

  // 新模型从“结论模块中的独立字段”读取；旧 record_conclusion 复合字段仍兼容。
  const hasStructuredRecordConclusion = !!linkedRecord?.groups?.some(group =>
    (group.section_role === 'conclusion' && group.fields?.some(field => field.conclusion_role === 'project_name'))
    || group.fields?.some(field => field.type === 'record_conclusion' && field.record_conclusion));
  // ─── 6.7 存量项目检测结论声明 ────────────
  const lo = template.layout_options || {};
  // 保留 conclusions[] 外层结构兼容存量数据，但编辑、校验和生成均只使用第一条。
  const storedConclusions: ProjectConclusionDecl[] = Array.isArray(lo.conclusions) ? lo.conclusions : [];
  const conclusion: ProjectConclusionDecl | null = storedConclusions[0]
    ? { ...storedConclusions[0], sub_name: undefined }
    : null;
  const conclusions: ProjectConclusionDecl[] = conclusion ? [conclusion] : [];
  const [conclEdit, setConclEdit] = useState(false);
  const [conclOpen, setConclOpen] = useState<boolean | null>(null);   // 结论面板展开态：null=自动(未填则展开/填好则收起)，否则用户手动开合
  const [bindingWarningsOpen, setBindingWarningsOpen] = useState(false);
  const setLayout = (patch: Record<string, any>) => {
    if (readonly) return;
    setTemplate({ ...template, layout_options: { ...(template.layout_options || {}), ...patch } });
  };
  const setConclusion = (next: ProjectConclusionDecl | null) => setLayout({ conclusions: next ? [{ ...next, sub_name: undefined }] : [] });
  const setConclusionBinding = (binding: CellBinding) => setConclusion({
    id: conclusion?.id || `concl_${Date.now()}_${Math.floor(Math.random() * 1e4)}`,
    binding,
  });
  // 必填校验：只要求一个结论数据来源。
  const conclErrors = hasStructuredRecordConclusion ? [] : validateProjectConclusions(conclusions);
  const suggestedConclusion = useMemo(() => hasStructuredRecordConclusion ? null : detectProjectConclusionBinding(linkedRecord), [hasStructuredRecordConclusion, linkedRecord]);
  const applySuggestedConclusions = () => {
    if (!suggestedConclusion) {
      message.warning('未找到可安全自动绑定的结论字段，请手动选择数据来源');
      return;
    }
    const apply = () => {
      setConclusion(suggestedConclusion);
      message.success('已绑定置信度最高的结论字段，请确认后保存');
    };
    if (!conclusion) apply();
    else Modal.confirm({
      title: '重新自动识别结论？',
      content: '现有结论绑定将替换为系统识别出的最高置信度字段，替换后仍可手动调整。',
      okText: '替换', cancelText: '取消', onOk: apply,
    });
  };
  // 默认收起一小条（不挡字段编辑视野）；未填时自动展开提醒、填好后自动收起；用户可手动开合
  const conclOpenEff = conclOpen === null ? conclErrors.length > 0 : conclOpen;
  const conclHelp = (
    <div style={{ maxWidth: 320, fontSize: 12, lineHeight: 1.7 }}>
      <div><b>项目名称</b>：生成报告时自动使用委托单当前分单的项目名称，模板中无需填写。</div>
      <div style={{ marginTop: 4 }}><b>数据来源</b>：绑定关联原始记录里的项目判定值（符合/不符合等）。系统会先识别最可信字段，用户可以调整。</div>
    </div>
  );

  // 实时映射完整性校验：报告绑定 + 检测结论声明 vs 关联原始记录当前版本字段集
  const bindingWarnings = useMemo(
    () => (linkedRecord ? validateReportBindings(template.groups, linkedRecord.groups, hasStructuredRecordConclusion ? [] : conclusions) : []),
    [template, linkedRecord, conclusions, hasStructuredRecordConclusion]
  );

  const mockData = useMemo(() => linkedRecord ? generateMockData(linkedRecord) : {}, [linkedRecord]);

  // 已有关联记录但尚未配置结论时，自动填入置信度最高的一项；这只是默认值，用户仍可手动改绑。
  useEffect(() => {
    if (!linkedRecord || hasStructuredRecordConclusion || conclusion || readonly || viewingVersion || pendingReview || template.layout_options?.pending_record_inherit) return;
    const token = `${id || 'new'}:${linkedRecord.id || linkedRecord.name}:${linkedRecord.version}`;
    if (autoConclusionRef.current === token) return;
    autoConclusionRef.current = token;
    const detected = detectProjectConclusionBinding(linkedRecord);
    if (!detected) return;
    setTemplate({
      ...template,
      layout_options: { ...(template.layout_options || {}), conclusions: [detected] },
    });
    message.info('已默认绑定置信度最高的结论字段，可在检测结论区域调整');
  }, [conclusion, hasStructuredRecordConclusion, id, linkedRecord, pendingReview, readonly, setTemplate, template, viewingVersion]);

  // 兼容旧数据：修复前可能留下“已关联但字段为空”的项目模板；只读进入也立即生成本地预览，
  // 取得编辑权后即可把修复结果保存到草稿。新创建的模板已由服务端在事务内直接生成，通常不会进入这里。
  useEffect(() => {
    const pendingInherit = template.layout_options?.pending_record_inherit;
    const templateIsEmpty = (template.groups || []).every(group => !(group.fields || []).length);
    if ((!pendingInherit && !templateIsEmpty) || !linkedRecord || viewingVersion || pendingReview) return;
    const pendingSource = pendingInherit;
    const expectedRecordId = typeof pendingSource === 'object' ? Number(pendingSource.record_template_id) : Number(meta?.linked_record_template_id);
    const token = `${id || 'new'}:${linkedRecord.id || linkedRecord.name}:${linkedRecord.version}`;
    if (autoInheritRef.current === token) return;
    autoInheritRef.current = token;
    if (expectedRecordId && Number(linkedRecord.id) !== expectedRecordId) {
      message.error('自动拉取已停止：当前加载的原始记录与创建时选择的关联记录不一致，请刷新后重试');
      return;
    }
    if (!(linkedRecord.groups || []).some(group => (group.fields || []).length)) {
      message.warning(`关联的原始记录「${linkedRecord.name}」当前没有可拉取的字段，请先完善并保存原始记录模板`);
      return;
    }
    const res = buildProjectGroupsFromRecord(linkedRecord);
    const generatedWarnings = validateReportBindings(res.groups, linkedRecord.groups, []);
    if (generatedWarnings.length) {
      message.error(`自动拉取已停止：生成结果出现 ${generatedWarnings.length} 处无效映射，原模板内容未被覆盖`);
      return;
    }
    const nextLayout: Record<string, any> = {
      ...(template.layout_options || {}),
      theme_config: { ...(template.layout_options?.theme_config || {}), ...res.theme_config },
      inherited_record_template_id: linkedRecord.id,
      inherited_record_version: linkedRecord.version,
    };
    if (!conclusions.length) {
      const detected = detectProjectConclusionBinding(linkedRecord);
      if (detected) nextLayout.conclusions = [detected];
    }
    delete nextLayout.pending_record_inherit;
    // 保留服务端空模板作为快照基线：进入编辑态后该初始化结果属于待保存改动。
    // 只读态同样 setTemplate 以便立即展示，但 readonly 会阻止其被误判为可保存修改。
    setTemplate({ ...template, groups: res.groups, layout_options: nextLayout });
    if (!readonly) {
      if (res.manual.length) {
        message.info(`已从「${linkedRecord.name}」自动配置 ${res.mapped.length} 个映射，另有 ${res.manual.length} 个字段需手动处理`, 5);
      } else {
        message.success(`已从「${linkedRecord.name}」自动拉取并配置 ${res.mapped.length} 个映射`);
      }
    }
  }, [id, linkedRecord, meta?.linked_record_template_id, pendingReview, readonly, setTemplate, template, viewingVersion]);

  // ─── 从原始记录拉取字段并自动配置映射（§10.5 任务二）：整体替换当前项目模板内容 ───
  const handlePullFromRecord = () => {
    if (!linkedRecord) return;
    const res = buildProjectGroupsFromRecord(linkedRecord);
    const generatedWarnings = validateReportBindings(res.groups, linkedRecord.groups, []);
    if (generatedWarnings.length) {
      Modal.error({
        title: '无法从当前关联记录生成模板',
        content: `生成结果包含 ${generatedWarnings.length} 处无效映射。系统已停止操作，当前模板内容没有被覆盖。`,
      });
      return;
    }
    Modal.confirm({
      title: '从原始记录拉取字段并自动配置映射',
      width: 540,
      okText: '整体替换',
      cancelText: '取消',
      content: (
        <div style={{ fontSize: 13, lineHeight: 1.8 }}>
          <p>用关联原始记录 <b>{linkedRecord.name}</b> 的字段结构<b>整体替换</b>当前项目模板内容，并自动配好映射——
            普通字段＝恒等取值、<b>原始记录表格＝逐格绑定 + 试样随录入数量自动展开</b>。之后可在此基础上继续编辑。</p>
          <p style={{ color: '#555' }}>· 可自动映射 <b>{res.mapped.length}</b> 个字段
            {res.manual.length ? <>；另有 <b>{res.manual.length}</b> 个字段（图片/设备/矩阵表等）需手动处理。</> : '。'}</p>
          <p style={{ color: '#fa8c16', marginBottom: 0 }}>⚠ 当前模板已有内容将被覆盖；这是一次性快照——之后原始记录再改字段不会自动同步（靠映射失效告警提示手改）。</p>
        </div>
      ),
      onOk: () => {
        // 整体替换字段 + 套用文档样式（保留 conclusions/header_footer 等其它 layout_options）
        const nextLayout: Record<string, any> = {
          ...(template.layout_options || {}),
          theme_config: { ...(template.layout_options?.theme_config || {}), ...res.theme_config },
          inherited_record_template_id: linkedRecord.id,
          inherited_record_version: linkedRecord.version,
        };
        if (!conclusions.length) {
          const detected = detectProjectConclusionBinding(linkedRecord);
          if (detected) nextLayout.conclusions = [detected];
        }
        delete nextLayout.pending_record_inherit;
        setTemplate({
          ...template,
          groups: res.groups,
          layout_options: nextLayout,
        });
        if (res.manual.length) {
          Modal.info({
            title: `已拉取：自动映射 ${res.mapped.length} 个字段`,
            width: 540,
            content: (
              <div style={{ fontSize: 13, lineHeight: 1.7 }}>
                <p>以下 <b>{res.manual.length}</b> 个字段未自动映射，请在编辑器里手动处理：</p>
                <ul style={{ paddingLeft: 18, maxHeight: 220, overflow: 'auto' }}>
                  {res.manual.map((m, i) => <li key={i}><b>{m.label || '未命名数据项'}</b>：{m.reason}</li>)}
                </ul>
              </div>
            ),
          });
        } else {
          message.success(`已拉取并自动映射 ${res.mapped.length} 个字段`);
        }
      },
    });
  };

  const resetToBlank = () => {
    Modal.confirm({
      title: '重置为空白项目模板？',
      content: '将清空当前字段和检测结论，但保留模板名称及关联的原始记录。保存前仍可通过离开页面放弃本次修改。',
      okText: '重置为空白',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: () => {
        setTemplate({
          ...template,
          groups: EMPTY.groups.map(group => ({ ...group, fields: [] })),
          layout_options: { theme_config: { ...DEFAULT_PROJECT_THEME_CONFIG } },
        });
        message.success('已重置为空白项目模板，保存后生效');
      },
    });
  };

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
    const mockConclusion = linkedRecord ? extractRecordConclusion(linkedRecord, mockData) : null;
    const ctx: ReportRenderCtx = {
      order: { order_no: 'C202512086592', customer_name: '奇瑞汽车', sample_name: '车门内饰板' },
      order_meta: {
        company_address: '安徽省芜湖市经济技术开发区', send_date: '2025-05-12T09:30:00',
        time_required: '2025-12-31T23:59:59', test_time_required: '2025-12-29T23:59:59',
        authorites: '奇瑞汽车股份有限公司', sale_name: '王树雪', job_no: 'GDJL02859',
        buyer: '采购部门', status: '正常', is_chinese_report: true, is_english_report: false,
        is_paper_report: true, report_count: '按委托单出报告', complete_way: '报告签发，自动完工',
      },
      sample_info: { sample_name: '车门内饰板', barcode: 'BC20250001', sort_no: '1#', model: 'PP-T20' },
      test_info: {
        project_name: '拉伸性能', standard: 'GB/T 1040.1-2025', main_engine_factory: '奇瑞汽车',
        test_method: '按标准规定执行', test_condition: '23 ℃，50% RH', sampling_mode: '注塑成型',
        sampling_requirement: '取 5 个平行试样', leader: '张三', start_date: '2025-12-11', end_date: '2025-12-12',
        sample_description: '黑色塑料件', test_remark: '无异常', material_uploader: '李四',
      },
      report_meta: {
        report_no: 'WT示例-01', verify_code: 'GDJL-示例', issue_date: '2026-06-08',
        company_name: '广电计量检测（集团）化学检测中心', customer_name: '奇瑞汽车股份有限公司',
        report_note: '本报告仅对来样负责。', qualification_note: 'CMA  CNAS',
      },
      record_meta: {
        tester_name: '张三', tested_at: '2026-06-08T09:35:00',
        reviewer_name: '李四', reviewed_at: '2026-06-08T16:20:00',
      },
      record_flat_data: mockData,
      record_raw_data: mockData,
      record_conclusion: mockConclusion ? {
        mode: mockConclusion.mode,
        project_name: mockConclusion.project_name,
        judgment_requirement: mockConclusion.judgment_requirement,
        conclusion: mockConclusion.conclusion,
        items: mockConclusion.items.map(item => ({
          name: item.name,
          judgment_requirement: item.judgment_requirement,
          conclusion: item.conclusion,
        })),
      } : undefined,
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
    <div {...ed.historyEvents} style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <EditorToolbar title={meta?.name || '项目报告模板'}
        onBack={() => viewingVersion ? navigate(-1) : confirmLeave(() => navigate('/report-templates?tab=project'), handleSave)}>
        {permissionPreview && !viewingVersion && <Tag icon={<EyeOutlined />}>只读预览</Tag>}
        {viewingVersion && (
          <>
            <Tag color="gold">正在查看历史版本 v{viewingVersion.version_no} · 只读</Tag>
            {!permissionPreview && (viewingVersion.status === 'superseded' || (viewingVersion.status === 'approved' && (versionMeta?.open_draft?.status === 'draft' || versionMeta?.open_draft?.status === 'pending'))) && (
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
        {linkedRecord
          ? <Tag color="blue">关联：{linkedRecord.name} v{linkedRecord.version}</Tag>
          : meta?.linked_record_template_id
            ? <Tag>正在加载关联记录</Tag>
            : <Tag color="red">未关联原始记录</Tag>}
        {meta?.report_project_family_id && <Tag color="cyan">报告项目组：{meta.report_project_family_name}</Tag>}
        {meta?.host_manufacturer_name
          ? <Tag color="purple">主机厂：{meta.host_manufacturer_name}</Tag>
          : null}
        {!readonly && (
          <EditorHistoryControls disabled={saving} canUndo={canUndo} canRedo={canRedo} canReset={canReset}
            onUndo={undo} onRedo={redo} onReset={reset} />
        )}
        {!viewingVersion && !pendingReview && id && (
          <ReportTemplateGroupActions templateId={Number(id)} templateKind="project"
            groupId={meta?.report_project_family_id} disabled={readonly} onChanged={reload} />
        )}
        <Tooltip title="开启后用关联记录的 mock 数据填充结果表 / 设备表 / 图片表">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
            <EyeOutlined />
            <Segmented size="small" value={mockPreview ? 'mock' : 'blank'}
              onChange={(value) => setMockPreview(value === 'mock')}
              options={[{ label: '示例数据', value: 'mock' }, { label: '空白', value: 'blank' }]} />
          </span>
        </Tooltip>
        <div style={{ flex: 1 }} />
        <DocumentCollaborationStatus resourceType="report_template" resourceId={id}
          canEdit={!permissionPreview && !viewingVersion && !pendingReview} lease={lease}
          onSaveBeforeRelease={() => handleSave()} changes={collaborationChanges} saving={saving} />
        {!viewingVersion && id && !permissionPreview && (
          <TemplateVersionPanel
            kind="report"
            templateId={Number(id)}
            templateName={meta?.name}
            currentVersionNo={versionMeta?.current_version_no}
            openDraft={versionMeta?.open_draft}
            onRefresh={reload}
            editorPathBase="/report-templates/project/editor"
            iconOnly
            familySyncShortcut={!!meta?.report_project_family_id}
            disabled={!pendingReview && (lease.loading || !!lease.holderName || lease.acquired)}
            disabledReason="当前模板正在编辑，请先结束编辑，再执行提交审核或派生操作"
            submitGuard={() => conclErrors.length ? `检测结论未填写完整：${conclErrors[0]}` : null}
          />
        )}
        {viewingVersion
          ? <Button size="small" onClick={() => navigate(`/report-templates/project/editor?id=${id}`)}>
              {versionMeta?.open_draft?.status === 'pending' ? '返回审核中的版本' : '回到当前版本编辑'}
            </Button>
          : null}
        {!viewingVersion && !pendingReview && !readonly && (
          <Dropdown
            trigger={['click']}
            menu={{
              items: [
                ...(linkedRecord ? [
                  { key: 'pull', icon: <ImportOutlined />, label: '重新从原始记录生成' },
                  { type: 'divider' as const },
                ] : []),
                { key: 'blank', icon: <ClearOutlined />, label: '重置为空白模板', danger: true },
              ],
              onClick: ({ key }) => key === 'pull' ? handlePullFromRecord() : key === 'blank' ? resetToBlank() : undefined,
            }}
          >
            <Button size="small" icon={<MoreOutlined />}>模板操作</Button>
          </Dropdown>
        )}
      </EditorToolbar>

      {!meta?.linked_record_template_id && (
        <Alert type="warning" banner showIcon
          message="项目报告模板必须关联一个原始记录模板才能配置数据绑定。请先在列表页创建时指定。" />
      )}

      {/* 空模板 + 有关联记录：醒目提示可一键拉取（不必去找顶栏按钮） */}
      {linkedRecord && !readonly && !viewingVersion && !pendingReview
        && !template.layout_options?.pending_record_inherit
        && (template.groups || []).every(g => !(g.fields || []).length) && (
        <Alert type="info" banner showIcon
          message="本项目模板还是空的——可直接从关联原始记录拉取字段并自动配好映射，在其基础上编辑（无需从零开始）。"
          action={<Button size="small" type="primary" icon={<ImportOutlined />} onClick={handlePullFromRecord}>从原始记录拉取</Button>} />
      )}

      {bindingWarnings.length > 0 && !template.layout_options?.pending_record_inherit && (
        <Alert type="warning" showIcon
          style={{ margin: '8px 12px 0', borderRadius: 6, paddingBlock: 6 }}
          message={<span>
            发现 {bindingWarnings.length} 处映射需要处理，相关位置生成报告时可能为空。
            <Button type="link" size="small" style={{ paddingInline: 6 }} onClick={() => setBindingWarningsOpen(open => !open)}>
              {bindingWarningsOpen ? '收起详情' : '查看详情'}
            </Button>
          </span>}
          description={bindingWarningsOpen ?
            <ul style={{ margin: '4px 0 0', paddingLeft: 18, maxHeight: 120, overflow: 'auto' }}>
              {bindingWarnings.map((w, i) => (
                <li key={i}><b>{w.path}</b>：{w.reason}（{w.detail}）</li>
              ))}
            </ul>
          : undefined} />
      )}

      {conclEdit && (
        <BindingPickerModal
          open={conclEdit}
          value={conclusion?.binding || { source: 'literal', text: '' }}
          linkedRecord={linkedRecord}
          allowedSources={RECORD_ONLY_SOURCES}
          title="本项目检测结论 · 选择原始记录里的判定/结论来源"
          onChange={setConclusionBinding}
          onClose={() => setConclEdit(false)}
        />
      )}

      <EditorSplit
        left={
          <EditAttemptGuard active={!!id && !permissionPreview && !viewingVersion && !pendingReview && !lease.loading && !lease.acquired && !lease.holderName}
            style={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', ...(readonly ? { opacity: 0.75 } : {}) }}>
            {/* 模板名称（左侧顶部）——其下方紧跟「本项目检测结论」面板 */}
            <div style={{ flex: '0 0 auto', padding: '8px 12px 6px', fontWeight: 600, fontSize: 15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {meta?.name || '项目模板'}
            </div>
            {/* ─── 6.7 本项目检测结论：放在左侧·模板名称下方（不遮挡右侧 PDF 预览），含填写说明 ─── */}
            {hasStructuredRecordConclusion ? (
              <Alert type="success" showIcon style={{ margin: '0 12px 8px' }}
                message="项目名称和检测结论由原始记录统一提供"
                description="该原始记录使用结论模块；名称、判定要求和结论都是可独立配置的普通字段。项目模板只负责版式和结果映射，生成报告时按字段角色读取实际录入值。" />
            ) : <details open={conclOpenEff} style={{ flex: '0 0 auto', borderBottom: '1px solid #eee', background: '#fafcff' }}>
              <summary onClick={(e) => { e.preventDefault(); setConclOpen(!conclOpenEff); }}
                style={{ padding: '6px 12px', cursor: 'pointer', fontWeight: 500, fontSize: 13, userSelect: 'none', display: 'flex', alignItems: 'center', gap: 6, listStyle: 'none' }}>
                <span style={{ fontSize: 11, color: '#999', transition: 'transform .15s', transform: conclOpenEff ? 'rotate(90deg)' : 'none' }}>▸</span>
                本项目检测结论
                <Tooltip title={conclHelp}><QuestionCircleOutlined style={{ color: '#999' }} /></Tooltip>
                {conclErrors.length > 0
                  ? <Tag color="error" style={{ marginLeft: 'auto', marginRight: 0 }}>必填未完成</Tag>
                  : <Tag color="success" style={{ marginLeft: 'auto', marginRight: 0 }}>已填写</Tag>}
              </summary>
              <div style={{ padding: '6px 12px 10px' }}>
                <Alert type="info" showIcon style={{ marginBottom: 8, paddingBlock: 5 }}
                  message="报告项目标题将自动使用委托单中的当前项目名称" />
                {!linkedRecord && (
                  <Alert type="info" showIcon style={{ marginBottom: 8 }}
                    message="未关联原始记录模板，无法选结论数据来源。请在列表页创建时指定关联记录。" />
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <span style={{ fontSize: 12 }}>项目结论 <span style={{ color: '#ff4d4f' }}>*</span>
                    <span style={{ color: '#999', marginLeft: 4 }}>显示在检测结论表</span></span>
                  <Tooltip title={suggestedConclusion
                    ? '已识别到置信度最高的结论字段，可重新应用'
                    : '未识别到明确的结论字段，请手动绑定'}>
                    <Button size="small" type="link" style={{ marginLeft: 'auto', paddingInline: 4 }}
                      disabled={!linkedRecord} onClick={applySuggestedConclusions}>
                      重新自动识别
                    </Button>
                  </Tooltip>
                </div>
                <div style={{ border: `1px solid ${conclErrors.length ? '#ffccc7' : '#e5eaf1'}`, borderRadius: 7, padding: 8, background: '#fff' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 11, color: '#888', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      来源：{conclusion
                        ? <BindingSummary value={conclusion.binding} linkedRecord={linkedRecord} />
                        : <span style={{ color: '#bbb' }}>尚未绑定</span>}
                    </span>
                    <Button size="small" onClick={() => setConclEdit(true)} disabled={!linkedRecord}>
                      {conclusion ? '调整绑定' : '选择数据来源'}
                    </Button>
                  </div>
                </div>
                {conclErrors.length > 0 && (
                  <div style={{ marginTop: 6, fontSize: 11, color: '#ff4d4f', lineHeight: 1.6 }}>
                    {conclErrors.map((e, i) => <div key={i}>• {e}</div>)}
                  </div>
                )}
              </div>
            </details>}
            <div style={{ flex: '1 1 auto', minHeight: 0 }}>
              <FieldEditor template={template} onChange={readonly ? () => {} : setTemplate} readOnly={readonly}
                editorMode="report-project" linkedRecord={linkedRecord}
                onFieldFocus={(code, groupId, field) => viewerRef.current?.scrollToMarker(
                  code,
                  groupId,
                  (code.includes('::__detail__:') || code.startsWith('__image_item__:')) ? { label: field?.label ? `当前：${field.label}` : '当前编辑位置', mode: 'text' } : field ? markerHighlightForField(field) : {
                    label: `当前分区：${template.groups.find(group => group.id === groupId)?.label || ''}`,
                    mode: 'group',
                  },
                )}
                onFieldBlur={() => viewerRef.current?.clearMarkerHighlight()}
                selectRequest={selectRequest} />
            </div>
          </EditAttemptGuard>
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
