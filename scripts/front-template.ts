/**
 * 首页模板（report template, template_kind='cover'）— 复刻样例「测试报告」前两页。
 *
 * 这是单一事实来源：预览渲染（_render_front.ts）与入库（upsert-front-template.ts）都用它。
 * 页眉页脚的「值」（报告编号/校验码/公司名称地址电话传真）只放占位文字——
 * 生成报告时由 server 的 buildHeaderFooterConfig ← ReportMeta(接口⑦) 自动填充。
 *
 * 字体：生产存「仿宋」（FangSong_GB2312）；本机预览可传 STSong 兜底（本机无仿宋）。
 */
import type { RecordTemplate, FieldGroup } from '../shared/types';

const sp = (id: string, h: string): FieldGroup => ({
  id, label: '', layout: 'vertical', hide_title: true,
  fields: [{ id: id + 'f', code: id + 'f', label: '', type: 'spacer', hide_label: true, spacer_height: h }],
});

export function buildFrontTemplate(font = 'FangSong'): RecordTemplate {
  return {
    name: '首页模板',
    version: 1,
    layout_options: {
      document_title: '检测报告',
      subtitle: '',
      suppress_title: true, // 标题只在页眉出，正文不重复
      theme_config: {
        font,
        body_size: '10.5pt',
        margin_v: '2.4cm',
        margin_h: '2.4cm',
        label_weight: 'bold',
        line_gap: '0.5em',
        label_width: '6em', // 字段值对齐到同一制表位
        table_stroke: '0.5pt',
      },
      header_footer: {
        enabled: true,
        show_page_number: true,
        title: '检测报告',
        title_size_first: '24pt',
        title_size: '15pt',
        title_tracking: '0.5em',
        header_rule: false,
        // —— 以下为占位，生成报告时由接口⑦覆盖 ——
        verify_code: 'Report检验码',
        report_no: 'Report报告编号',
        cover_report_no: 'Report报告编号',
        company_name: '公司名称',
        company_address: '公司地址',
        phone: '公司电话',
        fax: '公司传真',
      },
    },
    groups: [
      // ===================== 第 1 页 =====================
      { id: 'g1', label: '单位', layout: 'vertical', hide_title: true, fields: [
        { id: 'f_uname', code: 'unit_name', label: '单位名称', type: 'text' },
        { id: 'f_uaddr', code: 'unit_addr', label: '单位地址', type: 'text' },
      ]},
      sp('sp0', '0.5cm'),
      { id: 'g2', label: '样品', layout: 'vertical', hide_title: true, fields: [
        { id: 'f_note', code: 'sample_note', label: '样品信息声明', type: 'text', hide_label: true, style: { weight: 'bold' } },
        { id: 'f_sname', code: 'sample_name', label: '样品名称', type: 'text' },
        { id: 'f_pdate', code: 'prod_date', label: '生产日期', type: 'text' },
        { id: 'f_supp', code: 'supplier', label: '供 应 商', type: 'text' },
      ]},
      sp('sp0b', '0.3cm'),
      { id: 'g3', label: '接收周期', layout: 'two-col', hide_title: true, fields: [
        { id: 'f_recv', code: 'recv_date', label: '接收日期', type: 'text' },
        { id: 'f_cycle', code: 'test_cycle', label: '检测周期', type: 'daterange',
          date_range: { start: { source: 'order', key: 'test_start' }, end: { source: 'order', key: 'test_end' }, separator: ' ~ ' } },
      ]},
      sp('sp0c', '0.3cm'),
      { id: 'g4', label: '要求结果结论', layout: 'vertical', hide_title: true, fields: [
        { id: 'f_req', code: 'test_req', label: '检测要求', type: 'text' },
        { id: 'f_res', code: 'test_res', label: '检测结果', type: 'text' },
        { id: 'f_con', code: 'test_con', label: '检测结论', type: 'text' },
      ]},
      sp('sp1', '3.4cm'),
      { id: 'g5', label: '签字', layout: 'inline', hide_title: true, fields: [
        { id: 'f_edit', code: 'sig_edit', label: '编 制', type: 'text', signature_line: true },
        { id: 'f_rev',  code: 'sig_rev',  label: '审 核', type: 'text', signature_line: true },
        { id: 'f_appr', code: 'sig_appr', label: '批 准', type: 'text', signature_line: true },
      ]},
      sp('sp2', '1.4cm'),
      { id: 'g6', label: '签发', layout: 'vertical', hide_title: true, style: { margin: { left: '7.6cm' } }, fields: [
        { id: 'f_issue', code: 'issue_date', label: '签发日期', type: 'text' },
      ]},
      sp('sp3', '0.8cm'),
      { id: 'g7', label: '备注一', layout: 'vertical', hide_title: true, style: { size: '8pt' }, fields: [
        { id: 'f_rnote', code: 'report_note', label: '报告备注', type: 'text', hide_label: true },
        { id: 'f_qnote', code: 'qual_note', label: '资质备注', type: 'text', hide_label: true },
      ]},
      // ===================== 第 2 页 =====================
      { id: 'g8', label: '检测结论标签', layout: 'vertical', hide_title: true, page_break_before: true, fields: [
        { id: 'f_cl', code: 'concl_label', label: '检测结论', type: 'text', hide_label: true, style: { weight: 'bold' } },
      ]},
      sp('sp4', '0.2cm'),
      { id: 'g9', label: '检测结论汇总表', layout: 'vertical', hide_title: true, fields: [
        // 标题＝字段 label「检测结论」，hide_label:false 默认显示（居左、跟随模板字体，走标准 figure/wrapFigure）；不需要标题就在「基础」Tab 关「显示为标题」。
        { id: 'f_concl', code: 'conclusion_table', label: '检测结论', type: 'report_conclusion_table', hide_label: false,
          conclusion_table: { columns: ['index', 'project', 'result'],
            column_labels: { project: '检测项目', result: '结论' } } },
      ]},
      sp('sp5', '0.6cm'),
      { id: 'g10', label: '样品描述', layout: 'vertical', hide_title: true, fields: [
        { id: 'f_sdesc', code: 'sample_desc', label: '样品描述', type: 'text' },
      ]},
      sp('sp6', '0.2cm'),
      { id: 'g11', label: '原始样品', layout: 'vertical', hide_title: true, fields: [
        { id: 'f_orig', code: 'orig_sample', label: '原始样品', type: 'report_photo_table', photo_table: { header: '原始样品' } },
      ]},
      sp('sp7', '0.4cm'),
      { id: 'g12', label: '备注二', layout: 'vertical', hide_title: true, style: { size: '9pt', color: '#c00000' }, fields: [
        { id: 'f_note2', code: 'report_remark', label: '备注', type: 'text', hide_label: true },
      ]},
    ],
  } as RecordTemplate;
}

/** 预览/演示用的样例数据（仅本地渲染对照样例；入库不需要） */
export const FRONT_SAMPLE_DATA: Record<string, any> = {
  unit_name: '惠州华阳通用电子有限公司',
  unit_addr: '广东省惠州市东江高新科技产业园上霞北路1号华阳工业园A区2号',
  sample_note: '以下样品信息由委托方提供并负责其真实性',
  sample_name: 'PMMA', prod_date: '2025-12-16', supplier: '恒泽利',
  recv_date: '2025-12-11', test_cycle: '2025-12-11 ~ 2025-12-29',
  test_req: '见后续页。', test_res: '见后续页。', test_con: '见后续页。',
  issue_date: 'yyyy-MM-dd', report_note: '报告备注', qual_note: '资质备注',
  concl_label: '检测结论：',
  sample_desc: '见原始样品照片。',
  report_remark: '备注：本报告C202513070222-G1是对报告C202513070222的修改，删除报告第4页拉伸强度检测方法“GB/T 1040.1-2025”，原报告C202513070222已作废。',
};
