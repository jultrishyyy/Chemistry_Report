import { useState, useEffect, useMemo, type Key } from 'react';
import { useNavigate } from 'react-router-dom';
import { Table, Button, Space, message, Modal, Tag, Select, Segmented, Tooltip, Input } from 'antd';
import { PlusOutlined, EditOutlined, EyeOutlined, ApartmentOutlined } from '@ant-design/icons';
import axios from 'axios';
import dayjs from 'dayjs';
import TemplateVersionPanel from '../../components/TemplateVersionPanel';
import PageHeader from '../../components/PageHeader';
import TemplateSearchBar from '../../components/TemplateSearchBar';
import TemplateArchiveButton from '../../components/TemplateArchiveButton';
import PdfDownloadButton from '../../components/PdfDownloadButton';
import { downloadRecordTemplatePdf } from '../../utils/pdfDownload';
import {
  buildTemplateTree, filterTemplateRows, parentRowKeys, activityTs, applyTemplateSearch,
  type TemplateListFilter, type TemplateSearchCriteria,
} from '../../components/template-tree';
import { useAuth } from '../../auth';
import { isInteractiveRowTarget } from '../../utils/rowNavigation';
import TemplatePdfPreviewModal from '../../components/TemplatePdfPreviewModal';
import { ListPageSizeControl, useListPagination } from '../../hooks/useListPagination';
import TestMethodManagerModal from '../../components/TestMethodManagerModal';
import TestTemplateGroupArchiveActions from '../../components/TestTemplateGroupArchiveActions';

const STATUS_COLOR: Record<string, string> = { draft: 'default', pending: 'orange', rejected: 'red' };
const STATUS_LABEL: Record<string, string> = { draft: '草稿', pending: '待审核', rejected: '已退回' };

/**
 * ▼▼ 列宽配置（单位 px，按需直接改数字）▼▼
 * 名称列也是固定宽（超出省略号悬停看全名）。所有列宽之和小于表格容器时，
 * 浏览器会按比例拉伸各列——想让某列吃掉更多剩余空间就把它的数字调大。
 */
const COL_WIDTH = {
  id: 88,          // ID（树形展开按钮也占用本列，需留足空间避免 #编号换行）
  name: 240,       // 名称
  version: 58,     // 版本
  status: 120,     // 状态
  parent: 130,     // 母模板（仅"待审核/我的草稿"平铺视图显示）
  modified: 136,   // 最近修改时间
  history: 76,     // 版本管理
  lineage: 76,     // 关联关系
  contentActions: 184, // 内容操作（派生/编辑/下载/删除申请）
  workflow: 190,   // 流程操作（提交审核+撤回，或审核）
};

const API = '/api';

const familyRowKey = (familyId: number | string) => `family-${familyId}`;
const isFamilyRow = (row: any) => row?._row_type === 'family';

