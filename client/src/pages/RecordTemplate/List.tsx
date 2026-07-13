import { useState, useEffect, useMemo, type Key } from 'react';
import { useNavigate } from 'react-router-dom';
import { Table, Button, Space, message, Modal, Tag, Select, Segmented, Tooltip } from 'antd';
import { PlusOutlined, EditOutlined } from '@ant-design/icons';
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

const STATUS_COLOR: Record<string, string> = { draft: 'default', pending: 'orange', rejected: 'red' };
const STATUS_LABEL: Record<string, string> = { draft: '草稿', pending: '待审核', rejected: '已退回' };

/**
 * ▼▼ 列宽配置（单位 px，按需直接改数字）▼▼
 * 名称列也是固定宽（超出省略号悬停看全名）。所有列宽之和小于表格容器时，
 * 浏览器会按比例拉伸各列——想让某列吃掉更多剩余空间就把它的数字调大。
 */
const COL_WIDTH = {
  id: 56,          // ID
  name: 240,       // 名称
  version: 58,     // 版本
  status: 120,     // 状态
  parent: 130,     // 母模板（仅"待审核/我的草稿"平铺视图显示）
  modified: 136,   // 最近修改时间
  history: 76,     // 版本管理
  lineage: 76,     // 关联关系
  actions: 200,    // 操作（+子模板/编辑/提交审核|审核|撤回/删除审批）
};

const API = '/api';

