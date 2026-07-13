import { useState, useEffect, type Key } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Table, Button, message, Modal, Form, Input, Select, Tabs, Tag, Space, Segmented, Tooltip } from 'antd';
import { EditOutlined, PlusOutlined, FileDoneOutlined, FileTextOutlined, LinkOutlined } from '@ant-design/icons';
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

const STATUS_COLOR: Record<string, string> = { draft: 'default', pending: 'orange', rejected: 'red' };
const STATUS_LABEL: Record<string, string> = { draft: '草稿', pending: '待审核', rejected: '已退回' };

/**
 * ▼▼ 列宽配置（单位 px，按需直接改数字）▼▼
 * 名称列也是固定宽（超出省略号悬停看全名）。所有列宽之和小于表格容器时，
 * 浏览器会按比例拉伸各列——想让某列吃掉更多剩余空间就把它的数字调大。
 */
const COL_WIDTH = {
  id: 56,          // ID
  name: 260,       // 名称
  version: 58,     // 版本
  status: 120,     // 状态
  parent: 160,     // 母模板（仅"待审核/我的草稿"平铺视图显示）
  linked: 240,     // 关联原始记录（仅项目模板 Tab）
  modified: 150,   // 最近修改时间
  history: 100,     // 版本管理
  lineage: 100,     // 关联关系
  actions: 200,    // 操作（+子模板/编辑/提交审核|审核|撤回/删除审批）
};

const API = '/api';

interface ReportTemplate {
  id: number;
  name: string;
  version: number;
  template_kind: 'cover' | 'project' | 'cover_page';
  test_project_codes?: string[];
  linked_record_template_id?: number;
  layout_options?: Record<string, any>;
  updated_at: string;
  last_activity?: string;
  current_version_no?: number;
  open_draft?: any;
  parent_template_id?: number | null;
  children?: ReportTemplate[];
}

interface RecordTemplateRef { id: number; name: string; version: number; }

