import { useState, useEffect, useMemo, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Button, message, Spin, Tooltip, Modal, Input, Segmented, Tag } from 'antd';
import { SaveOutlined, EyeOutlined, SafetyCertificateOutlined, ClearOutlined, ExperimentOutlined, RollbackOutlined } from '@ant-design/icons';
import FieldEditor from '../../components/FieldEditor';
import FormRenderer from '../../components/FormRenderer';
import EditorSplit from '../../components/EditorSplit';
import TypstViewer, { type TypstViewerHandle, type PosMarker } from '../../components/TypstViewer';
import TemplateVersionPanel from '../../components/TemplateVersionPanel';
import { generateTypst, generateTypstWithData } from '../../../../shared/typst-generator';
import { useDeviceMap } from '../../utils/deviceMap';
import { dedupeTemplateIdentity, buildFieldDefaults } from '../../../../shared/matrix-flatten';
import { generateMockData } from '../../../../shared/mock-data';
import { BASE_TEMPLATES } from '../../../../shared/base-templates';
import type { RecordTemplate } from '../../../../shared/types';
import { useUnsavedGuard } from '../../hooks/useUnsavedGuard';
import axios from 'axios';

const API = '/api';

/** 未保存判定用快照：只看会被保存的字段 */
const snapTemplate = (t: RecordTemplate) =>
  JSON.stringify({ name: t.name, groups: t.groups, layout_options: t.layout_options || {} });

const EMPTY_TEMPLATE: RecordTemplate = {
  name: '新模板',
  version: 1,
  groups: [{ id: 'g1', label: '基本信息', layout: 'vertical', fields: [] }],
  layout_options: {},
};

