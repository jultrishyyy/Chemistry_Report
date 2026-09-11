import { useState, useEffect, type Key } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Alert, Table, Button, message, Modal, Form, Input, Select, Tabs, Tag, Space, Segmented, Tooltip, Popconfirm } from 'antd';
import { DEFAULT_PROJECT_THEME_CONFIG } from '../../../../shared/report-inherit';
import { ApartmentOutlined, EditOutlined, PlusOutlined, FileDoneOutlined, FileTextOutlined, EyeOutlined, DatabaseOutlined } from '@ant-design/icons';
import axios from 'axios';
import dayjs from 'dayjs';
import TemplateVersionPanel from '../../components/TemplateVersionPanel';
import PageHeader from '../../components/PageHeader';
import TemplateSearchBar from '../../components/TemplateSearchBar';
import TemplateArchiveButton from '../../components/TemplateArchiveButton';
import PdfDownloadButton from '../../components/PdfDownloadButton';
import { downloadReportTemplatePdf } from '../../utils/pdfDownload';
import {
  buildTemplateTree, filterTemplateRows, parentRowKeys, activityTs, applyTemplateSearch,
  type TemplateListFilter, type TemplateSearchCriteria,
} from '../../components/template-tree';
import { useAuth } from '../../auth';
import { isInteractiveRowTarget } from '../../utils/rowNavigation';
import TemplatePdfPreviewModal from '../../components/TemplatePdfPreviewModal';
import { useListPagination } from '../../hooks/useListPagination';
import ReportProjectFamilyManagerModal from '../../components/ReportProjectFamilyManagerModal';
import TestTemplateGroupArchiveActions from '../../components/TestTemplateGroupArchiveActions';

const STATUS_COLOR: Record<string, string> = { draft: 'default', pending: 'orange', rejected: 'red' };
const STATUS_LABEL: Record<string, string> = { draft: '草稿', pending: '待审核', rejected: '已退回' };

/**
 * ▼▼ 列宽配置（单位 px，按需直接改数字）▼▼
 * 名称列也是固定宽（超出省略号悬停看全名）。所有列宽之和小于表格容器时，
 * 浏览器会按比例拉伸各列——想让某列吃掉更多剩余空间就把它的数字调大。
 */
const COL_WIDTH = {
  id: 76,          // ID（树形展开按钮也占用本列，需留足空间避免 #编号换行）
  name: 220,       // 名称
  version: 58,     // 版本
  status: 130,     // 状态（固定宽度，多状态时在单元格内横向滚动）
  parent: 130,     // 母模板（仅"待审核/我的草稿"平铺视图显示）
  linked: 220,     // 关联原始记录（仅项目模板 Tab，固定宽度，长名称在单元格内横向滚动）
  manufacturer: 210, // 主机厂（固定宽度，长名称在单元格内横向滚动）
  modified: 132,   // 最近修改时间
  history: 70,     // 版本管理
  lineage: 70,     // 关联关系
  contentActions: 152, // 内容操作（派生/编辑/下载/删除申请）
  workflow: 144,   // 流程操作（提交审核+撤回，或审核）
};

const API = '/api';

interface ReportTemplate {
  id: number;
  name: string;
  version: number;
  template_kind: 'cover' | 'project' | 'cover_page';
  test_project_codes?: string[];
  linked_record_template_id?: number;
  linked_record_template_name?: string | null;
  linked_record_project_name?: string | null;
  host_manufacturer_id?: number | null;
  host_manufacturer_name?: string | null;
  host_manufacturer_category?: string | null;
  report_project_family_id?: number | null;
  report_project_family_name?: string | null;
  base_report_template_id?: number | null;
  layout_options?: Record<string, any>;
  updated_at: string;
  last_activity?: string;
  current_version_no?: number;
  open_draft?: any;
  archive_requested_by?: string | null;
  archive_requested_at?: string | null;
  archive_request_note?: string | null;
  parent_template_id?: number | null;
  children?: ReportTemplate[];
  description?: string | null;
  family_id?: number;
  method_count?: number;
  visible_method_count?: number;
  _row_type?: 'report_group';
  _family_first?: boolean;
  _family_last?: boolean;
}

interface RecordTemplateRef {
  id: number;
  name: string;
  version: number;
  current_version_no?: number;
  open_draft?: { version_no?: number; status?: string } | null;
}
interface HostManufacturer { id: number; name: string; category?: string | null; short_name?: string | null; code?: string | null; remark?: string | null; }
interface ReportProjectGroup {
  id: number; name: string; description?: string | null; host_manufacturer_id?: number | null;
  template_kind: 'cover' | 'project';
  host_manufacturer_name?: string | null; enabled?: boolean; updated_at: string;
  archive_requested_by?: string | null; archive_requested_at?: string | null; archive_request_note?: string | null;
  templates?: ReportTemplate[]; base_report_template_id?: number | null;
}
const reportGroupRowKey = (id: number | string) => `report-group-${id}`;
const isReportGroupRow = (row: any) => row?._row_type === 'report_group';