export default function RecordTemplateList() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [templates, setTemplates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<TemplateListFilter>('all');
  const [search, setSearch] = useState<TemplateSearchCriteria>({});
  const [expandedKeys, setExpandedKeys] = useState<readonly Key[]>([]);

  const load = () => {
    setLoading(true);
    axios.get(`${API}/record-templates`)
      .then(res => {
        setTemplates(res.data);
        setExpandedKeys(parentRowKeys(buildTemplateTree(res.data)));   // 默认展开全部母子分组
      })
      .catch(() => message.error('加载失败'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  // "新建模板"：可搜索地选一个现有模板作骨架，或空白。优先用"基础原始记录模板"作默认骨架。
  const defaultBase = templates.find(t => t.name === '基础原始记录模板') || templates[0];
  const [createOpen, setCreateOpen] = useState(false);
  const [skeleton, setSkeleton] = useState<number | 'blank'>('blank');
  const openCreate = () => { setSkeleton(defaultBase ? defaultBase.id : 'blank'); setCreateOpen(true); };
  const doCreate = () => {
    setCreateOpen(false);
    if (skeleton === 'blank') navigate('/record-templates/editor?from=blank');
    else navigate(`/record-templates/editor?clone_id=${skeleton}`);
  };

  const pendingCount = templates.filter(t => t.open_draft?.status === 'pending').length;
  const mineCount = templates.filter(t =>
    t.open_draft && (t.open_draft.status === 'draft' || t.open_draft.status === 'rejected')
    && t.open_draft.author_name === user?.display_name).length;

  // 高级搜索先过滤，再走视图：全部 = 树形分组（母模板按子树最近修改排序，子模板嵌套其下）；过滤视图 = 平铺
  const dataSource = useMemo(() => {
    const searched = applyTemplateSearch(templates, search);
    if (filter === 'all') return buildTemplateTree(searched);
    return filterTemplateRows(searched, filter, user?.display_name);
  }, [templates, filter, search, user?.display_name]);

  return (
    <div style={{ padding: 24 }}>
      <PageHeader
        title="原始记录模板"
        subtitle="可视化搭建表格/字段/公式，版本审核后生效；可空白新建或搜索一个现有模板作骨架派生。"
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新建模板</Button>
        }
      />

      <Modal title="新建原始记录模板" open={createOpen} onOk={doCreate} onCancel={() => setCreateOpen(false)}
        okText="创建并编辑" cancelText="取消" destroyOnClose>
        <p style={{ color: '#888', fontSize: 12 }}>选「空白模板」从零开始，或搜索一个现有模板作骨架（复制其内容到新模板，再编辑）。</p>
        <Select
          showSearch optionFilterProp="label" style={{ width: '100%' }} value={skeleton}
          onChange={(v) => setSkeleton(v)}
          placeholder="搜索模板名…"
          options={[
            { value: 'blank', label: '空白模板（从零开始）' },
            ...templates.map(t => ({ value: t.id, label: `以「${t.name}」为骨架 (v${t.version})` })),
          ]}
        />
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
      </div>

      <Table
        dataSource={dataSource}
        rowKey="id"
        loading={loading}
        expandable={filter === 'all' ? {
          expandedRowKeys: expandedKeys,
          onExpandedRowsChange: setExpandedKeys,
        } : undefined}
        columns={[
          {
            title: 'ID', width: COL_WIDTH.id,
            render: (_: any, r: any) => <span style={{ color: '#888' }}>#{r.id}</span>,
          },
          {
            title: '名称', dataIndex: 'name', width: COL_WIDTH.name, ellipsis: true,
            render: (v: string, r: any) => (
              <span>
                {v}
                {r.parent_template_id && <Tag color="orange" style={{ marginLeft: 6, fontSize: 11 }}>子模板</Tag>}
              </span>
            ),
          },
          {
            title: '版本', width: COL_WIDTH.version,
            render: (_: any, r: any) => <Tag color="green">v{r.current_version_no ?? '?'}</Tag>,
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
            render: (_: any, r: any) => {
              if (!r.parent_template_id) return <span style={{ color: '#aaa' }}>—</span>;
              const parent = templates.find(t => t.id === r.parent_template_id);
              return (
                <a onClick={(e) => { e.preventDefault(); navigate(`/record-templates/editor?id=${r.parent_template_id}`); }}>
                  <Tag color="orange" style={{ cursor: 'pointer' }}>
                    #{r.parent_template_id} {parent ? parent.name : '已删除'}
                  </Tag>
                </a>
              );
            },
          }] : []),
          {
            title: '最近修改时间', width: COL_WIDTH.modified,
            sorter: filter === 'all' ? undefined : (a: any, b: any) => activityTs(a) - activityTs(b),
            render: (_: any, r: any) => (
              <span style={{ fontSize: 12, color: '#5b6675', whiteSpace: 'nowrap' }}>
                {dayjs(r.last_activity || r.updated_at).format('YYYY-MM-DD HH:mm')}
              </span>
            ),
          },
          {
            title: '版本管理', width: COL_WIDTH.history, align: 'center' as const,
            render: (_: any, r: any) => (
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
            render: (_: any, r: any) => (
              <TemplateVersionPanel
                kind="record" templateId={r.id} templateName={r.name}
                currentVersionNo={r.current_version_no} openDraft={r.open_draft}
                onRefresh={load} actionsOnly iconOnly buttons={['lineage']}
                editorPathBase="/record-templates/editor"
              />
            ),
          },
          {
            title: '操作', width: COL_WIDTH.actions,
            render: (_: any, r: any) => (
              <Space size={4} style={{ whiteSpace: 'nowrap' }}>
                <TemplateVersionPanel
                  kind="record" templateId={r.id} templateName={r.name}
                  currentVersionNo={r.current_version_no} openDraft={r.open_draft}
                  onRefresh={load} actionsOnly iconOnly buttons={['fork']}
                  editorPathBase="/record-templates/editor"
                />
                <Tooltip title="编辑">
                  <Button size="small" icon={<EditOutlined />} onClick={() => navigate(`/record-templates/editor?id=${r.id}`)} />
                </Tooltip>
                <PdfDownloadButton title="下载该模板渲染 PDF（示例数据预览）"
                  onDownload={() => downloadRecordTemplatePdf(r.id, r.name || '原始记录模板')} />
                <TemplateVersionPanel
                  kind="record" templateId={r.id} templateName={r.name}
                  currentVersionNo={r.current_version_no} openDraft={r.open_draft}
                  onRefresh={load} actionsOnly iconOnly buttons={['submit']}
                  editorPathBase="/record-templates/editor"
                />
                <TemplateArchiveButton kind="record" row={r} onRefresh={load} />
              </Space>
            ),
          },
        ]}
      />
    </div>
  );
}
