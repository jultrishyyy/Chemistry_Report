import { useEffect, useMemo, useState } from 'react';
import { Button, Collapse, Form, Input, Modal, Select, Space, Table, Tag, Tooltip, message } from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import axios from 'axios';
import TestTemplateGroupArchiveActions from './TestTemplateGroupArchiveActions';

type Props = {
  open: boolean;
  onClose: () => void;
  onChanged?: () => void;
  onCreateTemplate?: (group: any) => void;
  /** 有值时只管理列表条目指定的单个项目组；未传时为全量管理。 */
  groupId?: number | null;
};

/** 简化后的项目组管理：项目组仅负责给原始记录模板归类。 */
export default function TestMethodManagerModal({ open, onClose, onChanged, onCreateTemplate, groupId }: Props) {
  const [groups, setGroups] = useState<any[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [groupSearch, setGroupSearch] = useState('');
  const [renameGroup, setRenameGroup] = useState<any | null>(null);
  const [addGroup, setAddGroup] = useState<any | null>(null);
  const [createForm] = Form.useForm();
  const [renameForm] = Form.useForm();
  const [addForm] = Form.useForm();

  const load = async () => {
    setLoading(true);
    try {
      const [groupResult, templateResult] = await Promise.all([
        axios.get('/api/test-methods/groups'), axios.get('/api/record-templates'),
      ]);
      setGroups(groupResult.data || []); setTemplates(templateResult.data || []);
    } catch (error: any) {
      message.error(error?.response?.data?.error || '项目组加载失败');
    } finally { setLoading(false); }
  };
  useEffect(() => { if (open) load(); }, [open]);

  const occupiedIds = useMemo(() => new Set(groups.flatMap(group =>
    (group.methods || []).map((member: any) => Number(member.record_template_id)))), [groups]);
  const visibleGroups = useMemo(() => {
    const scoped = groupId == null ? groups : groups.filter(group => Number(group.id) === Number(groupId));
    const keyword = groupSearch.trim().toLowerCase();
    if (!keyword || groupId != null) return scoped;
    return scoped.filter(group => [group.name, group.description,
      ...(group.methods || []).map((member: any) => member.record_template_name)]
      .some(value => String(value || '').toLowerCase().includes(keyword)));
  }, [groups, groupId, groupSearch]);
  const selectedGroup = groupId == null ? null : groups.find(group => Number(group.id) === Number(groupId));
  const refresh = async () => { await load(); onChanged?.(); };

  const createGroup = async () => {
    try {
      const values = await createForm.validateFields();
      await axios.post('/api/test-methods/groups', { name: values.name, description: values.description });
      message.success('项目组已创建'); setCreateOpen(false); createForm.resetFields();
      await refresh();
    } catch (error: any) {
      if (!error?.errorFields) message.error(error?.response?.data?.error || '项目组创建失败');
    }
  };
  const rename = async () => {
    if (!renameGroup) return;
    try {
      const values = await renameForm.validateFields();
      await axios.put(`/api/test-methods/groups/${renameGroup.id}`, { name: values.name });
      message.success('项目组名称已修改'); setRenameGroup(null); await refresh();
    } catch (error: any) {
      if (!error?.errorFields) message.error(error?.response?.data?.error || '名称修改失败');
    }
  };
  const addTemplate = async () => {
    if (!addGroup) return;
    try {
      const values = await addForm.validateFields();
      await axios.post(`/api/test-methods/groups/${addGroup.id}/templates`, values);
      message.success(`已将 ${values.template_ids.length} 个原始记录模板加入项目组`); setAddGroup(null); addForm.resetFields();
      await refresh();
    } catch (error: any) {
      if (!error?.errorFields) message.error(error?.response?.data?.error || '添加失败');
    }
  };
  const removeTemplate = (group: any, member: any) => Modal.confirm({
    title: '从项目组中移除模板？',
    content: `只解除“${member.record_template_name}”与“${group.name}”的归属关系，不会删除模板和历史录入数据。`,
    okText: '移出项目组', cancelText: '取消', okButtonProps: { danger: true },
    onOk: async () => {
      try {
        await axios.delete(`/api/test-methods/groups/${group.id}/templates/${member.record_template_id}`);
        message.success('已移出项目组'); await refresh();
      } catch (error: any) { message.error(error?.response?.data?.error || '移除失败'); }
    },
  });

  return <>
    <Modal width={900} title={selectedGroup ? `管理项目组 · ${selectedGroup.name}` : '项目组管理'} open={open} onCancel={onClose}
      footer={<Button onClick={onClose}>关闭</Button>}>
      {groupId == null && <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
        <Input.Search allowClear value={groupSearch} onChange={event => setGroupSearch(event.target.value)}
          placeholder="搜索项目组名称、说明或组内模板" style={{ width: 320 }} />
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>新建项目组</Button>
      </div>}
      <Collapse key={groupId == null ? 'all-groups' : `group-${groupId}`}
        defaultActiveKey={groupId == null ? undefined : visibleGroups.map(group => String(group.id))}
        items={visibleGroups.map(group => ({
        key: String(group.id),
        label: <Space><b>{group.name}</b><Tag>{group.methods?.length || 0} 个原始记录模板</Tag>
          {group.archive_requested_by && <Tag color="red">删除待审</Tag>}</Space>,
        extra: <Space size={4} onClick={event => event.stopPropagation()}>
          <Tooltip title="修改项目组名称"><Button size="small" type="text" icon={<EditOutlined />} onClick={() => {
            renameForm.setFieldsValue({ name: group.name }); setRenameGroup(group);
          }} /></Tooltip>
          <TestTemplateGroupArchiveActions group={group} onRefresh={refresh} />
        </Space>,
        children: <>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
            <Space>
              {onCreateTemplate && <Button size="small" type="primary" icon={<PlusOutlined />} onClick={() => onCreateTemplate(group)}>新建并加入</Button>}
              <Button size="small" icon={<PlusOutlined />} onClick={() => { addForm.resetFields(); setAddGroup(group); }}>加入已有模板</Button>
            </Space>
          </div>
          <Table size="small" loading={loading} pagination={false} rowKey="id" dataSource={group.methods || []}
            columns={[
              { title: '原始记录模板', render: (_: any, row: any) => <Space><b>{row.record_template_name || `#${row.record_template_id}`}</b><Tag>#{row.record_template_id}</Tag></Space> },
              { title: '派生关系', render: (_: any, row: any) => row.parent_template_id ? <Tag color="orange">母模板 #{row.parent_template_id} 的子模板</Tag> : '独立模板' },
              { title: '操作', width: 90, render: (_: any, row: any) => <Button danger size="small" type="text" icon={<DeleteOutlined />} onClick={() => removeTemplate(group, row)}>移出</Button> },
            ]} />
        </>,
      }))} />
      {!loading && !visibleGroups.length && <div style={{ textAlign: 'center', color: '#999', padding: 32 }}>
        {groupId == null ? '尚未建立项目组' : '该项目组已不存在或已删除'}
      </div>}
    </Modal>

    <Modal title="新建项目组" open={createOpen} onOk={createGroup} onCancel={() => setCreateOpen(false)} okText="创建">
      <Form form={createForm} layout="vertical">
        <Form.Item name="name" label="项目组名称" rules={[{ required: true }]}><Input placeholder="例如：弯曲性能" /></Form.Item>
        <Form.Item name="description" label="说明"><Input.TextArea rows={3} placeholder="可填写项目组用途或包含的测试方法" /></Form.Item>
      </Form>
    </Modal>
    <Modal title="修改项目组名称" open={!!renameGroup} onOk={rename} onCancel={() => setRenameGroup(null)} okText="保存">
      <Form form={renameForm} layout="vertical"><Form.Item name="name" label="项目组名称" rules={[{ required: true }]}><Input /></Form.Item></Form>
    </Modal>
    <Modal title={`加入已有模板${addGroup ? ` · ${addGroup.name}` : ''}`} open={!!addGroup} onOk={addTemplate} onCancel={() => setAddGroup(null)} okText="批量加入">
      <Form form={addForm} layout="vertical"><Form.Item name="template_ids" label="原始记录模板" rules={[{ required: true, message: '请至少选择一个模板' }]}>
        <Select mode="multiple" showSearch optionFilterProp="label" maxTagCount="responsive"
          placeholder="可按模板名称搜索并多选" options={templates.map(template => ({
          value: template.id,
          label: `${template.name} · ${template.current_version_no ? `已生效 v${template.current_version_no}` : template.open_draft?.status === 'pending' ? '待审核' : '未审核'}`,
          disabled: occupiedIds.has(Number(template.id)),
        }))} />
      </Form.Item></Form>
    </Modal>
  </>;
}