export default function RecordTemplateEditor() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const templateId = searchParams.get('id');
  const fromBase = searchParams.get('from');
  const cloneId = searchParams.get('clone_id');
  /** 只读查看某个历史版本（来自版本历史 Drawer 的「查看此版本」） */
  const viewVersionId = searchParams.get('version_id');

  const [template, setTemplate] = useState<RecordTemplate>(() => {
    if (fromBase) {
      const entry = BASE_TEMPLATES.find(b => b.key === fromBase);
      if (entry) return entry.build();
    }
    return EMPTY_TEMPLATE;
  });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  /** 右侧预览：示例数据 / 空白 */
  const [previewMode, setPreviewMode] = useState<'mock' | 'blank'>('mock');
  /** 试录测试弹窗（FormRenderer 实测录入体验，数据仅本地） */
  const [tryOpen, setTryOpen] = useState(false);
  const [tryData, setTryData] = useState<Record<string, any>>({});
  const [versionMeta, setVersionMeta] = useState<{ current_version_no?: number; open_draft?: any } | null>(null);
  /** 只读历史版本模式的版本信息 */
  const [viewingVersion, setViewingVersion] = useState<{ version_no: number; status: string } | null>(null);
  /**
   * open_draft 是 pending（已提交审核）时：只读展示送审中的版本，并记下当前生效版本，
   * 顶栏给「查看当前生效版本」入口。审核未通过前不可编辑（后端 PUT 也会 409）。
   */
  const [pendingReview, setPendingReview] = useState<{ version_no: number; current_version_id?: number; current_version_no?: number } | null>(null);
  /** 版本流动作（提交/撤回/审核）后重跑加载，使编辑/只读态与最新 open_draft 一致 */
  const [reloadToken, setReloadToken] = useState(0);
  const readonly = !!viewVersionId || !!pendingReview;
  /** 草稿乐观锁：客户端持有的草稿 updated_at，保存时回传给后端校验（防并发互盖） */
  const draftUpdatedAtRef = useRef<string | null>(null);
  // 编辑器 ⇄ PDF 双向跳转
  const viewerRef = useRef<TypstViewerHandle>(null);
  const [selectRequest, setSelectRequest] = useState<{ kind: 'field' | 'group'; code: string; token: number } | null>(null);
  // 未保存改动守卫：初始快照 = 新建时的初始模板（base 模板/空模板）；加载/克隆/保存后刷新。
  // 只读态（历史版本/送审中）不可能有用户改动，直接豁免——加载期的补名/规范化不再误报。
  const savedSnapRef = useRef('');
  if (savedSnapRef.current === '' && !templateId && !cloneId) savedSnapRef.current = snapTemplate(template);
  const { confirmLeave } = useUnsavedGuard(() => !readonly && snapTemplate(template) !== savedSnapRef.current);
  // 保存/快照始终取「最新」模板状态（ref 每次渲染同步）——避免输入控件 onBlur 提交与点「保存」
  // 竞态时，handleSave 闭包里的旧 template 被保存、快照也停在旧内容，离开时仍误弹"未保存"。
  const templateRef = useRef(template);
  templateRef.current = template;
  // 受控登记（手动应急通道）
  const [ctrlOpen, setCtrlOpen] = useState(false);
  const [ctrl, setCtrl] = useState({ no: '', issue_date: '', effective_date: '' });
  const [ctrlSaving, setCtrlSaving] = useState(false);
  const openCtrl = () => {
    const c = (template.layout_options as any)?.controlled || {};
    setCtrl({ no: c.no || '', issue_date: c.issue_date || '', effective_date: c.effective_date || '' });
    setCtrlOpen(true);
  };
  const saveCtrl = async () => {
    if (!template.id) return;
    setCtrlSaving(true);
    try {
      await axios.post(`${API}/record-templates/${template.id}/controlled`, {
        controlled_no: ctrl.no, controlled_issue_date: ctrl.issue_date, controlled_effective_date: ctrl.effective_date,
      });
      // 乐观更新 layout_options.controlled → 顶部受控行预览立刻反映
      setTemplate(prev => ({ ...prev, layout_options: { ...(prev.layout_options || {}), controlled: { ...ctrl } } }));
      message.success('受控信息已登记（已印到记录顶部）');
      setCtrlOpen(false);
    } catch (e: any) {
      message.error('登记失败：' + (e.response?.data?.error || e.message || ''));
    } finally {
      setCtrlSaving(false);
    }
  };

  const refreshVersionMeta = async (id: number) => {
    try {
      const list = await axios.get(`${API}/record-templates`);
      const row = list.data.find((t: any) => t.id === id);
      if (row) {
        setVersionMeta({ current_version_no: row.current_version_no, open_draft: row.open_draft });
        draftUpdatedAtRef.current = row.open_draft?.updated_at || null;
      }
    } catch { /* ignore */ }
  };

  /**
   * 历史版本只读视图里「恢复此版本」：
   *  - 正在编辑草稿时→把草稿内容重置为该版本（仍是草稿、不送审），落回草稿编辑；
   *  - 否则→克隆该版本为新待审版本，落到 pending 只读视图。
   */
  const rollbackTo = () => {
    if (!templateId || !viewVersionId) return;
    const os = versionMeta?.open_draft?.status;
    const odv = versionMeta?.open_draft?.version_no;
    const toEffective = viewingVersion?.status === 'approved';  // 恢复为当前生效版本＝丢弃草稿
    Modal.confirm({
      title: `恢复到 v${viewingVersion?.version_no}？`,
      content: toEffective
        ? (os === 'pending'
            ? `当前 v${odv} 正在审核中。恢复将先撤回该审核，并丢弃草稿回到生效版本（不会留下草稿，无需提交审核）。`
            : `将丢弃当前草稿 v${odv}，回到生效版本（不会留下草稿，无需提交审核）。`)
        : (os === 'pending'
            ? `当前 v${odv} 正在审核中。恢复将先撤回该审核（变回草稿），并把内容重置为本版本（仍是草稿，无需审核）。`
            : os === 'draft'
            ? `将把当前草稿 v${odv} 的内容重置为该版本内容（仍是草稿，无需审核）。`
            : '将以该版本内容创建一个新的「待审核」版本，经审核通过后生效。当前版本与历史全部保留。'),
      okText: toEffective
        ? (os === 'pending' ? '撤回审核并丢弃草稿' : '丢弃草稿并恢复')
        : (os === 'pending' ? '撤回审核并恢复' : os === 'draft' ? '重置草稿为此版本' : '创建回退版本'),
      cancelText: '取消',
      onOk: async () => {
        try {
          const r = await axios.post(`${API}/record-templates/${templateId}/versions/${viewVersionId}/rollback`);
          message.success(r.data.discarded
            ? '已恢复为当前生效版本，草稿已丢弃'
            : r.data.status === 'draft'
            ? `已恢复为 v${viewingVersion?.version_no} 内容（草稿${os === 'pending' ? '，已撤回原审核' : ''}）`
            : `已创建回退版本 v${r.data.version_no}，待审核`);
          navigate(`/record-templates/editor?id=${templateId}`);  // 落回干净生效态/草稿/新 pending 视图
        } catch (e: any) {
          message.error('回退失败：' + (e.response?.data?.error || e.message));
        }
      },
    });
  };

  useEffect(() => {
    // 只读查看历史版本：直接加载该版本快照，禁用一切编辑/保存
    if (templateId && viewVersionId) {
      setLoading(true);
      setPendingReview(null);
      axios.get(`${API}/record-templates/${templateId}/versions/${viewVersionId}`)
        .then(res => {
          const v = res.data;
          const tmpl: RecordTemplate = {
            id: Number(templateId),
            name: `历史版本 v${v.version_no}`,
            version: v.version_no,
            groups: v.field_definitions,
            layout_options: v.layout_options || {},
          };
          // 取模板名补到标题 + 版本元信息（供「返回」按钮判断是否仍有 pending）
          // 补名会改 template.name ⇒ 同步刷新快照基线，避免"没改任何东西却提示未保存"
          axios.get(`${API}/record-templates/${templateId}`)
            .then(r => {
              setTemplate(prev => {
                const next = { ...prev, name: r.data.name };
                savedSnapRef.current = snapTemplate(next);
                return next;
              });
              setVersionMeta({ current_version_no: r.data.current_version_no, open_draft: r.data.open_draft });
            })
            .catch(() => {});
          setTemplate(tmpl);
          setViewingVersion({ version_no: v.version_no, status: v.status });
          savedSnapRef.current = snapTemplate(tmpl);   // 只读不会有未保存改动
        })
        .catch(() => message.error('加载历史版本失败'))
        .finally(() => setLoading(false));
      return;
    }
    if (templateId) {
      setLoading(true);
      axios.get(`${API}/record-templates/${templateId}`)
        .then(async res => {
          const data = res.data;
          setViewingVersion(null);  // 从历史只读视图导航回 ?id=X 时清掉历史标记，避免顶栏残留
          // 有未定稿（草稿/被退回）时加载草稿内容继续编辑——否则编辑器只显示已生效版本，
          // 再保存会把别人/自己之前的草稿改动悄悄盖掉
          let groups = data.field_definitions;
          let layoutOptions = data.layout_options || {};
          const od = data.open_draft;
          if (od && (od.status === 'draft' || od.status === 'rejected')) {
            try {
              const dv = await axios.get(`${API}/record-templates/${templateId}/versions/${od.id}`);
              groups = dv.data.field_definitions;
              layoutOptions = dv.data.layout_options || layoutOptions;
              message.info(`已加载未生效的${od.status === 'rejected' ? '被退回版本' : '草稿'} v${od.version_no}（${od.author_name}）继续编辑`);
            } catch { /* 草稿拉不到就退回已生效版本 */ }
            setPendingReview(null);
          } else if (od && od.status === 'pending') {
            // 已提交审核：只读展示送审版本内容（顶栏给「查看当前生效版本」入口）
            try {
              const dv = await axios.get(`${API}/record-templates/${templateId}/versions/${od.id}`);
              groups = dv.data.field_definitions;
              layoutOptions = dv.data.layout_options || layoutOptions;
            } catch { /* 拉不到就退回已生效版本 */ }
            setPendingReview({ version_no: od.version_no, current_version_id: data.current_version_id, current_version_no: data.current_version_no });
          } else {
            setPendingReview(null);
          }
          draftUpdatedAtRef.current = od?.updated_at || null;
          // 自愈历史重复 id/code（旧 id 生成器遗留），否则点 A 字段会打开 B 的编辑
          const { template: tmpl, fixes } = dedupeTemplateIdentity({
            id: data.id,
            name: data.name,
            version: data.version,
            groups,
            typst_source: data.typst_source,
            source_file: data.source_file,
            layout_options: layoutOptions,
          });
          setTemplate(tmpl);
          savedSnapRef.current = snapTemplate(tmpl);
          if (fixes) message.info(`已自动修复 ${fixes} 处历史重复字段标识，点「保存为草稿」可永久固化`);
          setVersionMeta({ current_version_no: data.current_version_no, open_draft: data.open_draft });
        })
        .catch(() => message.error('加载模板失败'))
        .finally(() => setLoading(false));
      return;
    }
    // 新建：从已有模板复制作为骨架（不指定 id/version，保存时会创建新行）
    if (cloneId) {
      setLoading(true);
      axios.get(`${API}/record-templates/${cloneId}`)
        .then(res => {
          const data = res.data;
          const { template: tmpl } = dedupeTemplateIdentity({
            // 不带 id：保存会走 POST 创建新模板
            name: `${data.name} - 副本`,
            version: 1,
            groups: data.field_definitions,
            source_file: data.source_file,
            layout_options: data.layout_options || {},
          });
          setTemplate(tmpl);
          savedSnapRef.current = snapTemplate(tmpl);
        })
        .catch(() => message.error('加载源模板失败'))
        .finally(() => setLoading(false));
    }
  }, [templateId, cloneId, viewVersionId, reloadToken]);

  const typstSource = generateTypst(template);
  const typstPreview = useMemo(() => {
    if (previewMode === 'blank') return typstSource;
    const mockData = generateMockData(template);
    return generateTypstWithData(template, mockData);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template, previewMode]);

  // 试录弹窗里的 PDF：按试录数据实时渲染（仅弹窗打开时计算）
  // 「测试设备」字段反查设备名称 → 显示「设备名称：管理编号」（试录选的是真实设备，只存管理编号）。
  const tryDeviceMap = useDeviceMap(template, tryOpen ? tryData : null);
  const tryoutSrc = useMemo(
    () => (tryOpen ? generateTypstWithData(template, tryData, { deviceMap: tryDeviceMap }) : ''),
    [tryOpen, template, tryData, tryDeviceMap]
  );

  const startTryout = () => {
    setTryData(buildFieldDefaults(template));   // 与真实录入同一初始化（应用字段默认值）
    setTryOpen(true);
  };

  const handleSave = async (): Promise<boolean> => {
    setSaving(true);
    try {
      const t = templateRef.current;   // 最新状态（防 onBlur 提交与点保存的竞态）
      const payload = {
        name: t.name,
        field_definitions: t.groups,
        typst_source: generateTypst(t),
        source_file: t.source_file,
        layout_options: t.layout_options || {},
        draft_updated_at: draftUpdatedAtRef.current || undefined,
      };
      if (t.id) {
        const res = await axios.put(`${API}/record-templates/${t.id}`, payload);
        draftUpdatedAtRef.current = res.data?.updated_at || null;
        message.success('已保存为草稿，点「提交审核」让审核员审核后生效');
        refreshVersionMeta(t.id);
      } else {
        const res = await axios.post(`${API}/record-templates`, payload);
        setTemplate({ ...t, id: res.data.id });
        message.success('创建成功（v1 直接生效）');
        navigate(`/record-templates/editor?id=${res.data.id}`, { replace: true });
      }
      savedSnapRef.current = snapTemplate(t);
      return true;
    } catch (e: any) {
      if (e.response?.status === 409) {
        Modal.confirm({
          title: '保存冲突',
          content: e.response?.data?.error || '草稿已被其他人修改或正在审核中。',
          okText: '刷新加载最新内容',
          cancelText: '留在本页（手动备份改动）',
          onOk: () => window.location.reload(),
        });
      } else {
        message.error('保存失败：' + (e.response?.data?.error || e.message));
      }
      return false;
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Spin style={{ margin: '100px auto', display: 'block' }} />;

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '8px 16px', borderBottom: '1px solid #d9d9d9', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'nowrap', overflowX: 'auto' }}>
        <Button size="small" onClick={() => viewingVersion ? navigate(-1) : confirmLeave(() => navigate('/record-templates'), handleSave)}>← 返回</Button>
        <h3 style={{ margin: 0, fontSize: 15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flexShrink: 1, minWidth: 40 }}>{template.name}</h3>
        {viewingVersion && (
          <>
            <Tag color="gold">
              正在查看历史版本 v{viewingVersion.version_no}（{({ draft: '草稿', pending: '待审核', approved: '已生效', rejected: '已退回', superseded: '已替代' } as Record<string, string>)[viewingVersion.status] || viewingVersion.status}）· 只读
            </Tag>
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
              <Button size="small" onClick={() => navigate(`/record-templates/editor?id=${templateId}&version_id=${pendingReview.current_version_id}`)}>
                查看当前生效版本 v{pendingReview.current_version_no}
              </Button>
            )}
          </>
        )}
        {!viewingVersion && template.id && (
          <TemplateVersionPanel
            kind="record"
            templateId={template.id}
            templateName={template.name}
            currentVersionNo={versionMeta?.current_version_no}
            openDraft={versionMeta?.open_draft}
            onRefresh={() => setReloadToken((t) => t + 1)}
          />
        )}
        <div style={{ flex: 1 }} />
        <Tooltip title="示例数据=自动填充 mock 值；空白=空表">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
            <EyeOutlined />
            <Segmented size="small" value={previewMode}
              onChange={(v) => setPreviewMode(v as 'mock' | 'blank')}
              options={[
                { label: '示例数据', value: 'mock' },
                { label: '空白', value: 'blank' },
              ]} />
          </span>
        </Tooltip>
        {!readonly && (
          <>
            <Tooltip title="弹出真实录入界面试填本模板，实测公式/加减行/可选项；数据仅测试用，不会保存">
              <Button size="small" icon={<ExperimentOutlined />} onClick={startTryout}>试录测试</Button>
            </Tooltip>
            <Tooltip title={template.id ? '登记受控号/颁布日期/实施日期，印在原始记录顶部（手动应急通道；接口⑦就绪后由外部回传）' : '保存模板后可登记受控信息'}>
              <Button size="small" icon={<SafetyCertificateOutlined />} onClick={openCtrl} disabled={!template.id}>受控登记</Button>
            </Tooltip>
            <Button size="small" type="primary" icon={<SaveOutlined />} onClick={handleSave} loading={saving}>
              {template.id ? '保存为草稿' : '创建模板'}
            </Button>
          </>
        )}
        {viewingVersion && (
          <Button size="small" onClick={() => navigate(`/record-templates/editor?id=${templateId}`)}>
            {versionMeta?.open_draft?.status === 'pending' ? '返回审核中的版本' : '回到当前版本编辑'}
          </Button>
        )}
      </div>

      <Modal title="受控登记（原始记录顶部受控行）" open={ctrlOpen} onOk={saveCtrl} confirmLoading={ctrlSaving}
        onCancel={() => setCtrlOpen(false)} okText="登记" cancelText="取消">
        <p style={{ color: '#888', fontSize: 12 }}>这三项是「本模板当前生效版本」的受控信息，会印在该模板出的所有原始记录顶部（随版本冻结）。样式对齐参考 .xls。</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Input addonBefore="受控号" placeholder="如 GRGJL.WI-HX-06-471(1.7)" value={ctrl.no}
            onChange={e => setCtrl(c => ({ ...c, no: e.target.value }))} />
          <Input addonBefore="颁布日期" placeholder="如 2025/8/20" value={ctrl.issue_date}
            onChange={e => setCtrl(c => ({ ...c, issue_date: e.target.value }))} />
          <Input addonBefore="实施日期" placeholder="如 2025/8/20" value={ctrl.effective_date}
            onChange={e => setCtrl(c => ({ ...c, effective_date: e.target.value }))} />
        </div>
      </Modal>
      <EditorSplit
        left={
          // 只读历史版本：结构面板禁交互（仅浏览字段构成），右侧 PDF 正常查看
          <div style={readonly ? { pointerEvents: 'none', opacity: 0.75, height: '100%' } : { height: '100%' }}>
            <FieldEditor
              template={template}
              onChange={setTemplate}
              onFieldFocus={(code, groupId) => viewerRef.current?.scrollToMarker(code, groupId)}
              selectRequest={selectRequest}
            />
          </div>
        }
        right={
          <TypstViewer
            ref={viewerRef}
            source={typstPreview}
            mode="view"
            height="calc(100vh - 50px)"
            enableSync
            downloadName={`${template?.name || '原始记录模板'}.pdf`}
            onMarkerClick={(m: PosMarker) => setSelectRequest({ kind: m.kind, code: m.code, token: Date.now() })}
          />
        }
      />

      {/* 试录测试弹窗：左 = 真实录入组件（与录入页同一套 FormRenderer），右 = 按试录数据实时出 PDF */}
      <Modal
        title={
          <span>
            <ExperimentOutlined style={{ color: '#b08400', marginRight: 6 }} />
            试录测试 — 录入员将看到的界面
            <span style={{ fontSize: 12, fontWeight: 'normal', color: '#888', marginLeft: 10 }}>
              可试填测试公式 / 加减行 / 可选项；数据仅测试用，关闭即弃，不会保存
            </span>
          </span>
        }
        open={tryOpen}
        onCancel={() => setTryOpen(false)}
        width="88vw"
        style={{ top: 24 }}
        destroyOnHidden
        footer={
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <Button icon={<ClearOutlined />} onClick={() => setTryData(buildFieldDefaults(template))}>清空重填</Button>
            <Button type="primary" onClick={() => setTryOpen(false)}>关闭</Button>
          </div>
        }
      >
        <div style={{ display: 'flex', gap: 12, height: 'calc(100vh - 220px)' }}>
          <div style={{ flex: '0 0 52%', overflowY: 'auto', paddingRight: 8, borderRight: '1px solid #eef0f4' }}>
            <FormRenderer template={template} data={tryData} onChange={setTryData} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <TypstViewer source={tryoutSrc} mode="view" height="calc(100vh - 220px)"
              downloadName={`${template?.name || '原始记录模板'}-试录.pdf`} />
          </div>
        </div>
      </Modal>
    </div>
  );
}