export default function ReportTemplateList() {
  const navigate = useNavigate();
  // 当前 tab 入 URL（?tab=cover|project）：从编辑器「返回」时带回进入时所在的 tab（从哪进回哪）
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') === 'project' ? 'project' : 'cover';
  const { user } = useAuth();
  const [filter, setFilter] = useState<TemplateListFilter>('all');
  const [search, setSearch] = useState<TemplateSearchCriteria>({});
  const [expandedKeys, setExpandedKeys] = useState<readonly Key[]>([]);
  const [templates, setTemplates] = useState<ReportTemplate[]>([]);
  const [recordTemplates, setRecordTemplates] = useState<RecordTemplateRef[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState<false | 'cover' | 'project' | 'cover_page'>(false);
  const [creating, setCreating] = useState(false);
  const [form] = Form.useForm();
  const [linkingRow, setLinkingRow] = useState<ReportTemplate | null>(null);
  const [linkingId, setLinkingId] = useState<number | undefined>();

  const load = () => {
    setLoading(true);
    axios.get(`${API}/report-templates`)
      .then(res => {
        setTemplates(res.data);
        setExpandedKeys(parentRowKeys(buildTemplateTree(res.data)));   // 默认展开全部母子分组
      })
      .catch(() => message.error('加载失败'))
      .finally(() => setLoading(false));
    axios.get(`${API}/record-templates`)
      .then(res => setRecordTemplates(res.data))
      .catch(() => {});
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
      if (createOpen === 'project') {
        payload.linked_record_template_id = values.linked_record_template_id;
        // 项目模板默认字体＝仿宋_GB2312（无粗体字体，加粗走 faux-bold 描边）
        payload.layout_options = { ...payload.layout_options, theme_config: { font: 'FangSong_GB2312' } };
      }
      // 以现有模板为骨架：复制其内容（groups + 版式）到新模板
      if (values.skeleton && values.skeleton !== 'blank') {
        const src = (await axios.get(`${API}/report-templates/${values.skeleton}`)).data;
        payload.field_definitions = src.field_definitions || [];
        payload.layout_options = src.layout_options || payload.layout_options;
        if (createOpen === 'project' && !payload.linked_record_template_id) {
          payload.linked_record_template_id = src.linked_record_template_id;
        }
      }
      const res = await axios.post(`${API}/report-templates`, payload);
      message.success('创建成功');
      setCreateOpen(false);
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

  const covers = templates.filter(t => (t.template_kind || 'cover') === 'cover');
  const projects = templates.filter(t => t.template_kind === 'project');

  // 高级搜索先过滤，再走视图：全部 = 树形分组（同 Tab 内母子嵌套，按子树最近修改排序）；过滤视图 = 平铺
  const renderTable = (allRows: ReportTemplate[], kind: 'cover' | 'project' | 'cover_page') => {
    const rows = applyTemplateSearch(allRows, search);
    return (
    <Table
      dataSource={filter === 'all' ? buildTemplateTree(rows) : filterTemplateRows(rows, filter, user?.display_name)}
      rowKey="id"
      loading={loading}
      pagination={{ pageSize: 20 }}
      expandable={filter === 'all' ? {
        expandedRowKeys: expandedKeys,
        onExpandedRowsChange: setExpandedKeys,
      } : undefined}
      columns={[
        {
          title: 'ID', width: COL_WIDTH.id,
          render: (_: any, r: ReportTemplate) => <span style={{ color: '#888' }}>#{r.id}</span>,
        },
        {
          title: '名称', dataIndex: 'name', width: COL_WIDTH.name, ellipsis: true,
          render: (v: string, r: ReportTemplate) => (
            <span>
              {v}
              {r.parent_template_id && <Tag color="orange" style={{ marginLeft: 6, fontSize: 11 }}>子模板</Tag>}
            </span>
          ),
        },
        {
          title: '版本', width: COL_WIDTH.version,
          render: (_: any, r: ReportTemplate) => <Tag color="green">v{r.current_version_no ?? '?'}</Tag>,
        },
        {
          title: '状态', width: COL_WIDTH.status,
          render: (_: any, r: any) => (
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
          title: '母模板', width: COL_WIDTH.parent,
          render: (_: any, r: ReportTemplate) => {
            if (!r.parent_template_id) return <span style={{ color: '#aaa' }}>—</span>;
            const parent = rows.find(t => t.id === r.parent_template_id);
            return (
              <a onClick={(e) => {
                e.preventDefault();
                const p = parent || templates.find(t => t.id === r.parent_template_id);
                if (p?.template_kind === 'project') navigate(`/report-templates/project/editor?id=${r.parent_template_id}`);
                else navigate(`/report-templates/cover/editor?id=${r.parent_template_id}`);
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
          render: (id: number | null, row: ReportTemplate) => {
            const rt = id ? recordTemplates.find(t => t.id === id) : null;
            return (
              <Space>
                {!id && <Tag color="warning">未关联</Tag>}
                {id && rt && <Tag color="blue">{rt.name}</Tag>}
                {id && !rt && <Tag color="red">无效引用 (id={id})</Tag>}
                <Button size="small" type="link" icon={<LinkOutlined />}
                  onClick={() => { setLinkingRow(row); setLinkingId(id ?? undefined); }}>
                  修改
                </Button>
              </Space>
            );
          },
        }] : []),
        {
          title: '最近修改时间', width: COL_WIDTH.modified,
          sorter: filter === 'all' ? undefined : (a: ReportTemplate, b: ReportTemplate) => activityTs(a) - activityTs(b),
          render: (_: any, r: ReportTemplate) => (
            <span style={{ fontSize: 12, color: '#5b6675', whiteSpace: 'nowrap' }}>
              {dayjs(r.last_activity || r.updated_at).format('YYYY-MM-DD HH:mm')}
            </span>
          ),
        },
        {
          title: '版本管理', width: COL_WIDTH.history, align: 'center' as const,
          render: (_: any, row: ReportTemplate) => (
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
          render: (_: any, row: ReportTemplate) => (
            <TemplateVersionPanel
              kind="report" templateId={row.id} templateName={row.name}
              currentVersionNo={row.current_version_no} openDraft={row.open_draft}
              onRefresh={load} actionsOnly iconOnly buttons={['lineage']}
              editorPathBase={row.template_kind === 'project' ? '/report-templates/project/editor' : '/report-templates/cover/editor'}
            />
          ),
        },
        {
          title: '操作', width: COL_WIDTH.actions,
          render: (_: any, row: ReportTemplate) => {
            const editorBase = row.template_kind === 'project' ? '/report-templates/project/editor' : '/report-templates/cover/editor';
            return (
              <Space size={4} style={{ whiteSpace: 'nowrap' }}>
                <TemplateVersionPanel
                  kind="report" templateId={row.id} templateName={row.name}
                  currentVersionNo={row.current_version_no} openDraft={row.open_draft}
                  onRefresh={load} actionsOnly iconOnly buttons={['fork']} editorPathBase={editorBase}
                />
                <Tooltip title="编辑">
                  <Button size="small" icon={<EditOutlined />} onClick={() => navigate(`${editorBase}?id=${row.id}`)} />
                </Tooltip>
                <PdfDownloadButton title="下载该报告模板渲染 PDF（示例数据结构预览）"
                  onDownload={() => downloadReportTemplatePdf(row.id, row.name || '报告模板')} />
                <TemplateVersionPanel
                  kind="report" templateId={row.id} templateName={row.name}
                  currentVersionNo={row.current_version_no} openDraft={row.open_draft}
                  onRefresh={load} actionsOnly iconOnly buttons={['submit']} editorPathBase={editorBase}
                />
                <TemplateArchiveButton kind="report" row={row as any} onRefresh={load} />
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
        subtitle="封面 / 首页(结论汇总) / 项目报告 三类模板；在各类下「新建」，可空白或以现有模板为骨架。"
      />

      <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
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
        <TemplateSearchBar value={search} onChange={setSearch} />
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
                <Button type="primary" icon={<PlusOutlined />} style={{ marginBottom: 12 }} onClick={() => setCreateOpen('cover')}>新建首页模板</Button>
                {renderTable(covers, 'cover')}
              </>
            ),
          },
          {
            key: 'project',
            label: <span><FileTextOutlined /> 项目模板（{projects.length}）</span>,
            children: (
              <>
                <Button type="primary" icon={<PlusOutlined />} style={{ marginBottom: 12 }} onClick={() => setCreateOpen('project')}>新建项目模板</Button>
                {renderTable(projects, 'project')}
              </>
            ),
          },
        ]}
      />

      <Modal
        title={createOpen === 'project' ? '新建项目模板' : '新建首页模板'}
        open={!!createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={handleCreate}
        confirmLoading={creating}
        destroyOnClose
        okText="创建并开始编辑"
      >
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item name="name" label="模板名称" rules={[{ required: true, message: '请输入名称' }]}>
            <Input placeholder={createOpen === 'project' ? '如：密度试验项目报告' : '如：检测报告标准首页'} />
          </Form.Item>
          <Form.Item name="skeleton" label="以现有模板为骨架" initialValue="blank"
            extra="选「空白」从零开始；或搜索一个同类现有模板，复制其内容到新模板后再编辑">
            <Select showSearch optionFilterProp="label" placeholder="搜索模板名…"
              options={[
                { value: 'blank', label: '空白模板（从零开始）' },
                ...templates.filter(t => (t.template_kind || 'cover') === createOpen)
                  .map(t => ({ value: t.id, label: `以「${t.name}」为骨架 (v${t.version})` })),
              ]} />
          </Form.Item>
          {createOpen === 'project' && (
            <Form.Item name="linked_record_template_id" label="关联的原始记录模板"
              rules={[{ required: true, message: '请选择原始记录模板' }]}
              extra="项目报告会从这个原始记录模板取数；之后所有数据绑定都基于此模板的字段集">
              <Select
                showSearch
                optionFilterProp="label"
                placeholder="选择原始记录模板"
                options={recordTemplates.map(t => ({ value: t.id, label: `${t.name} (v${t.version})` }))}
              />
            </Form.Item>
          )}
        </Form>
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
          ⚠️ 注意：修改关联后，已配置的字段绑定（指向旧记录的 field_code / matrix_code）可能失效，需要在编辑器里重新绑定。
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
            ...recordTemplates.map(t => ({ value: t.id, label: `${t.name} (v${t.version})` })),
          ]}
        />
      </Modal>
    </div>
  );
}

