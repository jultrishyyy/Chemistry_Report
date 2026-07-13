import { Card, Form, Select as AntSelect, Radio, InputNumber, Space, Button, Tooltip, Switch } from 'antd';
import { BgColorsOutlined, ReloadOutlined } from '@ant-design/icons';
import { useState } from 'react';
import type { RecordTemplate } from '../../../../shared/types';
import { editorCapabilities, type EditorMode } from './field-types';

interface Props {
  template: RecordTemplate;
  onChange: (t: RecordTemplate) => void;
  /** 编辑器模式：项目报告不需要「只渲染字段（自动标题/副标题）」开关——项目段本就不出大标题。 */
  editorMode?: EditorMode;
}

/**
 * 文档级样式面板：写入 / 读取 template.layout_options.theme_config。
 * 所有旋钮都只是键值，不做任何布局逻辑——@local/record-theme 会统一吃。
 */
export default function DocumentStylePanel({ template, onChange, editorMode = 'record' }: Props) {
  const [collapsed, setCollapsed] = useState(true);
  const cfg: Record<string, any> = (template.layout_options?.theme_config as any) || {};

  const setCfg = (patch: Record<string, any>) => {
    const next = { ...cfg, ...patch };
    // 清掉 undefined 以免序列化时写进 typst 当字符串
    for (const k of Object.keys(next)) {
      if (next[k] === undefined || next[k] === null || next[k] === '') delete next[k];
    }
    onChange({
      ...template,
      layout_options: { ...template.layout_options, theme_config: next },
    });
  };

  const reset = () => {
    onChange({
      ...template,
      layout_options: { ...template.layout_options, theme_config: {} },
    });
  };

  /**
   * 文档级「字段标签」统一设置（默认/加粗/正常）。
   * 加粗/正常＝强制统一到**全部字段**——同时清掉每个字段的 `label_bold` 与 `label_style.weight`，
   * 否则字段级覆盖会让文档级设置应用不到那些字段（首页模板的字段就带着 label_bold:false）。
   * 默认＝用主题默认（加粗）、且**保留**字段级各自的设置（不强制统一）。
   */
  const setLabelWeight = (mode: 'default' | 'bold' | 'regular') => {
    const nextCfg = { ...cfg };
    if (mode === 'default') delete nextCfg.label_weight;
    else nextCfg.label_weight = mode;
    for (const k of Object.keys(nextCfg)) {
      if (nextCfg[k] === undefined || nextCfg[k] === null || nextCfg[k] === '') delete nextCfg[k];
    }
    // 加粗/正常：清字段级标签加粗覆盖，让设置真正落到全部字段
    const groups = mode === 'default' ? template.groups : template.groups.map(g => ({
      ...g,
      fields: g.fields.map(f => {
        if (f.label_bold === undefined && f.label_style?.weight === undefined) return f;
        const nf: typeof f = { ...f };
        delete nf.label_bold;
        if (nf.label_style?.weight !== undefined) {
          const ls = { ...nf.label_style };
          delete ls.weight;
          nf.label_style = Object.keys(ls).length ? ls : undefined;
        }
        return nf;
      }),
    }));
    onChange({
      ...template,
      groups,
      layout_options: { ...template.layout_options, theme_config: nextCfg },
    });
  };

  // 文档级「字段间距」(line_gap) = 全局默认；分区可单独设 group.style.block_spacing 覆盖（仅覆盖该组）。
  // 若有分组单独覆盖，给一个「应用到全部分组」入口：清掉各组的 block_spacing，让文档值真正落到全部
  // （与 setLabelWeight 同构的"统一动作=清下级覆盖"语义，解决"分组设过之后文档调了不生效"）。
  const hasGroupFieldGapOverride = template.groups.some(g => g.style?.block_spacing != null);
  const applyFieldGapToAll = () => {
    const groups = template.groups.map(g => {
      if (g.style?.block_spacing == null) return g;
      const st = { ...g.style }; delete (st as any).block_spacing;
      return { ...g, style: Object.keys(st).length ? st : undefined };
    });
    onChange({ ...template, groups });
  };

  // 「只渲染字段」：抑制渲染时自动加的大标题 + 副标题（首页模板"完全按字段来"）。
  const lo: Record<string, any> = (template.layout_options as any) || {};
  const fieldsOnly = !!lo.suppress_title;
  const setFieldsOnly = (on: boolean) => {
    const nextLo = { ...lo };
    if (on) { nextLo.suppress_title = true; nextLo.subtitle = ''; }
    else { delete nextLo.suppress_title; delete nextLo.subtitle; }
    onChange({ ...template, layout_options: nextLo });
  };

  return (
    <Card
      size="small"
      style={{ marginBottom: 12, borderColor: '#e4e8f0' }}
      styles={{ header: { background: '#f8fafc', borderBottomColor: '#eef0f4' } }}
      title={
        <Space>
          <BgColorsOutlined style={{ color: '#1366d9' }} />
          <span style={{ fontWeight: 600 }}>文档样式</span>
          <span style={{ fontSize: 11, color: '#888' }}>
            统一影响整份 PDF 的字体、行距、标题等
          </span>
        </Space>
      }
      extra={
        <Space>
          <Tooltip title="重置为默认样式">
            <Button size="small" icon={<ReloadOutlined />} onClick={reset} />
          </Tooltip>
          <Button size="small" type="link" onClick={() => setCollapsed(!collapsed)}>
            {collapsed ? '展开' : '收起'}
          </Button>
        </Space>
      }
    >
      {!collapsed && (
        <Form layout="vertical" size="small" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
          {/* 项目报告段本就不出大标题/副标题（renderContentDoc 已剥离），此开关对项目无意义 → 隐藏，避免画蛇添足 */}
          {editorCapabilities(editorMode).autoTitleToggle && (
            <Form.Item label="只渲染字段" style={{ marginBottom: 8, gridColumn: '1 / -1' }}
              extra="开启后不显示渲染时自动加的大标题与副标题，完全按字段内容渲染（首页/封面常用）">
              <Space size={8}>
                <Switch checked={fieldsOnly} onChange={setFieldsOnly} />
                <span style={{ fontSize: 12, color: '#888' }}>{fieldsOnly ? '不显示自动标题/副标题' : '显示自动标题/副标题'}</span>
              </Space>
            </Form.Item>
          )}

          <Form.Item label="字体" style={{ marginBottom: 8 }}>
            <AntSelect
              value={cfg.font || 'Songti SC'}
              onChange={(v) => setCfg({ font: v })}
              // 仅 demo_v1/fonts/ 里已打包的字体（系统只用此目录渲染，跨服务器一致）。英文/数字默认 Arial。
              options={[
                { value: 'Songti SC', label: '宋体' },
                { value: 'SimHei', label: '黑体' },
                { value: 'KaiTi', label: '楷体' },
                { value: 'FangSong', label: '仿宋' },
                { value: 'FangSong_GB2312', label: '仿宋_GB2312' },
                { value: 'STSong', label: '华文宋体' },
                { value: 'Arial', label: 'Arial' },
                { value: 'Times New Roman', label: 'Times New Roman' },
              ]}
            />
          </Form.Item>

          <Form.Item label="正文字号" style={{ marginBottom: 8 }}>
            <InputNumber
              min={8} max={16} step={0.5}
              value={cfg.body_size ?? 10}
              onChange={(v) => setCfg({ body_size: v ?? 10 })}
              addonAfter="pt"
              style={{ width: '100%' }}
            />
          </Form.Item>

          <Form.Item label="文档标题倍率" style={{ marginBottom: 8 }}>
            <InputNumber min={0.8} max={3} step={0.05} style={{ width: '100%' }}
              addonBefore="×" value={cfg.title_scale ?? 1.4}
              onChange={(v) => setCfg({ title_scale: v ?? 1.4 })} />
          </Form.Item>

          <Form.Item label="分组标题倍率" style={{ marginBottom: 8 }}>
            <InputNumber min={0.8} max={3} step={0.05} style={{ width: '100%' }}
              addonBefore="×" value={cfg.heading_scale ?? 1.15}
              onChange={(v) => setCfg({ heading_scale: v ?? 1.15 })} />
          </Form.Item>

          <Form.Item label="字段间距" style={{ marginBottom: 8 }}
            tooltip="字段与字段、图/表之间的默认上下间距（全局默认）。某个分区想单独调，去该分区的「格式·字段间距」覆盖——只影响那一组。"
            extra={hasGroupFieldGapOverride ? (
              <Tooltip title="有分区单独设过「字段间距」，会盖住这里的全局值。点此清掉各分区的单独设置，统一用上面的值。">
                <Button size="small" type="link" style={{ padding: 0, height: 'auto', fontSize: 11 }} onClick={applyFieldGapToAll}>
                  有分区单独设过 → 应用到全部分组
                </Button>
              </Tooltip>
            ) : undefined}>
            <InputNumber min={0} max={5} step={0.1} style={{ width: '100%' }}
              addonAfter="em" value={cfg.line_gap ?? 0.6}
              onChange={(v) => setCfg({ line_gap: v ?? 0.6 })} />
          </Form.Item>

          <Form.Item label="分组间距" style={{ marginBottom: 8 }}
            tooltip="相邻分组（分区）之间的空白。">
            <InputNumber min={0} max={6} step={0.1} style={{ width: '100%' }}
              addonAfter="em" value={cfg.paragraph_gap ?? 0.8}
              onChange={(v) => setCfg({ paragraph_gap: v ?? 0.8 })} />
          </Form.Item>

          <Form.Item label="字段标签" style={{ marginBottom: 8 }}
            tooltip="统一设置全部字段名（标签）的粗细。默认＝用系统默认（加粗）、保留各字段自己的设置；加粗/正常＝强制全部字段标签加粗/不加粗（会清掉各字段单独设的加粗）。">
            <Radio.Group
              value={cfg.label_weight === 'bold' ? 'bold' : cfg.label_weight === 'regular' ? 'regular' : 'default'}
              onChange={(e) => setLabelWeight(e.target.value)}
              optionType="button"
              options={[
                { value: 'default', label: '默认' },
                { value: 'bold', label: '加粗' },
                { value: 'regular', label: '正常' },
              ]}
            />
          </Form.Item>

          <Form.Item label="字段名对齐" style={{ marginBottom: 8 }}
            tooltip="开启后：所有字段的「值」对齐到同一位置（标签按固定列宽排，像公文制表位）。关闭：值紧跟字段名。用列宽调字段名与值之间的距离——不要在值里敲空格。">
            <Space>
              <Switch size="small" checked={!!cfg.label_width}
                onChange={(on) => setCfg({ label_width: on ? '6em' : undefined })} />
              <span style={{ fontSize: 12, color: '#888' }}>{cfg.label_width ? '已对齐' : '不对齐'}</span>
              {cfg.label_width && (
                <>
                  <span style={{ fontSize: 12, color: '#888', marginLeft: 4 }}>标签列宽</span>
                  <InputNumber size="small" min={1} max={20} step={0.5} style={{ width: 92 }} addonAfter="em"
                    value={parseFloat(String(cfg.label_width)) || 6}
                    onChange={(v) => setCfg({ label_width: `${v ?? 6}em` })} />
                </>
              )}
            </Space>
          </Form.Item>

          <Form.Item label="分组标题样式" style={{ marginBottom: 8 }}>
            <Radio.Group
              value={cfg.section_style || 'left-bold'}
              onChange={(e) => setCfg({ section_style: e.target.value })}
              optionType="button"
              options={[
                { value: 'left-bold', label: '左加粗' },
                { value: 'center-bold', label: '居中加粗' },
                { value: 'banner', label: '带底色条' },
              ]}
            />
          </Form.Item>

          <Form.Item label="表格边框" style={{ marginBottom: 8 }}>
            <InputNumber min={0} max={3} step={0.1} style={{ width: '100%' }}
              addonAfter="pt" value={cfg.table_stroke ?? 0.5}
              onChange={(v) => setCfg({ table_stroke: v ?? 0 })} />
          </Form.Item>

          <Form.Item label="上下页边距" style={{ marginBottom: 8 }} extra="留空=标准；上下（顶/底）统一">
            <InputNumber min={0.5} max={5} step={0.1} style={{ width: '100%' }}
              addonAfter="cm" placeholder="标准"
              value={typeof cfg.margin_v === 'number' ? cfg.margin_v : (typeof cfg.margin === 'number' ? cfg.margin : undefined)}
              onChange={(v) => setCfg({ margin_v: v ?? undefined })} />
          </Form.Item>

          <Form.Item label="左右页边距" style={{ marginBottom: 8 }} extra="留空=标准；左右统一">
            <InputNumber min={0.5} max={5} step={0.1} style={{ width: '100%' }}
              addonAfter="cm" placeholder="标准"
              value={typeof cfg.margin_h === 'number' ? cfg.margin_h : (typeof cfg.margin === 'number' ? cfg.margin : undefined)}
              onChange={(v) => setCfg({ margin_h: v ?? undefined })} />
          </Form.Item>
        </Form>
      )}
    </Card>
  );
}
