/**
 * TitleStylePanel — PDF 顶部「大标题 / 副标题」的文字 + 样式编辑（仅原始记录模式）。
 *
 * 把过去系统写死的标题（document_title）、副标题（硬编码"广电计量"）和它们的样式
 * 开放成用户可调：文字 + 字体/字号/加粗/斜体/颜色/对齐（复用 FormatPanel → StyleOverride）。
 * 写入 layout_options.{document_title, title_style, subtitle, subtitle_style}，
 * 由 typst-generator 序列化进主题 config，record-theme 渲染居中标题块时合并应用。
 */
import { Card, Space, Button, Tooltip } from 'antd';
import { FontColorsOutlined, ProfileOutlined } from '@ant-design/icons';
import type { RecordTemplate, StyleOverride } from '../../../../shared/types';
import FormatPanel from './FormatPanel';
import AutoGrowTextArea from '../AutoGrowTextArea';
import ClosablePopover from '../ClosablePopover';

interface Props {
  template: RecordTemplate;
  onChange: (t: RecordTemplate) => void;
}

function FormatPopover({ value, onChange, title, boldDefault }: { value?: StyleOverride; onChange: (s: StyleOverride | undefined) => void; title: string; boldDefault?: boolean }) {
  return (
    <ClosablePopover trigger="click" placement="bottomLeft" title={title}
      content={<FormatPanel value={value} onChange={onChange} inheritedBold={boldDefault} />}>
      <Tooltip title="字体 / 字号 / 加粗 / 斜体 / 对齐 / 颜色">
        <Button size="small" type={value ? 'primary' : 'default'} ghost={!!value} icon={<FontColorsOutlined />}>格式</Button>
      </Tooltip>
    </ClosablePopover>
  );
}

export default function TitleStylePanel({ template, onChange }: Props) {
  const lo: Record<string, any> = template.layout_options || {};
  const set = (patch: Record<string, any>) => onChange({ ...template, layout_options: { ...lo, ...patch } });

  return (
    <Card
      size="small"
      style={{ marginBottom: 12, borderColor: '#e4e8f0' }}
      styles={{ header: { background: '#f8fafc', borderBottomColor: '#eef0f4' } }}
      title={
        <Space>
          <ProfileOutlined style={{ color: '#1366d9' }} />
          <span style={{ fontWeight: 600 }}>标题与副标题</span>
          <span style={{ fontSize: 11, color: '#888' }}>PDF 顶部居中标题块——文字与字体/加粗/居中均可自定义</span>
        </Space>
      }
    >
      <Space direction="vertical" size={10} style={{ width: '100%' }}>
        <div>
          <div style={{ fontSize: 11, color: '#666', marginBottom: 2, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>大标题文字（留空则用模板名称）</span>
            <FormatPopover title="大标题格式（覆盖默认：标题倍率加粗居中）" boldDefault
              value={lo.title_style} onChange={(s) => set({ title_style: s })} />
          </div>
          <AutoGrowTextArea
            value={lo.document_title || ''}
            onChange={(e) => set({ document_title: e.target.value || undefined })}
            placeholder="如：汽车内饰材料燃烧性试验原始记录"
          />
        </div>
        <div>
          <div style={{ fontSize: 11, color: '#666', marginBottom: 2, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>副标题文字（清空则不显示副标题）</span>
            <FormatPopover title="副标题格式（覆盖默认：小字灰色居中）"
              value={lo.subtitle_style} onChange={(s) => set({ subtitle_style: s })} />
          </div>
          <AutoGrowTextArea
            value={lo.subtitle ?? '广电计量'}
            onChange={(e) => set({ subtitle: e.target.value })}
            placeholder="如：广电计量检测（广州）有限公司"
          />
        </div>
      </Space>
    </Card>
  );
}
