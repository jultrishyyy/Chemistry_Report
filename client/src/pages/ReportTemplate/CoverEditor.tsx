/**
 * CoverEditor — 首页报告模板编辑器（v3）
 * 复用 FieldEditor，editorMode='report-cover'；公共外壳走 useReportTemplateEditor。
 */
import { useMemo } from 'react';
import { Button, Spin, Segmented, Tooltip, Tag } from 'antd';
import { EyeOutlined, RollbackOutlined } from '@ant-design/icons';
import FieldEditor from '../../components/FieldEditor';
import EditorSplit from '../../components/EditorSplit';
import TemplateVersionPanel from '../../components/TemplateVersionPanel';
import EditorToolbar from '../../components/EditorToolbar';
import DocumentCollaborationStatus from '../../components/DocumentCollaborationStatus';
import EditAttemptGuard from '../../components/EditAttemptGuard';
import EditorHistoryControls from '../../components/EditorHistoryControls';
import ReportTemplateGroupActions from '../../components/ReportTemplateGroupActions';
import TypstViewer, { markerHighlightForField, type PosMarker } from '../../components/TypstViewer';
import { generateTypst, injectReportFieldsIntoTypst, type ReportRenderCtx } from '../../../../shared/typst-generator';
import { withMockPhotoTables, mockPhotoItem } from '../../../../shared/mock-data';
import type { RecordTemplate } from '../../../../shared/types';
import { PREVIEW_HF_VALUES, STANDARD_HF_LAYOUT } from './preview-hf';
import { useReportTemplateEditor } from './useReportTemplateEditor';

