/**
 * useReportTemplateEditor — 首页(cover)/项目(project) 报告模板编辑器的共享外壳。
 *
 * 抽出两个报告编辑器页几乎逐字重复的逻辑：加载（只读历史版本 / 草稿续编 / 自愈重复 id）、
 * 保存（PUT + 409 冲突 + 草稿乐观锁 + binding_warnings）、未保存守卫、版本元信息（供顶栏
 * TemplateVersionPanel 提交审核/历史/回退）、编辑器⇄PDF 跳转、示例数据开关。
 *
 * 页面特定的部分（首页的页眉页脚 UI / 项目的关联记录 + binding 校验 / 各自的预览 typst）留在各页。
 */
import { useState, useEffect, useRef, useCallback, type SetStateAction } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { message, Modal } from 'antd';
import axios from 'axios';
import { dedupeTemplateIdentity } from '../../../../shared/matrix-flatten';
import type { RecordTemplate } from '../../../../shared/types';
import { useUnsavedGuard } from '../../hooks/useUnsavedGuard';
import { useAutoSave } from '../../hooks/useAutoSave';
import { useEditorHistory } from '../../hooks/useEditorHistory';
import { migrateGalleryGroups } from '../../components/FieldEditor/migrateImageGallery';
import type { TypstViewerHandle } from '../../components/TypstViewer';
import { useAuth } from '../../auth';
import { useExclusiveEditLease } from '../../hooks/useCollaboration';

const API = '/api';

/** 未保存判定用快照：只看会被保存的字段 */
const snapTemplate = (t: RecordTemplate) =>
  JSON.stringify({ name: t.name, groups: t.groups, layout_options: t.layout_options || {} });

export interface ReportEditorOpts {
  emptyTemplate: RecordTemplate;
  /** 加载完成后的页面特定副作用（如项目加载关联原始记录）。入参＝GET 到的 base data（含 linked_record_template_id 等）。 */
  onLoaded?: (data: any) => void;
}