export default function ReportTemplateList() {
  const navigate = useNavigate();
  // 当前 tab 入 URL（?tab=cover|project）：从编辑器「返回」时带回进入时所在的 tab（从哪进回哪）
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') === 'project' ? 'project' : 'cover';
  const { user, has } = useAuth();
  const canEditTemplates = has('report_template.edit');
  const [previewTemplate, setPreviewTemplate] = useState<ReportTemplate | null>(null);
  const editorBaseFor = (row: ReportTemplate) =>
    row.template_kind === 'project' ? '/report-templates/project/editor' : '/report-templates/cover/editor';
  const openTemplate = (row: ReportTemplate) => {
    if (canEditTemplates) navigate(`${editorBaseFor(row)}?id=${row.id}`);
    else setPreviewTemplate(row);
  };
  const [filter, setFilter] = useState<TemplateListFilter>('all');
  const [search, setSearch] = useState<TemplateSearchCriteria>({});
  const [expandedKeys, setExpandedKeys] = useState<readonly Key[]>([]);
  const { pagination } = useListPagination(`${activeTab}:${filter}:${JSON.stringify(search)}`);
  const [templates, setTemplates] = useState<ReportTemplate[]>([]);
  const [reportGroups, setReportGroups] = useState<ReportProjectGroup[]>([]);
  const [recordTemplates, setRecordTemplates] = useState<RecordTemplateRef[]>([]);
  const [manufacturers, setManufacturers] = useState<HostManufacturer[]>([]);
  const [hostFilter, setHostFilter] = useState<number | undefined>();
  const [factorySearch, setFactorySearch] = useState('');
  const [factoryOpen, setFactoryOpen] = useState(false);
  const [factoryEditorOpen, setFactoryEditorOpen] = useState(false);
  const [editingFactory, setEditingFactory] = useState<HostManufacturer | null>(null);
  const [factorySaving, setFactorySaving] = useState(false);
  const [factoryForm] = Form.useForm();
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState<false | 'cover' | 'project' | 'cover_page'>(false);
  const [creating, setCreating] = useState(false);
  const [form] = Form.useForm();
  const [linkingRow, setLinkingRow] = useState<ReportTemplate | null>(null);
  const [linkingId, setLinkingId] = useState<number | undefined>();
  const [manufacturerLinkingRow, setManufacturerLinkingRow] = useState<ReportTemplate | null>(null);
  const [manufacturerLinkingId, setManufacturerLinkingId] = useState<number | undefined>();
  const [familyManagerOpen, setFamilyManagerOpen] = useState(false);
  const [managedReportGroupId, setManagedReportGroupId] = useState<number | null>(null);
  const [managedReportGroupKind, setManagedReportGroupKind] = useState<'cover' | 'project'>('project');
  const [createReportGroup, setCreateReportGroup] = useState<ReportProjectGroup | null>(null);
  const openCreate = (kind: 'cover' | 'project', group?: ReportProjectGroup | null) => {
    form.resetFields();
    setCreateReportGroup(group || null);
    setCreateOpen(kind);
  };
  const recordTemplateOptionLabel = (t: RecordTemplateRef) => {
    const version = t.current_version_no ?? t.open_draft?.version_no ?? t.version;
    const state = t.current_version_no != null ? '已生效' : t.open_draft?.status === 'pending' ? '待审核' : '草稿';
    return `${t.name} · v${version} ${state}`;
  };

  const load = () => {
    setLoading(true);
    Promise.all([
      axios.get(`${API}/report-templates`), axios.get(`${API}/report-project-families`),
      axios.get(`${API}/record-templates`), axios.get(`${API}/host-manufacturers`),
    ])
      .then(([templateResult, groupResult, recordResult, manufacturerResult]) => {
        const nextTemplates = templateResult.data || [];
        const nextGroups = groupResult.data || [];
        setTemplates(nextTemplates); setReportGroups(nextGroups);
        setRecordTemplates(recordResult.data || []); setManufacturers(manufacturerResult.data || []);
        setExpandedKeys([
          ...nextGroups.map((group: ReportProjectGroup) => reportGroupRowKey(group.id)),
          ...parentRowKeys(buildTemplateTree(nextTemplates)),
        ]);
      })
      .catch(() => message.error('加载失败'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async () => {
    try {
      const values = await form.validateFields();
      setCreating(true);
      const payload: any = {
        name: values.name,
        template_kind: createOpen,
        layout_options: { blocks: [] },
      };
      // 显式传递关联；后端以 null 表示未设置，避免主机厂值在创建过程中被遗漏。
      payload.host_manufacturer_id = values.host_manufacturer_id ?? null;
      payload.report_project_family_id = createReportGroup?.id ?? null;
      if (createOpen === 'project') {
        payload.linked_record_template_id = values.linked_record_template_id;
        // 项目模板默认文档样式＝弯曲强度&弯曲模量模板（字体/字号/字段间距/分区加粗/页边距）
        payload.layout_options = {
          ...payload.layout_options,
          theme_config: { ...DEFAULT_PROJECT_THEME_CONFIG },
          // 创建接口据此在同一事务内读取关联记录、生成字段并配置映射。
          pending_record_inherit: {
            record_template_id: values.linked_record_template_id,
            record_template_name: recordTemplates.find(t => t.id === values.linked_record_template_id)?.name,
          },
        };
      }
      // 项目模板始终由所关联的原始记录生成；首页模板仍可复制现有模板内容。
      if (createOpen !== 'project' && values.skeleton && values.skeleton !== 'blank') {
        // 复制现有模板的内容（groups + 版式）作为新模板起点
        const src = (await axios.get(`${API}/report-templates/${values.skeleton}`)).data;
        payload.field_definitions = src.field_definitions || [];
        payload.layout_options = src.layout_options || payload.layout_options;
        // 复制现有模板且未主动指定时，沿用其主机厂归属，避免同一套模板拆出无归属副本。
        if (!payload.host_manufacturer_id && src.host_manufacturer_id) {
          payload.host_manufacturer_id = src.host_manufacturer_id;
        }
      }
      const res = await axios.post(`${API}/report-templates`, payload);
      message.success(createOpen === 'project'
        ? `创建成功，已从关联原始记录配置 ${res.data?.inheritance?.mapped ?? 0} 个映射`
        : '创建成功');
      setCreateOpen(false);
      setCreateReportGroup(null);
      form.resetFields();
      load();
      if (createOpen === 'project') {
        navigate(`/report-templates/project/editor?id=${res.data.id}`);
      } else {
        // 封面与首页都复用 cover 编辑器（按 id 编辑 groups/样式）
        navigate(`/report-templates/cover/editor?id=${res.data.id}`);
      }
    } catch (e: any) {
      message.error('创建失败：' + (e.response?.data?.error || e.message || ''));
    } finally {
      setCreating(false);
    }
  };

  const handleLinkSave = async () => {
    if (!linkingRow) return;
    try {
      await axios.put(`${API}/report-templates/${linkingRow.id}`, {
        linked_record_template_id: linkingId,
      });
      message.success('已更新关联原始记录');
      setLinkingRow(null);
      load();
    } catch (e: any) {
      message.error('更新失败：' + (e.response?.data?.error || e.message));
    }
  };

  const handleManufacturerLinkSave = async () => {
    if (!manufacturerLinkingRow) return;
    try {
      await axios.put(`${API}/report-templates/${manufacturerLinkingRow.id}`, {
        host_manufacturer_id: manufacturerLinkingId ?? null,
      });
      message.success('已更新主机厂关联');
      setManufacturerLinkingRow(null);
      load();
    } catch (e: any) {
      message.error('更新失败：' + (e.response?.data?.error || e.message));
    }
  };

  const covers = templates.filter(t => (t.template_kind || 'cover') === 'cover');
  const projects = templates.filter(t => t.template_kind === 'project');

  // 高级搜索先过滤，再走视图：全部 = 树形分组（同 Tab 内母子嵌套，按子树最近修改排序）；过滤视图 = 平铺
  const renderTable = (allRows: ReportTemplate[], kind: 'cover' | 'project' | 'cover_page') => {
    const rows = applyTemplateSearch(allRows.filter(t => !hostFilter || t.host_manufacturer_id === hostFilter), search);
    const visibleTemplates = filter === 'all' ? rows : filterTemplateRows(rows, filter, user?.display_name);
    const groupsForKind = reportGroups.filter(group => group.template_kind === kind);
    const groupedTemplateIds = new Set(groupsForKind.flatMap(group =>
      (group.templates || []).map(template => Number(template.id))));
    const keyword = search.keyword?.trim().toLowerCase();
    const hasStructuredSearch = !!(search.status || search.author?.trim()
      || (search.range && (search.range[0] || search.range[1])) || search.scope);
    const tableRows: any[] = [
          ...groupsForKind.flatMap(group => {
            if (hostFilter && Number(group.host_manufacturer_id) !== Number(hostFilter)) return [];
            const matchedChildren = visibleTemplates.filter(template => Number(template.report_project_family_id) === Number(group.id));
            const children = matchedChildren.map((template,index) => ({
              ...template, _family_first: index === 0, _family_last: index === matchedChildren.length - 1,
            }));
            const directMatch = !!keyword && [group.name, group.description, group.host_manufacturer_name]
              .some(value => String(value || '').toLowerCase().includes(keyword));
            const showEmpty = filter === 'all' && !hasStructuredSearch && (!keyword || directMatch);
            if (!children.length && !showEmpty) return [];
            const childTimes = children.map(template => activityTs(template));
            const groupTime = new Date(group.updated_at || 0).getTime();
            return [{
              ...group, id: reportGroupRowKey(group.id), family_id: Number(group.id),
              _row_type: 'report_group', method_count: group.templates?.length || 0,
              visible_method_count: children.length,
              last_activity: new Date(Math.max(Number.isFinite(groupTime) ? groupTime : 0, ...childTimes)).toISOString(),
              children,
            }];
          }),
          ...(filter === 'all'
            ? buildTemplateTree(visibleTemplates.filter(template => !groupedTemplateIds.has(Number(template.id))))
            : visibleTemplates.filter(template => !groupedTemplateIds.has(Number(template.id)))),
        ].sort((a,b) => new Date(b.last_activity || b.updated_at).getTime()-new Date(a.last_activity || a.updated_at).getTime());
    return (
    <Table
      className="compact-template-list"
      dataSource={tableRows}
      rowKey={(row) => isReportGroupRow(row) ? reportGroupRowKey(row.family_id!) : row.id}
      loading={loading}
      size="small"
      tableLayout="fixed"
      // 项目模板的关联与操作列较多；横向滚动时固定 ID / 名称，始终保留对照基准。
      // 关联原始记录、主机厂使用固定列宽；长名称在单元格内部横向滚动，不再撑开表格。
      // 首页在“待审核 / 我的草稿”视图还会出现母模板列，宽度也须覆盖该列，防止状态列被压缩错位。
      scroll={{ x: kind === 'project' ? 1780 : 1400 }}
      rowClassName={(row) => isReportGroupRow(row)
        ? 'clickable-detail-row template-family-row report-project-group-row'
        : row.report_project_family_id
          ? `clickable-detail-row template-family-member-row${row._family_first ? ' template-family-member-first' : ''}${row._family_last ? ' template-family-member-last' : ''}`
          : 'clickable-detail-row'}
      onRow={(row) => ({
        onClick: (event) => {
          if (isInteractiveRowTarget(event.target)) return;
          if (isReportGroupRow(row)) {
            const key = reportGroupRowKey(row.family_id!);
            setExpandedKeys(keys => keys.includes(key) ? keys.filter(item => item !== key) : [...keys,key]);
            return;
          }
          if (!row.archive_requested_by && row.open_draft?.status !== 'pending') openTemplate(row);
        },
      })}
      pagination={pagination}
      expandable={filter === 'all' || groupsForKind.length > 0 ? {
        expandedRowKeys: expandedKeys,
        onExpandedRowsChange: setExpandedKeys,
        rowExpandable: (row) => !!row.children?.length,
      } : undefined}
      columns={[
        {
          title: 'ID', width: COL_WIDTH.id, fixed: 'left' as const, align: 'center' as const,
          render: (_: any, r: ReportTemplate) => isReportGroupRow(r)
            ? <span className="template-family-kind"><ApartmentOutlined /> 项目组</span>
            : <span style={{ color: '#888', whiteSpace: 'nowrap' }}>#{r.id}</span>,
        },
        {
          title: '名称', dataIndex: 'name', width: COL_WIDTH.name, fixed: 'left' as const, ellipsis: true, align: 'left' as const,
          render: (v: string, r: ReportTemplate) => isReportGroupRow(r) ? (
            <div className="template-family-heading">
              <div><span className="template-family-heading-icon"><ApartmentOutlined /></span><b>{v}</b></div>
              <div className="template-family-heading-meta">
                <b>{r.visible_method_count === r.method_count ? `${r.method_count} 个模板` : `${r.visible_method_count}/${r.method_count} 个模板`}</b>
                {r.description ? ` · ${r.description}` : ' · 点击整行展开或收起'}
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
          render: (_: any, r: ReportTemplate) => isReportGroupRow(r)
            ? <span style={{color:'#98a2b3'}}>—</span>
            : <Tag color="green" style={{ margin: 0 }}>v{r.current_version_no ?? '?'}</Tag>,
        },
        {
          title: '状态', width: COL_WIDTH.status, align: 'center' as const, className: 'template-status-cell',
          render: (_: any, r: any) => isReportGroupRow(r) ? (
            <Space size={2} wrap={false}>
              <Tag color={r.enabled === false ? 'default' : 'green'}>{r.enabled === false ? '已停用' : '使用中'}</Tag>
              {r.archive_requested_by && <Tooltip title={`${r.archive_requested_by} 申请删除，等待审核`}><Tag color="red">删除待审</Tag></Tooltip>}
            </Space>
          ) : (
            <div className="template-reference-scroll template-reference-centered template-status-scroll">
            <Space size={2} wrap={false}>
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
            </div>
          ),
        },
        // 过滤视图是平铺的，母模板列帮助定位；树形视图下母子关系已可见
        ...(filter !== 'all' ? [{
          title: '母模板', width: COL_WIDTH.parent, align: 'center' as const,
          render: (_: any, r: ReportTemplate) => {
            if (isReportGroupRow(r)) return <span style={{ color: '#aaa' }}>—</span>;
            if (!r.parent_template_id) return <span style={{ color: '#aaa' }}>—</span>;
            const parent = rows.find(t => t.id === r.parent_template_id);
            return (
              <a onClick={(e) => {
                e.preventDefault();
                const p = parent || templates.find(t => t.id === r.parent_template_id);
                if (p) openTemplate(p);
              }}>
                <Tag color="orange" style={{ cursor: 'pointer' }}>
                  #{r.parent_template_id} {parent ? parent.name : '已删除'}
                </Tag>
              </a>
            );
          },
        }] : []),
        ...(kind === 'project' ? [{
          title: '关联原始记录',
          dataIndex: 'linked_record_template_id',
          width: COL_WIDTH.linked,
          align: 'left' as const,
          className: 'template-reference-cell',
          render: (id: number | null, row: ReportTemplate) => {
            if (isReportGroupRow(row)) return <span style={{color:'#98a2b3'}}>—</span>;
            const rt = id ? recordTemplates.find(t => t.id === id) : null;
            const linkedName = rt?.name || row.linked_record_template_name;
            const label = !id ? '未关联' : linkedName || `无效引用（ID：${id}）`;
            const canChange = canEditTemplates;
            return (
              <div className="template-reference-scroll">
                <Tooltip title={canChange ? `点击修改关联原始记录：${label}` : label}>
                  {canChange ? <button type="button" className={`template-reference-link${!id ? ' is-empty' : ''}`}
                    onClick={() => { setLinkingRow(row); setLinkingId(id ?? undefined); }}>
                    {label}
                  </button> : <span className={!id ? 'template-reference-empty' : undefined}>{label}</span>}
                </Tooltip>
              </div>
            );
          },
        }] : []),
        {
          key: 'manufacturer', title: '主机厂', width: COL_WIDTH.manufacturer, align: 'center' as const,
          className: 'template-manufacturer-cell template-reference-cell',
          sorter: filter === 'all' ? undefined : (a: ReportTemplate, b: ReportTemplate) => (a.host_manufacturer_name || '').localeCompare(b.host_manufacturer_name || ''),
          render: (_: any, r: ReportTemplate) => {
            if (isReportGroupRow(r)) return <div className="template-reference-scroll template-reference-centered">
              <span className={r.host_manufacturer_name ? 'template-reference-readonly' : 'template-reference-empty'}>
                {r.host_manufacturer_name || '未设置主机厂'}
              </span>
            </div>;
            const label = r.host_manufacturer_name || '未关联';
            const detail = [r.host_manufacturer_name, r.host_manufacturer_category].filter(Boolean).join(' · ') || label;
            const canChange = canEditTemplates;
            return <div className="template-reference-scroll template-reference-centered">
              <Tooltip title={canChange ? `点击修改主机厂：${detail}` : detail}>
                {canChange ? <button type="button" className={`template-reference-link${!r.host_manufacturer_name ? ' is-empty' : ''}`}
                  onClick={() => { setManufacturerLinkingRow(r); setManufacturerLinkingId(r.host_manufacturer_id ?? undefined); }}>
                  {label}
                </button> : <span className={!r.host_manufacturer_name ? 'template-reference-empty' : undefined}>{label}</span>}
              </Tooltip>
            </div>;
          },
        },
        {
          title: '最近修改时间', width: COL_WIDTH.modified, align: 'center' as const,
          sorter: filter === 'all' ? undefined : (a: ReportTemplate, b: ReportTemplate) => activityTs(a) - activityTs(b),
          render: (_: any, r: ReportTemplate) => (
            <span style={{ fontSize: 12, color: '#5b6675', whiteSpace: 'nowrap' }}>
              {dayjs(r.last_activity || r.updated_at).format('YYYY-MM-DD HH:mm')}
            </span>
          ),
        },
        {
          title: '版本管理', width: COL_WIDTH.history, align: 'center' as const,
          render: (_: any, row: ReportTemplate) => isReportGroupRow(row) ? <span style={{color:'#98a2b3'}}>—</span> : (
            <TemplateVersionPanel
              kind="report" templateId={row.id} templateName={row.name}
              currentVersionNo={row.current_version_no} openDraft={row.open_draft}
              onRefresh={load} actionsOnly iconOnly buttons={['history']}
              editorPathBase={row.template_kind === 'project' ? '/report-templates/project/editor' : '/report-templates/cover/editor'}
            />
          ),
        },
        {
          title: '关联关系', width: COL_WIDTH.lineage, align: 'center' as const,
          render: (_: any, row: ReportTemplate) => isReportGroupRow(row) ? <span style={{color:'#98a2b3'}}>—</span> : (
            <TemplateVersionPanel
              kind="report" templateId={row.id} templateName={row.name}
              currentVersionNo={row.current_version_no} openDraft={row.open_draft}
              onRefresh={load} actionsOnly iconOnly buttons={['lineage']}
              editorPathBase={row.template_kind === 'project' ? '/report-templates/project/editor' : '/report-templates/cover/editor'}
            />
          ),
        },
        {
          title: '内容操作', width: COL_WIDTH.contentActions, fixed: 'right' as const, align: 'center' as const,
          render: (_: any, row: ReportTemplate) => {
            if (isReportGroupRow(row)) return <Space size={4} className="table-row-actions">
              <Tooltip title="只管理当前项目组"><Button size="small" icon={<ApartmentOutlined />} onClick={() => {
                setManagedReportGroupKind((row as any).template_kind); setManagedReportGroupId(Number(row.family_id)); setFamilyManagerOpen(true);
              }}/></Tooltip>
              <Tooltip title={`在当前项目组中新建${kind === 'project' ? '项目模板' : '首页模板'}`}><Button size="small" type="primary" ghost icon={<PlusOutlined />}
                disabled={!canEditTemplates} onClick={() => openCreate(kind === 'project' ? 'project' : 'cover',row as any)}/></Tooltip>
            </Space>;
            const editorBase = row.template_kind === 'project' ? '/report-templates/project/editor' : '/report-templates/cover/editor';
            const locked = !!row.archive_requested_by || row.open_draft?.status === 'pending';
            return (
              <Space size={4} className="table-row-actions">
                <TemplateVersionPanel
                  kind="report" templateId={row.id} templateName={row.name}
                  currentVersionNo={row.current_version_no} openDraft={row.open_draft}
                  onRefresh={load} actionsOnly iconOnly buttons={row.report_project_family_id ? [] : ['fork']} editorPathBase={editorBase} disabled={locked}
                />
                <Tooltip title={canEditTemplates ? '编辑' : '预览'}>
                  <Button size="small" disabled={locked} icon={canEditTemplates ? <EditOutlined /> : <EyeOutlined />} onClick={() => openTemplate(row)} />
                </Tooltip>
                <PdfDownloadButton title="下载该报告模板渲染 PDF（示例数据结构预览）"
                  disabled={locked} onDownload={() => downloadReportTemplatePdf(row.id, row.name || '报告模板')} />
              </Space>
            );
          },
        },
        {
          title: '流程操作', width: COL_WIDTH.workflow, fixed: 'right' as const, align: 'center' as const,
          render: (_: any, row: ReportTemplate) => {
            if (isReportGroupRow(row)) return <TestTemplateGroupArchiveActions kind="report" group={row as any} onRefresh={load}/>;
            const editorBase = row.template_kind === 'project' ? '/report-templates/project/editor' : '/report-templates/cover/editor';
            return (
              <Space size={4} className="table-row-actions table-workflow-actions">
                {row.archive_requested_by ? <TemplateArchiveButton kind="report" row={row as any} onRefresh={load} fixedWorkflow /> : <>
                <TemplateVersionPanel
                  kind="report" templateId={row.id} templateName={row.name}
                  currentVersionNo={row.current_version_no} openDraft={row.open_draft}
                  onRefresh={load} actionsOnly iconOnly buttons={['submit']} editorPathBase={editorBase}
                />
                <TemplateArchiveButton kind="report" row={row as any} onRefresh={load}
                  disabled={row.open_draft?.status === 'pending'}
                  disabledReason="模板版本正在审核中，请先完成审核或撤回后再申请删除" />
                </>}
              </Space>
            );
          },
        },
      ]}
    />
    );
  };

  return (
    <div style={{ padding: 24 }}>
      <PageHeader
        title="报告模板"
        subtitle="首页模板（结论汇总）与项目模板；可从零创建，也可复制已有同类模板的内容后继续修改。"
        extra={
          <Tooltip title={canEditTemplates ? '维护主机厂库' : '当前账号无模板编辑权限'}>
            <Button icon={<DatabaseOutlined />} disabled={!canEditTemplates} onClick={() => {
              setEditingFactory(null); setFactoryEditorOpen(false); factoryForm.resetFields(); setFactoryOpen(true);
            }}>主机厂库</Button>
          </Tooltip>
        }
      />

      <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Segmented
          value={filter}
          onChange={(v) => setFilter(v as TemplateListFilter)}
          options={[
            { label: '全部', value: 'all' },
            { label: `待审核（${templates.filter(t => t.open_draft?.status === 'pending').length}）`, value: 'pending' },
            {
              label: `我的草稿（${templates.filter(t =>
                t.open_draft && (t.open_draft.status === 'draft' || t.open_draft.status === 'rejected')
                && t.open_draft.author_name === user?.display_name).length}）`,
              value: 'mine',
            },
          ]}
        />
        <TemplateSearchBar value={search} onChange={setSearch} mergePeopleIntoKeyword includeLinkedRecordInKeyword />
        <Select allowClear showSearch optionFilterProp="label" value={hostFilter} onChange={setHostFilter}
          placeholder="按主机厂筛选" style={{ width: 170 }} options={manufacturers.map(m => ({ value: m.id, label: `${m.name}${m.category ? ` · ${m.category}` : ''}` }))} />
      </div>

      <Tabs
        activeKey={activeTab}
        onChange={(k) => setSearchParams(k === 'project' ? { tab: 'project' } : {}, { replace: true })}
        items={[
          {
            key: 'cover',
            label: <span><FileDoneOutlined /> 首页模板（{covers.length}）</span>,
            children: (
              <>
                <Space style={{ marginBottom: 12 }}>
                  <Tooltip title={canEditTemplates ? '新建首页模板' : '当前账号无模板编辑权限'}>
                    <Button type="primary" icon={<PlusOutlined />} disabled={!canEditTemplates}
                      onClick={() => openCreate('cover')}>新建首页模板</Button>
                  </Tooltip>
                  <Button icon={<ApartmentOutlined />} disabled={!canEditTemplates} onClick={() => {
                    setManagedReportGroupKind('cover'); setManagedReportGroupId(null); setFamilyManagerOpen(true);
                  }}>管理项目组</Button>
                </Space>
                {renderTable(covers, 'cover')}
              </>
            ),
          },
          {
            key: 'project',
            label: <span><FileTextOutlined /> 项目模板（{projects.length}）</span>,
            children: (
              <>
                <Space style={{ marginBottom: 12 }}>
                  <Tooltip title={canEditTemplates ? '新建项目模板' : '当前账号无模板编辑权限'}>
                    <Button type="primary" icon={<PlusOutlined />} disabled={!canEditTemplates}
                      onClick={() => openCreate('project')}>新建项目模板</Button>
                  </Tooltip>
                  <Button icon={<ApartmentOutlined />} disabled={!canEditTemplates} onClick={()=>{
                    setManagedReportGroupKind('project'); setManagedReportGroupId(null); setFamilyManagerOpen(true);
                  }}>管理项目组</Button>
                </Space>
                {renderTable(projects, 'project')}
              </>
            ),
          },
        ]}
      />

      <Modal
        title={createOpen === 'project' ? '新建项目模板' : '新建首页模板'}
        open={!!createOpen}
        onCancel={() => { setCreateOpen(false); setCreateReportGroup(null); form.resetFields(); }}
        onOk={handleCreate}
        confirmLoading={creating}
        destroyOnClose
        okText="创建并查看"
      >
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item name="name" label="模板名称" rules={[{ required: true, message: '请输入名称' }]}>
            <Input placeholder={createOpen === 'project' ? '如：密度试验项目报告' : '如：检测报告标准首页'} />
          </Form.Item>
          {createReportGroup && <Alert type="info" showIcon style={{marginBottom:12}}
            message={`新模板将加入项目组“${createReportGroup.name}”`} />}
          <Form.Item name="host_manufacturer_id" label="主机厂（可不选）">
            <Space.Compact style={{ width: '100%' }}>
              <Select allowClear showSearch optionFilterProp="label" placeholder="选择主机厂" style={{ width: '100%' }}
                options={manufacturers.map(m => ({ value: m.id, label: `${m.name}${m.category ? ` · ${m.category}` : ''}` }))} />
              <Button onClick={() => { setEditingFactory(null); factoryForm.resetFields(); setFactoryEditorOpen(true); setFactoryOpen(true); }}>新建</Button>
            </Space.Compact>
          </Form.Item>
          {createOpen === 'project' && (
            <Form.Item name="linked_record_template_id" label="关联的原始记录模板"
              rules={[{ required: true, message: '请选择原始记录模板' }]}
              extra="项目报告会从这个原始记录模板取数；之后所有数据绑定都基于此模板的字段集">
              <Select
                showSearch
                optionFilterProp="label"
                placeholder="选择原始记录模板"
                options={recordTemplates.map(t => ({ value: t.id, label: recordTemplateOptionLabel(t) }))}
              />
            </Form.Item>
          )}
          {createOpen === 'project' ? (
            <div style={{ margin: '0 0 8px', padding: '10px 12px', borderRadius: 7, background: '#f0f7ff', color: '#2f5fa7', fontSize: 12, lineHeight: 1.7 }}>
              创建时将直接从关联原始记录生成字段并配置映射，包括普通字段、原始记录表格、试样动态行和图片来源；进入后即可查看，取得编辑权后可调整。
            </div>
          ) : (
            <Form.Item name="skeleton" label="选择创建方式" initialValue="blank"
              extra="可以从零开始，也可以复制一份同类模板的全部内容，再在新副本上修改">
              <Select showSearch optionFilterProp="label" placeholder="搜索模板名…"
                options={[
                  { value: 'blank', label: '从零创建（空白模板）' },
                  ...templates.filter(t => (t.template_kind || 'cover') === createOpen)
                    .map(t => ({ value: t.id, label: `复制「${t.name}」的内容后创建（当前 v${t.current_version_no || t.version || '?'}）` })),
                ]} />
            </Form.Item>
          )}
        </Form>
      </Modal>
      <ReportProjectFamilyManagerModal open={familyManagerOpen} kind={managedReportGroupKind} groupId={managedReportGroupId}
        onClose={()=>setFamilyManagerOpen(false)} onChanged={load}
        onCreateTemplate={(group) => { setFamilyManagerOpen(false); openCreate(managedReportGroupKind,group); }}/>

      <Modal title="主机厂库" open={factoryOpen}
        onCancel={() => { setFactoryOpen(false); setEditingFactory(null); setFactoryEditorOpen(false); }} footer={null} width={820} destroyOnClose>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'center', marginBottom: 18 }}>
          <div>
            <div style={{ fontSize: 13, color: '#596579' }}>维护报告模板使用的主机厂，可按名称、类别或简称快速查找。</div>
            <div style={{ fontSize: 12, color: '#9aa4b2', marginTop: 4 }}>名称全库唯一；删除后不影响历史模板显示。</div>
          </div>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => { setEditingFactory(null); factoryForm.resetFields(); setFactoryEditorOpen(true); }}>新增主机厂</Button>
        </div>
        {factoryEditorOpen && (
          <div style={{ border: '1px solid #dbe7fb', background: '#f7faff', borderRadius: 10, padding: '16px 16px 4px', marginBottom: 16 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#2f5fa7', marginBottom: 12 }}>{editingFactory ? '修改主机厂' : '新增主机厂'}</div>
            <Form form={factoryForm} layout="vertical" initialValues={editingFactory || undefined}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 14px' }}>
                <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入名称' }]}><Input placeholder="例如：上汽大众" /></Form.Item>
                <Form.Item name="category" label="类别"><Input placeholder="例如：乘用车、商用车" /></Form.Item>
                <Form.Item name="short_name" label="简称"><Input placeholder="例如：上汽大众" /></Form.Item>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: -4, marginBottom: 12 }}>
                <Button onClick={() => { setEditingFactory(null); factoryForm.resetFields(); setFactoryEditorOpen(false); }}>取消</Button>
                <Button type="primary" loading={factorySaving} onClick={async () => {
            try {
              const values = await factoryForm.validateFields(); setFactorySaving(true);
              const res = editingFactory ? await axios.put(`${API}/host-manufacturers/${editingFactory.id}`, values) : await axios.post(`${API}/host-manufacturers`, values);
              setManufacturers(prev => editingFactory ? prev.map(x => x.id === editingFactory.id ? res.data : x) : [...prev, res.data].sort((a, b) => a.name.localeCompare(b.name)));
              form.setFieldValue('host_manufacturer_id', res.data.id); message.success(editingFactory ? '已修改' : '已新增');
              setEditingFactory(null); factoryForm.resetFields(); setFactoryEditorOpen(false);
            } catch (e: any) { message.error(e.response?.data?.error || '保存失败'); } finally { setFactorySaving(false); }
                }}>{editingFactory ? '保存修改' : '确认新增'}</Button>
              </div>
            </Form>
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <span style={{ fontWeight: 600, color: '#344054' }}>已有主机厂 <span style={{ fontWeight: 400, color: '#98a2b3' }}>（{manufacturers.length}）</span></span>
          <Input allowClear value={factorySearch} onChange={e => setFactorySearch(e.target.value)} placeholder="搜索名称、类别或简称" style={{ width: 280 }} />
        </div>
        <Table size="small" rowKey="id" pagination={{ pageSize: 6, showSizeChanger: false }} scroll={{ y: 260 }} dataSource={manufacturers.filter(row => {
          const q = factorySearch.trim().toLowerCase();
          return !q || [row.name, row.category, row.short_name].some(v => String(v || '').toLowerCase().includes(q));
        })} columns={[
          { title: '名称', dataIndex: 'name' }, { title: '类别', dataIndex: 'category', render: (v: string) => v || '—' },
          { title: '简称', dataIndex: 'short_name', render: (v: string) => v || '—' },
          { title: '操作', width: 130, render: (_: any, row: HostManufacturer) => <Space><Button type="link" size="small" onClick={() => { setEditingFactory(row); factoryForm.setFieldsValue(row); setFactoryEditorOpen(true); }}>修改</Button><Popconfirm title="删除后不再可新选，历史模板仍保留显示。确认删除？" onConfirm={async () => { try { await axios.delete(`${API}/host-manufacturers/${row.id}`); setManufacturers(prev => prev.filter(x => x.id !== row.id)); message.success('已删除'); } catch (e: any) { message.error(e.response?.data?.error || '删除失败'); } }}><Button danger type="link" size="small">删除</Button></Popconfirm></Space> },
        ]} />
      </Modal>

      <Modal
        title="修改关联的原始记录模板"
        open={!!linkingRow}
        onCancel={() => setLinkingRow(null)}
        onOk={handleLinkSave}
        okText="保存"
        destroyOnClose
      >
        <p style={{ color: '#888', fontSize: 12 }}>
          注意：修改关联后，原来连接到旧记录的数据项可能失效，需要在编辑器中重新选择对应数据。
        </p>
        <Select
          showSearch
          optionFilterProp="label"
          placeholder="选择新的原始记录模板"
          style={{ width: '100%' }}
          value={linkingId}
          onChange={setLinkingId}
          options={[
            { value: undefined as any, label: '— 取消关联 —' },
            ...recordTemplates.map(t => ({ value: t.id, label: recordTemplateOptionLabel(t) })),
          ]}
        />
      </Modal>
      <Modal
        title="修改主机厂关联"
        open={!!manufacturerLinkingRow}
        onCancel={() => setManufacturerLinkingRow(null)}
        onOk={handleManufacturerLinkSave}
        okText="保存"
        destroyOnClose
      >
        <Select
          allowClear showSearch optionFilterProp="label"
          placeholder="选择主机厂（留空则取消关联）"
          style={{ width: '100%' }}
          value={manufacturerLinkingId}
          onChange={setManufacturerLinkingId}
          options={manufacturers.map(m => ({ value: m.id, label: `${m.name}${m.category ? ` · ${m.category}` : ''}` }))}
        />
      </Modal>
      {previewTemplate && (
        <TemplatePdfPreviewModal
          open
          kind="report"
          templateId={previewTemplate.id}
          templateName={previewTemplate.name}
          onClose={() => setPreviewTemplate(null)}
        />
      )}
    </div>
  );
}