export default function RecordTemplateList() {
  const navigate = useNavigate();
  const { user, has } = useAuth();
  const canEditTemplates = has('record_template.edit');
  const [previewTemplate, setPreviewTemplate] = useState<{ id: number; name: string } | null>(null);
  const openTemplate = (row: { id: number; name: string }) => {
    if (canEditTemplates) navigate(`/record-templates/editor?id=${row.id}`);
    else setPreviewTemplate(row);
  };
  const [templates, setTemplates] = useState<any[]>([]);
  const [families, setFamilies] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<TemplateListFilter>('all');
  const [search, setSearch] = useState<TemplateSearchCriteria>({});
  const [expandedKeys, setExpandedKeys] = useState<readonly Key[]>([]);
  const { pagination, pageSize, setPageSize } = useListPagination(`${filter}:${JSON.stringify(search)}`);

  const load = () => {
    setLoading(true);
    Promise.all([axios.get(`${API}/record-templates`), axios.get(`${API}/test-methods/groups`)])
      .then(([res, groupResponse]) => {
        const nextTemplates = res.data || [];
        const nextFamilies = groupResponse.data || [];
        const groupedTemplateIds = new Set(nextFamilies.flatMap((group: any) =>
          (group.methods || []).map((method: any) => Number(method.record_template_id))));
        const independentTree = buildTemplateTree(nextTemplates.filter((template: any) => !groupedTemplateIds.has(Number(template.id))));
        setTemplates(nextTemplates); setFamilies(nextFamilies);
        // 项目组和未归组模板原有的母子树均默认展开。
        setExpandedKeys([
          ...nextFamilies.map((group: any) => familyRowKey(group.id)),
          ...parentRowKeys(independentTree),
        ]);
      })
      .catch(() => message.error('加载失败'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  // “新建模板”：可以从零创建，也可以复制一份已有模板的内容作为起点。
  const defaultBase = templates.find(t => t.name === '基础原始记录模板') || templates[0];
  const [createOpen, setCreateOpen] = useState(false);
  const [methodManagerOpen, setMethodManagerOpen] = useState(false);
  const [managedFamilyId, setManagedFamilyId] = useState<number | null>(null);
  const [skeleton, setSkeleton] = useState<number | 'blank'>('blank');
  const [createFamilyId, setCreateFamilyId] = useState<number | 'new' | undefined>();
  const [createFamilyName, setCreateFamilyName] = useState('');
  const [createFamilyDescription, setCreateFamilyDescription] = useState('');
  const openCreate = (family?: any) => {
    setSkeleton(defaultBase ? defaultBase.id : 'blank');
    setCreateFamilyId(family?.family_id ?? family?.id);
    setCreateFamilyName('');
    setCreateFamilyDescription('');
    setCreateOpen(true);
  };
  const doCreate = async () => {
    try {
      let familyId = createFamilyId === 'new' ? undefined : createFamilyId;
      let familyName = families.find(group => Number(group.id) === Number(familyId))?.name || '';
      if (createFamilyId === 'new') {
        if (!createFamilyName.trim()) { message.warning('请填写新项目组名称'); return; }
        const response = await axios.post(`${API}/test-methods/groups`, {
          name: createFamilyName.trim(), description: createFamilyDescription.trim() || undefined,
        });
        familyId = Number(response.data.id); familyName = response.data.name;
      }
      setCreateOpen(false);
      const suffix = familyId ? `&group_id=${familyId}&group_name=${encodeURIComponent(familyName)}` : '';
      if (skeleton === 'blank') navigate(`/record-templates/editor?from=blank${suffix}`);
      else navigate(`/record-templates/editor?clone_id=${skeleton}${suffix}`);
    } catch (error: any) { message.error(error?.response?.data?.error || '项目组创建失败'); }
  };

  const pendingCount = templates.filter(t => t.open_draft?.status === 'pending').length;
  const mineCount = templates.filter(t =>
    t.open_draft && (t.open_draft.status === 'draft' || t.open_draft.status === 'rejected')
    && t.open_draft.author_name === user?.display_name).length;

  // 项目组始终作为顶层行；组内原始记录模板作为直接子行。
  // 未归组模板仍沿用原有母子模板树。把组名/编码加入搜索文本后，可直接按项目组查找。
  const dataSource = useMemo(() => {
    const familyByTemplateId = new Map<number, any>();
    for (const family of families) {
      for (const method of family.methods || []) {
        familyByTemplateId.set(Number(method.record_template_id), { family, method });
      }
    }

    const searchable = templates.map(template => {
      const membership = familyByTemplateId.get(Number(template.id));
      if (!membership) return template;
      return {
        ...template,
        name: [template.name, membership.family.name, membership.family.code,
          membership.method.method_name, membership.method.method_code, membership.method.standard]
          .filter(Boolean).join(' '),
      };
    });
    const matchedIds = new Set(applyTemplateSearch(searchable, search).map(template => Number(template.id)));
    const searched = templates.filter(template => matchedIds.has(Number(template.id)));
    const visibleTemplates = filter === 'all'
      ? searched
      : filterTemplateRows(searched, filter, user?.display_name);
    const visibleById = new Map(visibleTemplates.map(template => [Number(template.id), template]));

    const familyRows = families.flatMap(family => {
      const matchedChildren = (family.methods || []).flatMap((method: any) => {
        const template = visibleById.get(Number(method.record_template_id));
        if (!template) return [];
        return [{
          ...template,
          _row_type: 'template',
          _family_id: Number(family.id),
        }];
      });
      const children = matchedChildren.map((child: any, index: number) => ({
        ...child,
        _family_first: index === 0,
        _family_last: index === matchedChildren.length - 1,
      }));

      // “全部”且无搜索条件时也显示尚未添加模板的空项目组。
      const keyword = search.keyword?.trim().toLowerCase();
      const familyDirectMatch = !!keyword && [family.name, family.code, family.description]
        .some(value => String(value || '').toLowerCase().includes(keyword));
      const hasNonKeywordSearch = !!(search.status || search.author?.trim()
        || (search.range && (search.range[0] || search.range[1])) || search.scope);
      const showFamilyWithoutChildren = filter === 'all' && !hasNonKeywordSearch
        && (!keyword || familyDirectMatch);
      if (!children.length && !showFamilyWithoutChildren) return [];

      const timestamps = children.map((child: any) => activityTs(child)).filter(Number.isFinite);
      const familyUpdatedAt = new Date(family.updated_at || family.created_at || 0).getTime();
      const latestTimestamp = Math.max(Number.isFinite(familyUpdatedAt) ? familyUpdatedAt : 0, ...timestamps);
      return [{
        ...family,
        id: familyRowKey(family.id),
        family_id: Number(family.id),
        _row_type: 'family',
        name: family.name,
        last_activity: latestTimestamp ? new Date(latestTimestamp).toISOString() : null,
        method_count: (family.methods || []).length,
        visible_method_count: children.length,
        children,
      }];
    });

    const groupedIds = new Set(families.flatMap(family =>
      (family.methods || []).map((method: any) => Number(method.record_template_id))));
    const independent = visibleTemplates.filter(template => !groupedIds.has(Number(template.id)));
    const independentRows = filter === 'all' ? buildTemplateTree(independent) : independent;
    return [...familyRows, ...independentRows]
      .sort((a: any, b: any) => activityTs(b) - activityTs(a));
  }, [templates, families, filter, search, user?.display_name]);

  const toggleFamily = (row: any) => {
    const key = familyRowKey(row.family_id);
    setExpandedKeys(keys => keys.includes(key) ? keys.filter(item => item !== key) : [...keys, key]);
  };

  return (
    <div style={{ padding: 24 }}>
      <PageHeader
        title="原始记录模板"
        subtitle="可视化搭建表格、字段和公式；可以从零创建，也可以复制已有模板内容后继续修改。"
        extra={
          <Space>
            <Button icon={<ApartmentOutlined />} disabled={!canEditTemplates} onClick={() => {
              setManagedFamilyId(null); setMethodManagerOpen(true);
            }}>管理项目组</Button>
            <Tooltip title={canEditTemplates ? '新建原始记录模板' : '当前账号无模板编辑权限'}>
              <Button type="primary" icon={<PlusOutlined />} disabled={!canEditTemplates} onClick={openCreate}>新建模板</Button>
            </Tooltip>
          </Space>
        }
      />

      <TestMethodManagerModal open={methodManagerOpen} groupId={managedFamilyId}
        onClose={() => setMethodManagerOpen(false)} onChanged={load}
        onCreateTemplate={(group) => { setMethodManagerOpen(false); openCreate(group); }} />

      <Modal title="新建原始记录模板" open={createOpen} onOk={doCreate} onCancel={() => setCreateOpen(false)}
        okText="创建并编辑" cancelText="取消" destroyOnClose>
        <p style={{ color: '#667085', fontSize: 12 }}>选择创建方式：从零开始，或者复制一份已有模板的全部内容，再在副本上修改。</p>
        <Select
          showSearch optionFilterProp="label" style={{ width: '100%' }} value={skeleton}
          onChange={(v) => setSkeleton(v)}
          placeholder="搜索模板名…"
          options={[
            { value: 'blank', label: '从零创建（空白模板）' },
            ...templates.map(t => ({ value: t.id, label: `复制「${t.name}」的内容后创建（当前 v${t.current_version_no || t.version || '?'}）` })),
          ]}
        />
        <div style={{ marginTop: 12, marginBottom: 5, fontSize: 12, fontWeight: 600 }}>所属项目组（可选）</div>
        <Select allowClear showSearch optionFilterProp="label" style={{ width: '100%' }} value={createFamilyId}
          onChange={setCreateFamilyId} placeholder="暂不归类"
          options={[
            { value: 'new', label: '＋ 新建项目组' },
            ...families.filter(group => group.enabled).map(group => ({ value: group.id, label: `${group.name}（${group.methods?.length || 0} 个模板）` })),
          ]} />
        {createFamilyId === 'new' && <Input style={{ marginTop: 8 }} value={createFamilyName}
          onChange={event => setCreateFamilyName(event.target.value)} placeholder="请输入新项目组名称" />}
        {createFamilyId === 'new' && <Input.TextArea style={{ marginTop: 8 }} rows={2} value={createFamilyDescription}
          onChange={event => setCreateFamilyDescription(event.target.value)} placeholder="项目组说明（可选）" />}
      </Modal>

      <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <Segmented
          value={filter}
          onChange={(v) => setFilter(v as TemplateListFilter)}
          options={[
            { label: '全部', value: 'all' },
            { label: `待审核（${pendingCount}）`, value: 'pending' },
            { label: `我的草稿（${mineCount}）`, value: 'mine' },
          ]}
        />
        <TemplateSearchBar value={search} onChange={setSearch} />
        <ListPageSizeControl value={pageSize} onChange={setPageSize} />
      </div>

      <Table
        className="compact-template-list"
        dataSource={dataSource}
        rowKey={(row) => isFamilyRow(row) ? familyRowKey(row.family_id) : row.id}
        loading={loading}
        size="small"
        tableLayout="fixed"
        pagination={pagination}
        // 固定左侧识别列与右侧操作列，仅让中间的模板信息横向滚动。
        // 过滤视图会额外显示“母模板”，因此需要预留更多横向宽度。
        scroll={{ x: filter === 'all' ? 1200 : 1330 }}
        rowClassName={(row) => isFamilyRow(row)
          ? 'clickable-detail-row template-family-row'
          : row._family_id
            ? `clickable-detail-row template-family-member-row${row._family_first ? ' template-family-member-first' : ''}${row._family_last ? ' template-family-member-last' : ''}`
            : 'clickable-detail-row'}
        onRow={(row) => ({
          onClick: (event) => {
            if (isInteractiveRowTarget(event.target)) return;
            if (isFamilyRow(row)) { toggleFamily(row); return; }
            if (!row.archive_requested_by && row.open_draft?.status !== 'pending') openTemplate(row);
          },
        })}
        expandable={{
          expandedRowKeys: expandedKeys,
          onExpandedRowsChange: setExpandedKeys,
          rowExpandable: (row) => !!row.children?.length,
        }}
        columns={[
          {
            title: 'ID', width: COL_WIDTH.id, fixed: 'left' as const, align: 'center' as const,
            render: (_: any, r: any) => isFamilyRow(r)
              ? <span className="template-family-kind"><ApartmentOutlined /> 项目组</span>
              : <span style={{ color: '#888', whiteSpace: 'nowrap' }}>#{r.id}</span>,
          },
          {
            title: '名称', dataIndex: 'name', width: COL_WIDTH.name, fixed: 'left' as const, ellipsis: true, align: 'left' as const,
            render: (v: string, r: any) => isFamilyRow(r) ? (
              <div className="template-family-heading">
                <div><span className="template-family-heading-icon"><ApartmentOutlined /></span><b>{v}</b></div>
                <div className="template-family-heading-meta">
                  本组包含&nbsp;
                  <b>
                  {r.visible_method_count === r.method_count
                    ? `${r.method_count} 个模板`
                    : `${r.visible_method_count}/${r.method_count} 个模板`}
                  </b>
                  {r.description ? ` · ${r.description}` : ' · 点击整行展开或收起'}
                  {!r.enabled && <Tag style={{ marginLeft: 5, fontSize: 11 }}>已停用</Tag>}
                </div>
              </div>
            ) : (
              <span>
                {v}
                {r.parent_template_id && <Tag color="orange" style={{ marginLeft: 6, fontSize: 11 }}>子模板</Tag>}
              </span>
            ),
          },
          {
            title: '版本', width: COL_WIDTH.version, align: 'center' as const,
            render: (_: any, r: any) => isFamilyRow(r)
              ? <span style={{ color: '#aaa' }}>—</span>
              : <Tag color="green" style={{ margin: 0 }}>v{r.current_version_no ?? '?'}</Tag>,
          },
          {
            title: '状态', width: COL_WIDTH.status, align: 'center' as const,
            render: (_: any, r: any) => isFamilyRow(r) ? (
              <Space size={2} wrap>
                <Tag color={r.enabled ? 'green' : 'default'} style={{ marginInlineEnd: 0 }}>{r.enabled ? '使用中' : '已停用'}</Tag>
                {r.archive_requested_by && <Tooltip title={`${r.archive_requested_by} 申请删除，等待审核`}>
                  <Tag color="red" style={{ marginInlineEnd: 0 }}>删除待审</Tag>
                </Tooltip>}
              </Space>
            ) : (
              <Space size={2} wrap>
                {r.open_draft ? (
                  <Tooltip title={`v${r.open_draft.version_no} · ${r.open_draft.author_name}`}>
                    <Tag color={STATUS_COLOR[r.open_draft.status]} style={{ marginInlineEnd: 0 }}>
                      {STATUS_LABEL[r.open_draft.status]} v{r.open_draft.version_no}
                    </Tag>
                  </Tooltip>
                ) : <Tag color="green" style={{ marginInlineEnd: 0 }}>已生效</Tag>}
                {r.archive_requested_by && (
                  <Tooltip title={`${r.archive_requested_by} 申请删除，待审核员审批`}>
                    <Tag color="red" style={{ marginInlineEnd: 0 }}>删除待审</Tag>
                  </Tooltip>
                )}
              </Space>
            ),
          },
          // 过滤视图是平铺的，母模板列帮助定位；树形视图下母子关系已可见
          ...(filter !== 'all' ? [{
            title: '母模板', width: COL_WIDTH.parent, align: 'center' as const,
            render: (_: any, r: any) => {
              if (isFamilyRow(r)) return <span style={{ color: '#aaa' }}>—</span>;
              if (!r.parent_template_id) return <span style={{ color: '#aaa' }}>—</span>;
              const parent = templates.find(t => t.id === r.parent_template_id);
              return (
                <a onClick={(e) => {
                  e.preventDefault();
                  if (parent) openTemplate(parent);
                }}>
                  <Tag color="orange" style={{ cursor: 'pointer' }}>
                    #{r.parent_template_id} {parent ? parent.name : '已删除'}
                  </Tag>
                </a>
              );
            },
          }] : []),
          {
            title: '最近修改时间', width: COL_WIDTH.modified, align: 'center' as const,
            sorter: filter === 'all' ? undefined : (a: any, b: any) => activityTs(a) - activityTs(b),
            render: (_: any, r: any) => (
              <span style={{ fontSize: 12, color: '#5b6675', whiteSpace: 'nowrap' }}>
                {r.last_activity || r.updated_at ? dayjs(r.last_activity || r.updated_at).format('YYYY-MM-DD HH:mm') : '—'}
              </span>
            ),
          },
          {
            title: '版本管理', width: COL_WIDTH.history, align: 'center' as const,
            render: (_: any, r: any) => isFamilyRow(r) ? <span style={{ color: '#aaa' }}>—</span> : (
              <TemplateVersionPanel
                kind="record" templateId={r.id} templateName={r.name}
                currentVersionNo={r.current_version_no} openDraft={r.open_draft}
                onRefresh={load} actionsOnly iconOnly buttons={['history']}
                editorPathBase="/record-templates/editor"
              />
            ),
          },
          {
            title: '关联关系', width: COL_WIDTH.lineage, align: 'center' as const,
            render: (_: any, r: any) => isFamilyRow(r) ? <span style={{ color: '#aaa' }}>—</span> : (
              <TemplateVersionPanel
                kind="record" templateId={r.id} templateName={r.name}
                currentVersionNo={r.current_version_no} openDraft={r.open_draft}
                onRefresh={load} actionsOnly iconOnly buttons={['lineage']}
                editorPathBase="/record-templates/editor"
              />
            ),
          },
          {
            title: '内容操作', width: COL_WIDTH.contentActions, fixed: 'right' as const, align: 'center' as const,
            render: (_: any, r: any) => {
              if (isFamilyRow(r)) return (
                <Space size={4} className="table-row-actions">
                  <Tooltip title="只管理当前项目组">
                    <Button size="small" icon={<ApartmentOutlined />} onClick={() => {
                      setManagedFamilyId(Number(r.family_id)); setMethodManagerOpen(true);
                    }} />
                  </Tooltip>
                  <Tooltip title="在当前项目组中新建原始记录模板">
                    <Button size="small" type="primary" ghost icon={<PlusOutlined />}
                      disabled={!canEditTemplates} onClick={() => openCreate(r)} />
                  </Tooltip>
                </Space>
              );
              const locked = !!r.archive_requested_by || r.open_draft?.status === 'pending';
              return <Space size={4} className="table-row-actions">
                <TemplateVersionPanel
                  kind="record" templateId={r.id} templateName={r.name}
                  currentVersionNo={r.current_version_no} openDraft={r.open_draft}
                  onRefresh={load} actionsOnly iconOnly buttons={r.template_group_id ? [] : ['fork']}
                  editorPathBase="/record-templates/editor" disabled={locked}
                />
                <Tooltip title={canEditTemplates ? '编辑' : '预览'}>
                  <Button size="small" disabled={locked} icon={canEditTemplates ? <EditOutlined /> : <EyeOutlined />} onClick={() => openTemplate(r)} />
                </Tooltip>
                <PdfDownloadButton title="下载该模板渲染 PDF（示例数据预览）"
                  disabled={locked} onDownload={() => downloadRecordTemplatePdf(r.id, r.name || '原始记录模板')} />
              </Space>
            },
          },
          {
            title: '流程操作', width: COL_WIDTH.workflow, fixed: 'right' as const, align: 'center' as const,
            render: (_: any, r: any) => isFamilyRow(r) ? (
              <TestTemplateGroupArchiveActions group={r} onRefresh={load} />
            ) : (
              <Space size={4} className="table-row-actions table-workflow-actions">
                {r.archive_requested_by ? <TemplateArchiveButton kind="record" row={r} onRefresh={load} fixedWorkflow /> : <>
                <TemplateVersionPanel
                  kind="record" templateId={r.id} templateName={r.name}
                  currentVersionNo={r.current_version_no} openDraft={r.open_draft}
                  onRefresh={load} actionsOnly iconOnly buttons={['submit']}
                  editorPathBase="/record-templates/editor"
                />
                <TemplateArchiveButton kind="record" row={r} onRefresh={load}
                  disabled={r.open_draft?.status === 'pending'}
                  disabledReason="模板版本正在审核中，请先完成审核或撤回后再申请删除" />
                </>}
              </Space>
            ),
          },
        ]}
      />
      {previewTemplate && (
        <TemplatePdfPreviewModal
          open
          kind="record"
          templateId={previewTemplate.id}
          templateName={previewTemplate.name}
          onClose={() => setPreviewTemplate(null)}
        />
      )}
    </div>
  );
}