export function useReportTemplateEditor({ emptyTemplate, onLoaded }: ReportEditorOpts) {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { has } = useAuth();
  const id = searchParams.get('id');
  /** 只读查看某个历史版本 */
  const viewVersionId = searchParams.get('version_id');
  const permissionPreview = searchParams.get('readonly') === '1' || !has('report_template.edit');

  const templateHistory = useEditorHistory<RecordTemplate>(emptyTemplate);
  const { value: template, setValue: setTemplate, replaceBaseline: replaceHistoryBaseline } = templateHistory;
  const [meta, setMeta] = useState<any>(null);
  const [viewingVersion, setViewingVersion] = useState<{ version_no: number; status: string } | null>(null);
  /** 版本流元信息（顶栏 TemplateVersionPanel 用） */
  const [versionMeta, setVersionMeta] = useState<{ current_version_no?: number; open_draft?: any } | null>(null);
  /**
   * open_draft 是 pending（已提交审核）时：只读展示送审中的版本内容，并记下当前生效版本
   * 以便顶栏给「查看当前生效版本」入口。审核未通过前模板不可编辑（后端 PUT 也会 409）。
   */
  const [pendingReview, setPendingReview] = useState<{ version_no: number; current_version_id?: number; current_version_no?: number } | null>(null);
  /** 版本流动作（提交/撤回/审核）后重跑加载，使编辑/只读态与最新 open_draft 一致 */
  const [reloadToken, setReloadToken] = useState(0);
  const reload = () => setReloadToken((t) => t + 1);
  const lease = useExclusiveEditLease({
    resourceType: 'report_template', resourceId: id,
    enabled: !!id && !permissionPreview && !viewVersionId && !pendingReview,
  });
  const readonly = permissionPreview || !!viewVersionId || !!pendingReview || lease.loading || !lease.acquired;
  /** 草稿乐观锁：保存时回传草稿 updated_at */
  const draftUpdatedAtRef = useRef<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [mockPreview, setMockPreview] = useState(true);
  // 编辑器 ⇄ PDF 双向跳转
  const viewerRef = useRef<TypstViewerHandle>(null);
  const [selectRequest, setSelectRequest] = useState<{ kind: 'field' | 'group'; code: string; token: number } | null>(null);
  // 未保存改动守卫。只读态（历史版本/送审中）不可能有用户改动，直接豁免——加载期规范化不误报。
  const savedSnapRef = useRef(snapTemplate(emptyTemplate));
  const baselineReadyRef = useRef(!id);
  // 保存/快照始终取「最新」模板状态（ref 每次渲染同步）——避免输入控件 onBlur 提交与点「保存」
  // 竞态时，handleSave 闭包里的旧 template 被保存、快照也停在旧内容，离开时仍误弹"未保存"。
  const templateRef = useRef(template);
  templateRef.current = template;
  const replaceTemplateBaseline = useCallback((action: SetStateAction<RecordTemplate>) => {
    replaceHistoryBaseline(previous => {
      const next = typeof action === 'function'
        ? (action as (current: RecordTemplate) => RecordTemplate)(previous)
        : action;
      savedSnapRef.current = snapTemplate(next);
      baselineReadyRef.current = true;
      return next;
    });
  }, [replaceHistoryBaseline]);
  const isDirty = () => baselineReadyRef.current && !readonly
    && snapTemplate(templateRef.current) !== savedSnapRef.current;
  const { confirmLeave } = useUnsavedGuard(isDirty);

  const setVersionFrom = (data: any) =>
    setVersionMeta({ current_version_no: data?.current_version_no, open_draft: data?.open_draft });

  const refreshVersionMeta = async () => {
    if (!id) return;
    try {
      const res = await axios.get(`${API}/report-templates/${id}`);
      setVersionFrom(res.data);
      draftUpdatedAtRef.current = res.data.open_draft?.updated_at || null;
    } catch { /* ignore */ }
  };

  useEffect(() => {
    if (!id) return;
    baselineReadyRef.current = false;
    setLoading(true);
    // 只读查看历史版本
    if (viewVersionId) {
      setPendingReview(null);
      Promise.all([
        axios.get(`${API}/report-templates/${id}/versions/${viewVersionId}`),
        axios.get(`${API}/report-templates/${id}`),
      ])
        .then(([v, m]) => {
          setMeta(m.data);
          setVersionFrom(m.data);
          const tmpl: RecordTemplate = {
            id: Number(id), name: m.data.name, version: v.data.version_no,
            groups: migrateGalleryGroups(v.data.field_definitions || emptyTemplate.groups),
            layout_options: v.data.layout_options || {},
          };
          replaceTemplateBaseline(tmpl);
          setViewingVersion({ version_no: v.data.version_no, status: v.data.status });
          savedSnapRef.current = snapTemplate(tmpl);
          onLoaded?.(m.data);
        })
        .catch(() => message.error('加载历史版本失败'))
        .finally(() => setLoading(false));
      return;
    }
    axios.get(`${API}/report-templates/${id}`)
      .then(async res => {
        setMeta(res.data);
        setVersionFrom(res.data);
        setViewingVersion(null);  // 从历史只读视图导航回 ?id=X 时清掉历史标记，避免顶栏残留
        let groups = res.data.field_definitions && res.data.field_definitions.length
          ? res.data.field_definitions
          : emptyTemplate.groups;
        let layoutOptions = res.data.layout_options || {};
        // 未定稿处理：草稿/被退回→加载其内容继续编辑（可编辑）；待审核→只读展示送审版本
        const od = res.data.open_draft;
        if (!permissionPreview && od && (od.status === 'draft' || od.status === 'rejected')) {
          try {
            const dv = await axios.get(`${API}/report-templates/${id}/versions/${od.id}`);
            groups = dv.data.field_definitions || groups;
            layoutOptions = dv.data.layout_options || layoutOptions;
            message.info(`已加载未生效的${od.status === 'rejected' ? '被退回版本' : '草稿'} v${od.version_no}（${od.author_name}）继续编辑`);
          } catch { /* 草稿拉不到就退回已生效版本 */ }
          setPendingReview(null);
        } else if (!permissionPreview && od && od.status === 'pending') {
          try {
            const dv = await axios.get(`${API}/report-templates/${id}/versions/${od.id}`);
            groups = dv.data.field_definitions || groups;
            layoutOptions = dv.data.layout_options || layoutOptions;
          } catch { /* 拉不到就退回已生效版本 */ }
          setPendingReview({ version_no: od.version_no, current_version_id: res.data.current_version_id, current_version_no: res.data.current_version_no });
        } else {
          setPendingReview(null);
        }
        draftUpdatedAtRef.current = od?.updated_at || null;
        groups = migrateGalleryGroups(groups);   // 存量 report_image_gallery 图片分区 → image 字段分区（幂等；对无 gallery 的分区无操作）
        const { template: tmpl, fixes } = dedupeTemplateIdentity({
          id: res.data.id, name: res.data.name, version: res.data.version,
          groups, layout_options: layoutOptions,
        });
        replaceTemplateBaseline(tmpl);
        savedSnapRef.current = snapTemplate(tmpl);
        if (fixes) message.info(`已自动修复 ${fixes} 处历史数据项冲突，点「保存」可永久固化`);
        onLoaded?.(res.data);
      })
      .catch(() => message.error('加载失败'))
      .finally(() => setLoading(false));
    // onLoaded/emptyTemplate 在各页是稳定引用；仅按 id/version/reloadToken 重载
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, viewVersionId, reloadToken, permissionPreview]);

  /**
   * 历史版本只读视图里「恢复此版本」：
   *  - 正在编辑草稿时→把草稿内容重置为该版本（仍是草稿、不送审），落回草稿编辑；
   *  - 否则→克隆该版本为新待审版本，落到 pending 只读视图。
   */
  const rollbackTo = () => {
    if (!id || !viewVersionId) return;
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
          const r = await axios.post(`${API}/report-templates/${id}/versions/${viewVersionId}/rollback`);
          message.success(r.data.discarded
            ? '已恢复为当前生效版本，草稿已丢弃'
            : r.data.status === 'draft'
            ? `已恢复为 v${viewingVersion?.version_no} 内容（草稿${os === 'pending' ? '，已撤回原审核' : ''}）`
            : `已创建回退版本 v${r.data.version_no}，待审核`);
          navigate({ search: `?id=${id}` });  // 落回干净生效态/草稿/新 pending 视图
        } catch (e: any) {
          message.error('回退失败：' + (e.response?.data?.error || e.message));
        }
      },
    });
  };

  const handleSave = async (options: { silent?: boolean } = {}): Promise<boolean> => {
    if (!id) return false;
    templateHistory.closeGroup();
    // 仅取得/释放编辑权而没有改动时不创建一个内容完全相同的新草稿。
    if (!isDirty()) {
      await refreshVersionMeta();
      return true;
    }
    setSaving(true);
    try {
      const t = templateRef.current;   // 最新状态（防 onBlur 提交与点保存的竞态）
      const res = await axios.put(`${API}/report-templates/${id}`, {
        name: t.name,
        field_definitions: t.groups,
        layout_options: t.layout_options || {},
        draft_updated_at: draftUpdatedAtRef.current || undefined,
      }, { headers: lease.headers });
      draftUpdatedAtRef.current = res.data?.updated_at || null;
      const warns = res.data?.binding_warnings || [];
      if (warns.length) message.warning(`保存成功，但有 ${warns.length} 处数据绑定失效，请检查标红项`);
      else if (!options.silent) message.success('保存成功（草稿，提交审核通过后生效）');
      savedSnapRef.current = snapTemplate(t);
      baselineReadyRef.current = true;
      // “结束编辑”释放锁后要立刻显示可提交的草稿，不能等待后台刷新碰运气。
      await refreshVersionMeta();
      return true;
    } catch (e: any) {
      if (e.response?.data?.code === 'duplicate_name') {
        message.error(e.response.data.error);   // 同名冲突：普通提示，非「保存冲突」并发锁
      } else if (e.response?.status === 423) {
        message.warning(e.response?.data?.error || '该模板已由其他用户占用编辑，当前为只读');
      } else if (e.response?.status === 409) {
        Modal.confirm({
          title: '保存冲突',
          content: e.response?.data?.error || '草稿已被其他人修改或正在审核中。',
          okText: '刷新加载最新内容',
          cancelText: '留在本页（手动备份改动）',
          onOk: () => window.location.reload(),
        });
      } else {
        message.error('保存失败：' + (e.response?.data?.error || e.message || ''));
      }
      return false;
    } finally {
      setSaving(false);
    }
  };

  useAutoSave({
    enabled: baselineReadyRef.current && !loading && !saving && !readonly && !!id,
    isDirty,
    save: () => handleSave({ silent: true }),
  });

  return {
    id, navigate, readonly, permissionPreview, pendingReview, lease, reload, rollbackTo,
    template, setTemplate, replaceTemplateBaseline,
    historyEvents: { onPointerDownCapture: templateHistory.closeGroup, onFocusCapture: templateHistory.closeGroup },
    undo: templateHistory.undo, redo: templateHistory.redo, reset: templateHistory.reset,
    canUndo: templateHistory.canUndo, canRedo: templateHistory.canRedo, canReset: templateHistory.canReset,
    meta, viewingVersion, versionMeta, refreshVersionMeta,
    loading, saving, mockPreview, setMockPreview,
    viewerRef, selectRequest, setSelectRequest,
    handleSave, confirmLeave,
    collaborationChanges: isDirty() ? ['报告模板内容（未保存）'] : [],
  };
}