const MOCK_CTX: ReportRenderCtx = {
  order: {
    order_no: 'C202512086592',
    customer_name: '奇瑞汽车股份有限公司',
    sample_name: '车门内饰板 / PP+EPDM',
    received_at: '2025-05-12',
  },
  // 订单级接口字段预览值；真实报告从委托单 1.1 的 work_orders.payload.meta 读取。
  order_meta: {
    company_address: '安徽省芜湖市经济技术开发区', send_date: '2025-05-12T09:30:00',
    time_required: '2025-12-31T23:59:59', test_time_required: '2025-12-29T23:59:59', report_deadline: '2026-01-05T23:59:59',
    authorites: '奇瑞汽车股份有限公司', english_authorites: 'Chery Automobile Co., Ltd.',
    authorites_address: '安徽省芜湖市经济技术开发区', english_authorites_address: 'Wuhu, Anhui, China',
    sale_name: '王树雪', job_no: 'GDJL02859', buyer: '采购部门', status: '正常', remark: '优先安排',
    is_chinese_report: true, is_english_report: false, is_paper_report: true,
    report_count: '按委托单出报告', other_report_count: '', complete_way: '报告签发，自动完工',
    test_period: '2025-12-11 ~ 2025-12-29', test_start: '2025-12-11', test_end: '2025-12-29',
  },
  // 样品信息预览值（绑定「样品信息 → 样品名称/样品编号/零件号」时有内容；真实值出报告时按报告样品填）
  report_sample: { name: '车门内饰板 / PP+EPDM', sort_no: '1#', model: 'PP-T20' },
  // 样品清单示例（binding source='order_samples' 预览用；真实值出报告时按订单样品自动填）
  order_samples: [
    { no: '1', name: '中央通道', sort_no: '1#', model: 'PP-T20' },
    { no: '9', name: '中央通道薄膜样板-黑色', sort_no: '9#', model: 'EPDM-50' },
  ],
  // 分组结论表示例（P-Map-7）：2 个样品、含一个项目两个子结论；多样品时按样品分组（rowspan）
  project_summary: [
    { index: 1, sample_no: '1', sample_name: '中央通道', name: '拉伸性能', standard: 'GB/T 1040.1-2025', conclusion: '符合' },
    { index: 2, sample_no: '1', sample_name: '中央通道', name: '冲击性能', standard: 'GB/T 1843', conclusion: '不符合' },
    { index: 3, sample_no: '2', sample_name: '薄膜样板', name: '密度', standard: 'GB/T 1033.1', conclusion: '符合' },
    { index: 4, sample_no: '2', sample_name: '薄膜样板', name: '燃烧性能', sub_name: '燃烧性能子项目1', standard: 'GB 8410', conclusion: '符合' },
    { index: 4, sample_no: '2', sample_name: '薄膜样板', name: '燃烧性能', sub_name: '燃烧性能子项目2', standard: 'GB 8410', conclusion: '不符合' },
  ],
  // 报告接口字段（1.2）示例值——封面正文绑定 report_meta.* 时预览有内容（真实值出报告时由取号推送）。
  report_meta: {
    report_no: 'WT示例-01', cover_report_no: 'WT示例-00', verify_code: 'GDJL-示例', issue_date: '2026-06-08',
    company_name: '广电计量检测（集团）化学检测中心', company_address: '广州市黄埔区开创大道',
    phone: '020-12345678', fax: '020-00000000', website: 'www.grgtest.com',
    customer_name: '奇瑞汽车股份有限公司', customer_address: '安徽省芜湖市经济技术开发区',
    report_note: '本报告检测结果仅对受检样品负责，报告无批准人签字、检验检测专用章及报告骑缝章无效，未经本公司书面同意，不得部分复制本报告。对报告若有异议，应于收到报告之日起十五天内向检测单位提出。扫描报告首页二维码，或登陆官方网站 http://www.grgtmall.com，输入报告编号和校验码，即可查询报告真伪，如有疑问，请联系邮箱 grgtest@grgtest.com.请妥善管理二维码和校验码，由此所致的信息泄露本公司概不负责',
    qualification_note: '',  // 资质备注示例留空 → 预览时不显示
  },
  record_meta: {
    tester_name: '张三', tested_at: '2026-06-08T09:35:00',
    reviewer_name: '李四', reviewed_at: '2026-06-08T16:20:00',
  },
  // 图片预览：给「报告·图片表(report_image_gallery)」自动模式一份示例原始记录（含一个 image 字段）+ 示例照片，
  // 这样首页编辑器预览也能看到样图（report_photo_table 走 withMockPhotoTables 注入，二者预览都有图）。真实报告不经此 mock。
  linked_record_template: {
    id: 'mock-rec', name: '示例原始记录', kind: 'record', version: 1,
    groups: [{ id: 'mg', label: '原始样品照片', hide_title: true, fields: [
      { id: 'mi', code: 'mock_orig_img', label: '原始样品', type: 'image' },
    ] }],
  } as any,
  record_raw_data: { mock_orig_img: [mockPhotoItem()] },
};

// 新建首页模板的初始版式 = 标准首页默认（镜像 scripts/front-template.ts 的 layout_options），
// 让新模板的页眉页脚字号/字距/边距与标准一致，且正文不出自动标题/副标题（标题只在页眉出）。
const EMPTY: RecordTemplate = {
  name: '首页模板',
  version: 1,
  groups: [{ id: 'g_cover', label: '封面', layout: 'vertical', hide_title: true, fields: [] }],
  layout_options: {
    document_title: '检测报告',
    subtitle: '',
    suppress_title: true,
    theme_config: {
      font: 'FangSong', body_size: '10.5pt', margin_v: '2.4cm', margin_h: '2.4cm',
      label_weight: 'bold', line_gap: '0.5em', label_width: '6em', table_stroke: '0.5pt',
    },
    // header_footer 只存"启用"——标准版式由预览 STANDARD_HF_LAYOUT / 真实报告 config/header-footer.json 提供；
    // 模板里只保存用户显式改动的覆盖键（避免把默认值固化进每个模板、与全局默认脱钩）。
    header_footer: { enabled: true },
  },
};

