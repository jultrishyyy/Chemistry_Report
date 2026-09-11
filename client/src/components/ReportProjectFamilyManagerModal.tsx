import { useEffect, useMemo, useState } from 'react';
import { Button, Collapse, Form, Input, Modal, Select, Space, Table, Tag, Tooltip, message } from 'antd';
import { EditOutlined, LinkOutlined, PlusOutlined } from '@ant-design/icons';
import axios from 'axios';
import TestTemplateGroupArchiveActions from './TestTemplateGroupArchiveActions';

type TemplateKind = 'cover' | 'project';

type Props = {
  open: boolean;
  kind: TemplateKind;
  onClose: () => void;
  onChanged?: () => void;
  onCreateTemplate?: (group: any) => void;
  groupId?: number | null;
};

export default function ReportProjectFamilyManagerModal({
  open, kind, onClose, onChanged, onCreateTemplate, groupId,
}: Props) {
  const [families, setFamilies] = useState<any[]>([]);
  const [manufacturers, setManufacturers] = useState<any[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [groupSearch, setGroupSearch] = useState('');
  const [editingFamily, setEditingFamily] = useState<any | null>(null);
  const [attachFamily, setAttachFamily] = useState<any | null>(null);
  const [createForm] = Form.useForm();
  const [editForm] = Form.useForm();
  const [attachForm] = Form.useForm();
  const templateLabel = kind === 'project' ? '项目模板' : '首页模板';

  const load = async () => {
    try {
      const [familyResult, manufacturerResult, templateResult] = await Promise.all([
        axios.get(`/api/report-project-families?kind=${kind}`),
        axios.get('/api/host-manufacturers'),
        axios.get(`/api/report-templates?kind=${kind}`),
      ]);
      setFamilies(familyResult.data || []);
      setManufacturers(manufacturerResult.data || []);
      setTemplates(templateResult.data || []);
    } catch (error: any) {
      message.error(error?.response?.data?.error || '项目组加载失败');
    }
  };

  useEffect(() => { if (open) load(); }, [open, kind]);
  const refresh = async () => { await load(); onChanged?.(); };
  const visibleFamilies = useMemo(() => {
    const scoped = groupId == null ? families : families.filter(family => Number(family.id) === Number(groupId));
    const keyword = groupSearch.trim().toLowerCase();
    if (!keyword || groupId != null) return scoped;
    return scoped.filter(family => [family.name, family.description, family.host_manufacturer_name,
      ...(family.templates || []).map((template: any) => template.name)]
      .some(value => String(value || '').toLowerCase().includes(keyword)));
  }, [families, groupId, groupSearch]);
  const selectedFamily = groupId == null ? null : families.find(family => Number(family.id) === Number(groupId));

  const createFamily = async () => {
    try {
      const values = await createForm.validateFields();
      await axios.post('/api/report-project-families', { ...values, template_kind: kind });
      message.success('项目组已创建');
      setCreateOpen(false);
      createForm.resetFields();
      await refresh();
    } catch (error: any) {
      if (!error?.errorFields) message.error(error?.response?.data?.error || '创建失败');
    }
  };

  const saveFamily = async () => {
    if (!editingFamily) return;
    try {
      const values = await editForm.validateFields();
      await axios.put(`/api/report-project-families/${editingFamily.id}`, {
        ...values,
        // Select 清空后字段值为 undefined；显式传 null 才表示解除已有主机厂关联。
        host_manufacturer_id: values.host_manufacturer_id ?? null,
      });
      message.success('项目组已更新');
      setEditingFamily(null);
      await refresh();
    } catch (error: any) {
      if (!error?.errorFields) message.error(error?.response?.data?.error || '保存失败');
    }
  };

  const attach = async () => {
    if (!attachFamily) return;
    try {
      const values = await attachForm.validateFields();
      await axios.post(`/api/report-project-families/${attachFamily.id}/templates`, values);
      message.success(`已将 ${values.template_ids.length} 个${templateLabel}加入项目组`);
      setAttachFamily(null);
      attachForm.resetFields();
      await refresh();
    } catch (error: any) {
      if (!error?.errorFields) message.error(error?.response?.data?.error || '加入失败');
    }
  };

  const candidatePriority = (template: any, family: any) => {
    const templateHost = Number(template.host_manufacturer_id || 0);
    const familyHost = Number(family?.host_manufacturer_id || 0);
    if (templateHost === familyHost) return 0;
    if (!templateHost) return 1;
    return 2;
  };
  const candidatesFor = (family: any) => templates
    .filter(template => !template.report_project_family_id)
    .sort((a, b) => candidatePriority(a, family) - candidatePriority(b, family)
      || String(a.name).localeCompare(String(b.name)));
  const candidateLabel = (template: any) => {
    const state = template.current_version_no
      ? `已生效 v${template.current_version_no}`
      : template.open_draft?.status === 'pending' ? '待审核' : '未审核';
    return `${template.name} · ${template.host_manufacturer_name || '未设置主机厂'} · ${state}`;
  };

  return <>
    <Modal open={open} onCancel={onClose} width={1080}
      title={selectedFamily ? `管理项目组 · ${selectedFamily.name}` : '管理项目组'}
      footer={<Button onClick={onClose}>关闭</Button>}>
      {groupId == null && <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
        <Input.Search allowClear value={groupSearch} onChange={event => setGroupSearch(event.target.value)}
          placeholder="搜索项目组名称、说明、主机厂或组内模板" style={{ width: 360 }} />
        <Button type="primary" icon={<PlusOutlined />} onClick={() => {
          createForm.resetFields(); setCreateOpen(true);
        }}>新建项目组</Button>
      </div>}
      <Collapse key={`${kind}-${groupId == null ? 'all' : groupId}`}
        defaultActiveKey={groupId == null ? undefined : visibleFamilies.map(family => String(family.id))}
        items={visibleFamilies.map(family => ({
          key: String(family.id),
          label: <Space wrap><b>{family.name}</b>
            {family.host_manufacturer_name ? <Tag color="blue">{family.host_manufacturer_name}</Tag> : <Tag>未设置主机厂</Tag>}
            <Tag>{family.templates?.length || 0} 个{templateLabel}</Tag>
            {family.archive_requested_by && <Tag color="red">删除待审</Tag>}
          </Space>,
          extra: <Space size={4} onClick={event => event.stopPropagation()}>
            <Tooltip title="编辑项目组"><Button size="small" type="text" icon={<EditOutlined />} onClick={() => {
              setEditingFamily(family); editForm.setFieldsValue(family);
            }} /></Tooltip>
            <TestTemplateGroupArchiveActions kind="report" group={family} onRefresh={refresh} />
          </Space>,
          children: <>
            <div style={{ textAlign: 'right', marginBottom: 8 }}><Space wrap>
              {onCreateTemplate && <Button size="small" type="primary" icon={<PlusOutlined />}
                onClick={() => onCreateTemplate(family)}>新建并加入</Button>}
              <Button size="small" icon={<LinkOutlined />} onClick={() => {
                setAttachFamily(family); attachForm.resetFields();
              }}>加入已有{templateLabel}</Button>
            </Space></div>
            <Table size="small" pagination={false} rowKey="id" dataSource={family.templates || []} columns={[
              { title: templateLabel, dataIndex: 'name' },
              ...(kind === 'project' ? [{
                title: '关联原始记录', dataIndex: 'linked_record_template_name',
                render: (value: string) => value || <Tag color="warning">未关联</Tag>,
              }] : []),
              { title: '版本', render: (_: any, row: any) => row.version_no ? `v${row.version_no} · ${row.status}` : '尚未生效' },
            ]} />
          </>,
        }))} />
      {!visibleFamilies.length && <div style={{ textAlign: 'center', color: '#98a2b3', padding: 32 }}>
        {groupId == null ? '尚未建立项目组' : '该项目组已不存在或已删除'}
      </div>}
    </Modal>

    <Modal open={createOpen} title="新建项目组" onCancel={() => setCreateOpen(false)}
      onOk={createFamily} okText="创建">
      <Form form={createForm} layout="vertical">
        <Form.Item name="name" label="项目组名称" rules={[{ required: true }]}>
          <Input placeholder={kind === 'project' ? '例如：某主机厂弯曲性能报告' : '例如：某主机厂常规报告首页'} />
        </Form.Item>
        <Form.Item name="host_manufacturer_id" label="主机厂（可不选）">
          <Select allowClear showSearch optionFilterProp="label" placeholder="不选择则作为通用项目组"
            options={manufacturers.map(item => ({ value: item.id, label: item.name }))} />
        </Form.Item>
        <Form.Item name="description" label="说明"><Input.TextArea rows={2} /></Form.Item>
      </Form>
    </Modal>

    <Modal open={!!editingFamily} title="编辑项目组" onCancel={() => setEditingFamily(null)}
      onOk={saveFamily} okText="保存">
      <Form form={editForm} layout="vertical">
        <Form.Item name="name" label="名称" rules={[{ required: true }]}><Input /></Form.Item>
        <Form.Item name="host_manufacturer_id" label="主机厂（可不选）">
          <Select allowClear showSearch optionFilterProp="label"
            options={manufacturers.map(item => ({ value: item.id, label: item.name }))} />
        </Form.Item>
        <Form.Item name="description" label="说明"><Input.TextArea rows={2} /></Form.Item>
      </Form>
    </Modal>

    <Modal open={!!attachFamily} title={`加入已有${templateLabel}`} onCancel={() => setAttachFamily(null)}
      onOk={attach} okText="批量加入">
      <Form form={attachForm} layout="vertical">
        <Form.Item name="template_ids" label={templateLabel} rules={[{ required: true, message: '请至少选择一个模板' }]}>
          <Select mode="multiple" showSearch optionFilterProp="label" maxTagCount="responsive"
            placeholder="可按模板名称或主机厂搜索并多选" options={attachFamily
            ? candidatesFor(attachFamily).map(template => ({
              value: template.id, label: candidateLabel(template),
            })) : []} />
        </Form.Item>
      </Form>
    </Modal>
  </>;
}
