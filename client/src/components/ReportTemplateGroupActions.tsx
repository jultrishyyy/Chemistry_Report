import { useEffect, useState } from 'react';
import { ApartmentOutlined, PlusOutlined } from '@ant-design/icons';
import { Button, Form, Input, Modal, Select, Space, Tooltip, message } from 'antd';
import axios from 'axios';

type Props = {
  templateId: number;
  templateKind: 'cover' | 'project';
  groupId?: number | null;
  disabled?: boolean;
  onChanged?: () => void;
};

/** 报告模板的项目组归属入口。归属属于模板元数据，修改后立即生效，不改模板内容版本。 */
export default function ReportTemplateGroupActions({
  templateId, templateKind, groupId, disabled, onChanged,
}: Props) {
  const [groups, setGroups] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [form] = Form.useForm();

  const load = async () => {
    try {
      setGroups((await axios.get('/api/report-project-families')).data || []);
    } catch (error: any) {
      message.error(error?.response?.data?.error || '项目组信息加载失败');
    }
  };
  useEffect(() => { load(); }, [templateKind]);

  const changeGroup = async (value?: number) => {
    setSaving(true);
    try {
      await axios.put(`/api/report-templates/${templateId}`, { report_project_family_id: value ?? null });
      message.success(value ? '项目组归属已更新' : '已移出项目组');
      onChanged?.();
    } catch (error: any) {
      message.error(error?.response?.data?.error || '项目组归属修改失败');
    } finally { setSaving(false); }
  };

  const createGroup = async () => {
    try {
      const values = await form.validateFields();
      const response = await axios.post('/api/report-project-families', {
        ...values, template_kind: templateKind,
      });
      await changeGroup(Number(response.data.id));
      await load();
      setCreateOpen(false);
      form.resetFields();
    } catch (error: any) {
      if (!error?.errorFields) message.error(error?.response?.data?.error || '项目组创建失败');
    }
  };

  return <>
    <Space size={4}>
      <ApartmentOutlined style={{ color: '#1677ff' }} />
      <Select allowClear showSearch optionFilterProp="label" size="small" style={{ width: 190 }}
        disabled={disabled || saving} value={groupId || undefined} placeholder="不归属项目组"
        onChange={changeGroup}
        options={groups.map(group => ({ value: Number(group.id), label: group.name }))} />
      <Tooltip title="新建项目组"><span style={{ display: 'inline-flex' }}>
        <Button size="small" type="text" icon={<PlusOutlined />} aria-label="新建项目组" disabled={disabled || saving}
          onClick={() => setCreateOpen(true)} />
      </span></Tooltip>
    </Space>
    <Modal title="新建项目组" open={createOpen} onOk={createGroup}
      onCancel={() => setCreateOpen(false)} okText="创建并选择">
      <Form form={form} layout="vertical">
        <Form.Item name="name" label="项目组名称" rules={[{ required: true }]}><Input /></Form.Item>
        <Form.Item name="description" label="说明"><Input.TextArea rows={2} /></Form.Item>
      </Form>
    </Modal>
  </>;
}