export default function CoverEditor() {
  const ed = useReportTemplateEditor({ emptyTemplate: EMPTY });
  const {
    id, navigate, readonly, permissionPreview, pendingReview, lease, reload, rollbackTo, template, setTemplate, meta, viewingVersion, versionMeta,
    loading, saving, mockPreview, setMockPreview, viewerRef, selectRequest, setSelectRequest,
    handleSave, confirmLeave, undo, redo, reset, canUndo, canRedo, canReset, collaborationChanges,
  } = ed;

  const typstPreview = useMemo(() => {
    // 页眉页脚由系统统一写死（标准版式 STANDARD_HF_LAYOUT，镜像 config/header-footer.json），
    // 不再由用户在编辑器里调整；预览始终呈现标准页眉页脚 + 示例数据值，与真实报告一致。
    const hf = { ...STANDARD_HF_LAYOUT, ...PREVIEW_HF_VALUES, enabled: true };
    const previewTpl: RecordTemplate = {
      ...template,
      layout_options: { ...(template.layout_options || {}), header_footer: hf },
    };
    const src = generateTypst(previewTpl);
    if (!mockPreview) return src;
    // 示例数据：给原样照片表填一张样图，让预览看到带照片的图片表（真实报告由文员上传）
    return injectReportFieldsIntoTypst(src, withMockPhotoTables(previewTpl), MOCK_CTX);
  }, [template, mockPreview]);

  if (loading) return <Spin style={{ margin: '100px auto', display: 'block' }} />;

  return (
    <div {...ed.historyEvents} style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <EditorToolbar title={meta?.name || '首页模板'}
        onBack={() => viewingVersion ? navigate(-1) : confirmLeave(() => navigate('/report-templates?tab=cover'), handleSave)}>
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
              <Button size="small" onClick={() => navigate(`/report-templates/cover/editor?id=${id}&version_id=${pendingReview.current_version_id}`)}>
                查看当前生效版本 v{pendingReview.current_version_no}
              </Button>
            )}
          </>
        )}
        {!readonly && (
          <EditorHistoryControls disabled={saving} canUndo={canUndo} canRedo={canRedo} canReset={canReset}
            onUndo={undo} onRedo={redo} onReset={reset} />
        )}
        {!viewingVersion && !pendingReview && id && (
          <ReportTemplateGroupActions templateId={Number(id)} templateKind="cover"
            groupId={meta?.report_project_family_id} disabled={readonly} onChanged={reload} />
        )}
        <Tooltip title="开启后右侧 PDF 预览自动填充 mock 委托单数据">
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
            editorPathBase="/report-templates/cover/editor"
            iconOnly
            familySyncShortcut={!!meta?.report_project_family_id}
            disabled={!pendingReview && (lease.loading || !!lease.holderName || lease.acquired)}
            disabledReason="当前模板正在编辑，请先结束编辑，再执行提交审核或派生操作"
          />
        )}
        {viewingVersion
          ? <Button size="small" onClick={() => navigate(`/report-templates/cover/editor?id=${id}`)}>
              {versionMeta?.open_draft?.status === 'pending' ? '返回审核中的版本' : '回到当前版本编辑'}
            </Button>
          : null}
      </EditorToolbar>

      <EditorSplit
        left={
          <EditAttemptGuard active={!!id && !permissionPreview && !viewingVersion && !pendingReview && !lease.loading && !lease.acquired && !lease.holderName}
            style={readonly ? { opacity: 0.75, height: '100%', minHeight: 0 } : { height: '100%', minHeight: 0 }}>
            <FieldEditor template={template} onChange={readonly ? () => {} : setTemplate} editorMode="report-cover" readOnly={readonly}
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
          </EditAttemptGuard>
        }
        right={
          <TypstViewer ref={viewerRef} source={typstPreview} mode="view" height="calc(100vh - 50px)"
            enableSync downloadName={`${meta?.name || '首页模板'}.pdf`}
            onMarkerClick={(m: PosMarker) => setSelectRequest({ kind: m.kind, code: m.code, token: Date.now() })} />
        }
      />
    </div>
  );
}
