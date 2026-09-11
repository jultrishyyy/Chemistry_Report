import { useEffect, useState } from 'react';
import { Button, Form, Input, Modal, Select, Space, message } from 'antd';
import { ApartmentOutlined, PlusOutlined } from '@ant-design/icons';
import axios from 'axios';
import type { RecordTemplate } from '../../../shared/types';

type Props = {
  template: RecordTemplate;
  readOnly?: boolean;
  templateGroupId?: number;
  onChange: (template: RecordTemplate) => void;
  onFamilyChange?: (group: any | null) => void;
  onDerived?: (templateId: number) => void;
};

/** 项目组仅表示归属；选择结果随模板下一次保存提交。 */
export default function RecordCommonAreaActions({ readOnly, templateGroupId, onFamilyChange }: Props) {
  const [families, setFamilies] = useState<any[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [form] = Form.useForm();

  const load = async () => {
    try { setFamilies((await axios.get('/api/test-methods/groups')).data || []); }
    catch (error: any) { message.error(error?.response?.data?.error || '项目组信息加载失败'); }
  };
  useEffect(() => { load(); }, []);

  const createFamily = async () => {
    try {
      const values = await form.validateFields();
      const response = await axios.post('/api/test-methods/groups', { name: values.name });
      const group = response.data;
      await load(); onFamilyChange?.(group); setCreateOpen(false); form.resetFields();
      message.success('项目组已创建，保存模板后完成归属');
    } catch (error: any) {
      if (!error?.errorFields) message.error(error?.response?.data?.error || '项目组创建失败');
    }
  };

  return <>
    <Space size={4}>
      <ApartmentOutlined style={{ color: '#1677ff' }} />
      <Select allowClear showSearch optionFilterProp="label" size="small" style={{ width: 190 }}
        disabled={readOnly} value={templateGroupId} placeholder="不归属项目组"
        onChange={value => onFamilyChange?.(value
          ? families.find(group => Number(group.id) === Number(value)) || { id: value, name: `项目组 #${value}` }
          : null)}
        options={families.map(group => ({ value: Number(group.id), label: group.name }))} />
      <Button size="small" type="text" icon={<PlusOutlined />} disabled={readOnly} onClick={() => setCreateOpen(true)}>新建项目组</Button>
    </Space>
    <Modal title="新建项目组" open={createOpen} onOk={createFamily} onCancel={() => setCreateOpen(false)} okText="创建并选择">
      <Form form={form} layout="vertical"><Form.Item name="name" label="项目组名称" rules={[{ required: true }]}><Input /></Form.Item></Form>
    </Modal>
  </>;
}
