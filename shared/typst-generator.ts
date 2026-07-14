import type { RecordTemplate, FieldGroup, FieldDefinition, DataMatrixValue, DataMatrixConfig, MatrixParameterDef, MatrixSummaryRowDef, MatrixSummaryColDef, CellBinding, StyleOverride } from './types';
import { buildGroupTree } from './group-tree';
import {
  collectTypstDataKeys,
  createEmptyMatrixValue,
  matrixDataKey,
  matrixSummaryFlatKey,
  matrixSummaryColumnFlatKey,
  normalizeMatrixValue,
  applyMatrixCellFormulas,
  applyMatrixSummaryFormulas,
} from './matrix-flatten';

/** 仅出现在数据矩阵「汇总行」中的计算字段，不在分组里再单独渲染 #field */
export function computedCodesOnlyInMatrixSummaries(template: RecordTemplate): Set<string> {
  const s = new Set<string>();
  for (const g of template.groups) {
    for (const f of g.fields) {
      if (f.type !== 'data_matrix' || !f.matrix?.summary_rows?.length) continue;
      for (const sr of f.matrix.summary_rows) {
        if (sr.source_type === 'computed_field' && sr.field_code) s.add(sr.field_code);
      }
    }
  }
  return s;
}

function shouldSkipStandaloneField(template: RecordTemplate, f: FieldDefinition): boolean {
  return f.type === 'computed' && computedCodesOnlyInMatrixSummaries(template).has(f.code);
}

function pdfTitle(template: RecordTemplate): string {
  const t = template.layout_options?.document_title;
  if (typeof t === 'string' && t.trim()) return t.trim();
  return template.name;
}

/** 把 layout_options.theme_config（+ 报告 header_footer）序列化成 Typst dict 字面量。 */
function themeConfigToTypstDict(template: RecordTemplate): string {
  const cfg = template.layout_options?.theme_config;
  const entries: string[] = [];
  if (cfg && typeof cfg === 'object') {
    for (const [key, raw] of Object.entries(cfg as Record<string, any>)) {
      if (raw === undefined || raw === null || raw === '') continue;
      const v = themeConfigValueToTypst(key, raw);
      if (v === null) continue;
      entries.push(`${key}: ${v}`);
    }
  }
  // 报告页眉页脚：layout_options.header_footer 是一组扁平字符串/布尔，序列化成嵌套 dict 传给主题。
  // 普通原始记录模板没有这个键，不受影响。
  const hf = template.layout_options?.header_footer;
  if (hf && typeof hf === 'object') {
    // 这些键是 Typst 长度（字号/字距），按裸长度字面量序列化（不能加引号当字符串）
    const HF_LENGTH_KEYS = new Set(['title_size', 'title_size_first', 'title_tracking',
      // 可调几何（页眉页脚编辑器）：按裸长度序列化（带单位字符串如 "5.3cm"/"0.55em"/"14pt" 直接透传）
      'page_height', 'top_margin', 'bottom_margin', 'hf_line_gap', 'header_gap', 'footer_gap',
      'header_leading', 'footer_leading', 'title_gap', 'title_dx']);  // header_gap/footer_gap=报告编号↔正文 / 正文↔页脚（拆自 hf_line_gap）  // 标题↔校验码间距、标题水平微调（title_align 是字符串 left/center/right，走普通序列化）
    const hfEntries: string[] = [];
    for (const [key, raw] of Object.entries(hf as Record<string, any>)) {
      if (raw === undefined || raw === null) continue;
      if (typeof raw === 'boolean') hfEntries.push(`${key}: ${raw ? 'true' : 'false'}`);
      else if (HF_LENGTH_KEYS.has(key)) {
        const len = lenTypst(raw, 'pt');
        if (len) hfEntries.push(`${key}: ${len}`);
      }
      else hfEntries.push(`${key}: "${String(raw).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`);
    }
    if (hfEntries.length) entries.push(`header_footer: (${hfEntries.join(', ')})`);
  }
  // 受控信息（原始记录顶部行）：受控号 / 颁布日期 / 实施日期，同样序列化成嵌套 dict
  const ctrl = template.layout_options?.controlled;
  if (ctrl && typeof ctrl === 'object' && (ctrl.no || ctrl.issue_date || ctrl.effective_date)) {
    const ce: string[] = [];
    for (const [key, raw] of Object.entries(ctrl as Record<string, any>)) {
      if (raw === undefined || raw === null) continue;
      ce.push(`${key}: "${String(raw).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`);
    }
    if (ce.length) entries.push(`controlled: (${ce.join(', ')})`);
  }
  // 标题 / 副标题样式（用户可调字体/字号/加粗/斜体/颜色/对齐）→ 主题居中标题块按此渲染
  const titleStyle = template.layout_options?.title_style as StyleOverride | undefined;
  const subtitleStyle = template.layout_options?.subtitle_style as StyleOverride | undefined;
  if (titleStyle && Object.keys(titleStyle).length) {
    entries.push(`title_text_args: ${styleOverrideToTextDict(titleStyle)}`);
    if (titleStyle.align) entries.push(`title_align: "${titleStyle.align}"`);
  }
  if (subtitleStyle && Object.keys(subtitleStyle).length) {
    entries.push(`subtitle_text_args: ${styleOverrideToTextDict(subtitleStyle)}`);
    if (subtitleStyle.align) entries.push(`subtitle_align: "${subtitleStyle.align}"`);
  }
  if (!entries.length) return '(:)';
  return `(${entries.join(', ')})`;
}

/**
 * 把 theme_config 一个键值序列化成 Typst 合法字面量。
 * 已知 length 类型的键以 'pt'/'em'/'cm' 自动加单位（如果是裸数字）。
 */
function themeConfigValueToTypst(key: string, raw: any): string | null {
  // length 类（默认单位 pt）
  const ptKeys = ['body_size', 'table_stroke'];
  // length 类（默认 em）。label_width=标签固定列宽（让所有字段值对齐到同一制表位）
  const emKeys = ['line_gap', 'paragraph_gap', 'label_width'];
  // length 类（默认 cm）：页边距填数字时按 cm；margin=四边统一，margin_v=上下，margin_h=左右
  const cmKeys = ['margin', 'margin_v', 'margin_h'];

  if (typeof raw === 'number') {
    if (ptKeys.includes(key)) return `${raw}pt`;
    if (emKeys.includes(key)) return `${raw}em`;
    if (cmKeys.includes(key)) return `${raw}cm`;
    return String(raw);
  }
  if (typeof raw === 'string') {
    // 已带单位（如 "10pt" / "0.65em" / "1.5cm"）的直接原样输出
    if (/^\d+(\.\d+)?(pt|em|cm|mm|in)$/i.test(raw)) return raw;
    // 否则按字符串处理（包含字体名 / 样式名 / margin preset）
    return `"${raw.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  if (typeof raw === 'boolean') return raw ? 'true' : 'false';
  return null;
}

/**
 * 位置标记（编辑器 ⇄ PDF 双向跳转）：
 * 在分区/字段块前注入零尺寸 metadata（实测不产生任何排版间距），
 * 服务端 `typst query "<__fepos__>"` 可取回每个标记的 {kind, code, page, y(pt)}，
 * 前端据此做「点字段 → PDF 滚到对应位置」和「Ctrl+点 PDF → 选中字段」。
 * 粒度：分区级全部有；字段级覆盖 vertical 布局与矩阵（走 generateFieldBlock 的路径）；
 * inline/two-col/grid 内的字段回退到其分区标记。
 */
export const POS_MARKER_LABEL = '__fepos__';
function posMarker(kind: 'group' | 'field', code: string): string {
  return `#context [#metadata((kind: "${kind}", code: "${escapeTypst(code)}", page: here().position().page, y: here().position().y.pt())) <${POS_MARKER_LABEL}>]`;
}

/**
 * 给一段 typst 里所有 posMarker 的 code 前缀上 `${prefix}::`，使【多段拼装】的实例文档（renderContentDoc：
 * 首页 + 多个项目段各自独立 generateTypst）里字段/分区标记不再因跨段 code 撞车而定位到第一处。
 * 编辑器（InstanceEditor）按同样的 `${sectionKey}::${code}` 请求 scrollToMarker，即可精确跳到本段。
 * 只作用于 posMarker 的 metadata（kind/code 组合是它专有），不碰其它内容；单模板编辑器不经此路径、code 不带前缀。
 */
function prefixPosMarkers(src: string, prefix: string): string {
  return src.replace(
    /(#metadata\(\(kind: "(?:group|field)", code: ")((?:[^"\\]|\\.)*)(")/g,
    (_m, a, code, c) => `${a}${prefix}::${code}${c}`
  );
}

// 当前文档默认字体（generateTypst 入口设置）——供 styleSetRules 判断是否需要 faux-bold（仿宋等无粗体字体）
let _docFont = '';
// 当前文档「字段间距」(theme_config.line_gap，typst length 字面量，如 '0.6em')——generateTypst /
// injectReportFieldsIntoTypst 入口设置。供 wrapFigure / captionTypst 作「标题↔表」「备注↔表」距离的缺省，
// 使报告自动表/图在未单独设 label_gap/caption_gap 时随文档/分区字段间距一起疏密（显式值仍优先）。
let _figureGap = '';
/** 无粗体字重的字体（FandolFang / 仿宋 FangSong(_GB2312) / 黑体 SimHei / 楷体 KaiTi 只有 Regular）：
 *  加粗需用描边模拟，否则 weight:bold 无效。Songti SC 有真粗体，不在此列。 */
function isNoBoldFont(f?: string): boolean {
  return !!f && /Fandol|FangSong|SimHei|KaiTi/i.test(f);
}

export function generateTypst(template: RecordTemplate): string {
  _docFont = String((template.layout_options?.theme_config as Record<string, any> | undefined)?.font || '');
  _figureGap = lineGapTypst(template);
  const lines: string[] = [];

  lines.push('#import "@local/record-theme:0.1.0": *');
  lines.push('');
  // __cell 复用主题导出的 multiline，让矩阵/内联单元格里的多行文本也按换行渲染
  lines.push('#let __cell(v) = if v == none or v == "" { "—" } else { multiline(v) }');
  lines.push('');
  const cfgLit = themeConfigToTypstDict(template);
  // 报告 / 首页（有页眉页脚 header_footer）：标题已在【页眉】里出（header_footer.title，默认"检测报告"），
  // 正文【一律不再】渲染自动大标题/副标题——避免一页两个标题。只有普通原始记录（无 header_footer）才在正文出标题/副标题。
  const hf = template.layout_options?.header_footer as { enabled?: boolean } | undefined;
  const hasHeaderFooter = !!hf && (hf as any).enabled !== false;
  // 副标题：普通记录可在标题面板改（layout_options.subtitle）；未设＝默认"广电计量"。报告/首页恒为空＝不显示。
  const subtitleText = hasHeaderFooter ? '' : (template.layout_options?.subtitle ?? '广电计量');
  // 大标题：报告/首页恒空；普通记录支持 suppress_title 显式抑制。
  const docTitle = (hasHeaderFooter || template.layout_options?.suppress_title) ? '' : pdfTitle(template);
  lines.push(`#show: record-theme.with(title: "${escapeTypst(docTitle)}", org: "${escapeTypst(String(subtitleText))}", config: ${cfgLit})`);
  lines.push('');

  lines.push('#let data = (');
  for (const k of collectTypstDataKeys(template)) {
    lines.push(`  ${k}: none,`);
  }
  lines.push(')');
  lines.push('');

  // 嵌套分区：按 group-tree 分桶，子分区嵌在父 #section 体内（父区块样式自然级联）。
  // 用下标循环以支持「模块」：vertical_align 组 + 后续 module_span-1 组作为一个整体锚定/不拆页。
  const tree = buildGroupTree(template.groups);
  let gi = 0;
  while (gi < tree.length) {
    const group = tree[gi].group;
    if (group.page_break_before) lines.push('#pagebreak(weak: true)');
    // 垂直分布（整页）：弹性间距必须在「页流层」发，不能埋进 #block/#section（块内 1fr 不撑开）。
    // center=上下各 1fr（内容居中）/ bottom=上方 1fr（钉底）/ top|缺省=不动。
    const vAlign = group.style?.vertical_align;
    const isAnchored = vAlign === 'center' || vAlign === 'bottom';
    // 模块跨组数（仅锚定组生效）：本组 + 后续 span-1 组当作一个模块整体
    const span = isAnchored ? Math.max(1, Math.min(group.module_span || 1, tree.length - gi)) : 1;
    if (isAnchored) lines.push('#v(1fr)');
    // 渲染模块内各组到一个缓冲；keep_together 时整块不拆页
    const moduleStr = tree.slice(gi, gi + span).map(e => renderGroupEntry(e, template)).join('\n');
    if (group.style?.keep_together) {
      lines.push('#block(breakable: false)[');
      lines.push(moduleStr);
      lines.push(']');
    } else {
      lines.push(moduleStr);
    }
    // 钉底偏移：模块从页底再抬 offset（给印章/二维码留位）
    const vOff = lenTypst(group.style?.vertical_offset, 'pt');
    if (vAlign === 'bottom' && vOff) lines.push(`#v(${vOff})`);
    if (vAlign === 'center') lines.push('#v(1fr)');  // 居中：内容后再补一段 1fr，与前段对称
    lines.push('');
    gi += span;
  }

  return lines.join('\n');
}

/** 渲染一个分区条目（含子分区）为 marker + #block/#section 字符串。不含本组 page_break_before（由外层循环/模块处理）。 */
function renderGroupEntry(entry: { group: FieldGroup; children: FieldGroup[] }, template: RecordTemplate): string {
  const { group, children } = entry;
  const out: string[] = [posMarker('group', group.id)];
  const parts: string[] = [applyBlockStyle(generateGroupContent(group, template), group.style)];
  for (const child of children) {
    if (child.page_break_before) parts.push('#pagebreak(weak: true)');
    parts.push(posMarker('group', child.id));
    if (!child.hide_title) {
      // 子分区标题：faux-bold 感知 + 可选 title_style（与顶级分区同口径）；标题↔内容距离＝title_gap（缺省 0.4em）
      const childTitleGap = lenTypst(child.title_gap, 'pt') || '0.4em';
      parts.push(`#block(sticky: true, above: 0.8em, below: ${childTitleGap})[#text(${titleTextArgs(child.title_style, '1.05em')})[${escapeTypst(child.label)}]]`);
    }
    parts.push(applyBlockStyle(generateGroupContent(child, template), child.style));
  }
  const groupBody = parts.filter(Boolean).join('\n');
  if (group.hide_title) {
    // width: 100% 关键——缺省 #block 收缩到内容宽度，内部 #align(right/center) 就没有可对齐的空间
    // （表现为"对齐只在左半/无效"）。撑满整页宽后，分区级左/中/右对齐才能跨整页生效。
    // spacing：相邻【无标题分区】之间的间距＝字段间距（分区 block_spacing 覆盖、否则文档 line_gap）。
    //   无标题分区视觉上是连续正文（如项目报告：检测方法/结果表/图片/设备 各独占一个无标题分区），
    //   裸 #block 默认走 Typst 块距 → "分区内字段间距大、分区之间(图↔表)间距小"。设 spacing 让二者一致。
    //   有标题分区(#section)走 v(paragraph_gap)＝「分组间距」，是另一档（有可见标题分隔），不在此处理。
    const hideTitleGap = lenTypst(group.style?.block_spacing, 'pt') || lineGapTypst(template);
    out.push(`#block(width: 100%, spacing: ${hideTitleGap})[`, groupBody, ']');
  } else {
    // 顶级分区标题：未设 title_style → 主题默认（faux-bold 感知）；设了 → 传生成器算好的 title_args
    const titleArgs = group.title_style ? `, title_args: (${titleTextArgs(group.title_style, '1.15em')})` : '';
    // 标题↔内容距离：title_gap（缺省走主题 0.4em）
    const titleGapArg = lenTypst(group.title_gap, 'pt') ? `, title_gap: ${lenTypst(group.title_gap, 'pt')}` : '';
    out.push(`#section("${escapeTypst(group.label)}"${titleArgs}${titleGapArg})[`, groupBody, ']');
  }
  return out.join('\n');
}

function generateGroupContent(group: FieldGroup, template: RecordTemplate): string {
  // 分区内字段/图/表之间的统一间距：分区「字段间距」(group.block_spacing) 已设时由 applyBlockStyle 的
  // #set block 负责；未设时这里补文档「字段间距」(line_gap)，让图/表与文字字段统一响应（含图片记录分区）。
  const sectionGap = group.style?.block_spacing == null ? `#set block(spacing: ${lineGapTypst(template)})\n` : '';
  // section_role='images' 且确有【原始记录 image 字段】时，走"图片表格"渲染（每个 image 字段一张表，可分页）。
  // ⚠️ 项目报告的「图片记录」分区是 report_image_gallery（非 image）且也被预设成 section_role='images'——
  //    若不加 image 字段判断会落到 generateImageGroupContent 返回空串 → 空 #section[] → 整个图片分区不渲染。
  //    故仅在含 image 字段时才走此路；report_image_gallery 落到下方常规路径出锚点、由报告渲染期替换。
  //    sectionGap 前置：让多张图片之间的间距也随文档/分区「字段间距」变（原先此早返回绕过、图片间距冻结）。
  if (group.section_role === 'images' && group.fields.some(f => f.type === 'image')) {
    // 图片分区：image 字段走图片表渲染（__IMAGE_GROUP__ 锚点，数据期整体替换）；
    // 同分区里的【非图片字段】（说明文本 / 检测周期 等）按常规渲染，放在图片块【前/后】——
    // 必须落在 __IMAGE_GROUP__ 锚点之外，否则数据期替换会把它们一起吞掉。
    const imgGap = lenTypst(group.style?.block_spacing, 'pt') || undefined;
    const firstImg = group.fields.findIndex(f => f.type === 'image');
    const nonImg = (fs: FieldDefinition[]) => fs.filter(f => f.type !== 'image' && !shouldSkipStandaloneField(template, f));
    const pre = nonImg(group.fields.slice(0, firstImg));
    const post = nonImg(group.fields.slice(firstImg + 1));
    // 图片分区里的非图片【普通字段】也要吃本分区的「字段值对齐」(group.label_width)——否则分区设了「紧贴」却不生效。
    const preBlock = pre.length ? generateVertical(pre, template, imgGap, group.label_width) : '';
    const postBlock = post.length ? generateVertical(post, template, imgGap, group.label_width) : '';
    return [sectionGap + preBlock, generateImageGroupContent(group), postBlock].filter(Boolean).join('\n');
  }
  // 签名栏：组内有 signature_line 字段 → 这些字段渲染成等分下划线签名行（编制/审核/批准），
  // 其余字段（签发日期/备注等）按竖排正常渲染在签名行下方——使「签字+签发+备注」可同处一个分区。
  if (group.fields.some(f => f.signature_line)) {
    const sigFields = group.fields.filter(f => f.signature_line);
    const others = group.fields.filter(f => !f.signature_line);
    const parts = [generateSignatureRow(sigFields, template)];
    if (others.length) parts.push(generateVertical(others, template, lenTypst(group.style?.block_spacing, 'pt') || undefined, group.label_width));
    return parts.filter(Boolean).join('\n');
  }

  // 把字段切成「连续块」：data_matrix 独立一块（强制全宽 vertical），
  // 其余连续字段合并成一块按分区 layout 渲染。
  type Chunk =
    | { kind: 'matrix'; field: FieldDefinition }
    | { kind: 'plain'; fields: FieldDefinition[] };

  const chunks: Chunk[] = [];
  let buffer: FieldDefinition[] = [];
  const flushPlain = () => {
    if (buffer.length) {
      chunks.push({ kind: 'plain', fields: buffer });
      buffer = [];
    }
  };
  // 多列布局（grid/two-col）：忽略 spacer（版式留白是为竖排设计的；在多列里它会把字段流切成
  // 单字段块、看起来仍是竖排——违背"把字段都排进列"的本意。列间距由 grid 的 row-gutter 统一给）。
  const isMultiCol = group.layout === 'grid' || group.layout === 'two-col';
  // 多列行间距：分区「格式·字段间距」(group.style.block_spacing) 驱动 grid 的 row-gutter，
  // 让"在分区格式里调间距"对多列也生效（否则只认写死的文档行距）。空＝走文档行距。
  const multiColRowGutter = lenTypst(group.style?.block_spacing, 'pt') || undefined;
  // 竖排字段间距：同一个 block_spacing 也驱动普通 #field 的上下 gap（与图/表统一响应分区间距）
  const fieldGap = multiColRowGutter;
  // 分区级「值对齐」覆盖（仅竖排 #field 有效；多列已是行内紧贴）：透传给 #field 的 label_width 参数
  const labelWidth = group.label_width;
  for (const f of group.fields) {
    if (shouldSkipStandaloneField(template, f)) continue;
    if (f.type === 'spacer') {
      if (isMultiCol) continue;          // 多列：跳过留白，让字段连续流入列
      flushPlain();                       // 竖排/表格/横排：spacer 独占整行渲染成 #v
      chunks.push({ kind: 'matrix', field: f });
    } else if (f.type === 'data_matrix') {
      flushPlain();
      chunks.push({ kind: 'matrix', field: f });   // 数据矩阵永远独占整行（不能塞进 grid 格）
    } else {
      buffer.push(f);
    }
  }
  flushPlain();

  const parts: string[] = [];
  for (const ch of chunks) {
    if (ch.kind === 'matrix') {
      // 矩阵：强制独占整行，不参与分区 layout
      parts.push(generateFieldBlock(ch.field, template));
      continue;
    }
    switch (group.layout) {
      case 'vertical':
        parts.push(generateVertical(ch.fields, template, fieldGap, labelWidth)); break;
      case 'inline':
        parts.push(generateInline(ch.fields, template)); break;
      case 'table':
        parts.push(generateTable(group, ch.fields, template)); break;
      case 'two-col':
        parts.push(generateTwoCol(ch.fields, template, multiColRowGutter, group.style?.align)); break;
      case 'grid':
        parts.push(generateGrid(ch.fields, template, group.grid_columns, multiColRowGutter, group.style?.align)); break;
      default:
        parts.push(generateVertical(ch.fields, template, fieldGap, labelWidth));
    }
  }
  // 图/表（矩阵 / 报告自动表 / 图片）之间、及图↔表的间距：文字字段靠 #field 的 gap(=line_gap) 撑开，
  // 但图/表是裸 #block/#table、默认走 Typst 块间距、不认文档「字段间距」→ sectionGap（见函数顶部）补一条
  // #set block(spacing:)＝文档/分区「字段间距」，让图/表与文字字段统一响应。
  return sectionGap + parts.filter(Boolean).join('\n');
}

function generateFieldBlock(f: FieldDefinition, template: RecordTemplate, fieldGap?: string, labelWidth?: string): string {
  const body = generateFieldBlockInner(f, template, fieldGap, labelWidth);
  if (!body) return body;
  // 字段级位置标记：放在所有锚点（__MATRIX_BLOCK__/__REPORT_*__/__RICH__）之前，数据期替换不会吞掉它。
  // page_break_before：本字段前强制分页，使其从新一页开始（pagebreak 在 marker 之前，marker 落到新页）。
  const pb = f.page_break_before ? '#pagebreak()\n' : '';
  return `${pb}${posMarker('field', f.code)}\n${body}`;
}

function generateFieldBlockInner(f: FieldDefinition, template: RecordTemplate, fieldGap?: string, labelWidth?: string): string {
  if (shouldSkipStandaloneField(template, f)) return '';
  // 版式·间隔：纯排版空白块（无数据）。固定高度的 #v——块/分区之间留白（Word 段前段后/敲回车的正解）
  if (f.type === 'spacer') {
    return `#v(${lenTypst(f.spacer_height, 'pt') || '0.5cm'})`;
  }
  if (f.type === 'data_matrix') {
    if (!f.matrix) return `  #field("${escapeTypst(f.label)}", data.${f.code})`;
    const empty: DataMatrixValue = createEmptyMatrixValue(f.matrix);
    return embedDataMatrixTypst(f, empty, true, template);
  }
  if (f.type === 'free_grid') {
    // F0：统一自由网格。模板期渲染固定文字 + 表头 + 合并（录入格暂空）；
    // 带数据渲染（generateTypstWithData）按锚点替换成带录入值的版本。
    return `// __FREE_GRID__:${f.code}__
${renderFreeGridTypst(f, f.free_table || { columns: [], rows: [], cells: {} })}
// __FREE_GRID_END__:${f.code}__`;
  }
  // 报告专属自动表：用锚点占位，generateTypstWithData / renderReportTypst 阶段替换
  if (f.type === 'report_conclusion_table') {
    return `// __REPORT_CONCLUSION__:${f.code}__
#text(fill: gray)[（检测结论汇总表 — 生成报告时按订单项目自动展开）]
// __REPORT_CONCLUSION_END__:${f.code}__`;
  }
  if (f.type === 'report_result_table') {
    return `// __REPORT_RESULT__:${f.code}__
#text(fill: gray)[（检测结果表 — 生成报告时按单元格绑定填充）]
// __REPORT_RESULT_END__:${f.code}__`;
  }
  if (f.type === 'report_equipment_table') {
    return `// __REPORT_EQUIPMENT__:${f.code}__
#text(fill: gray)[（设备信息表 — 生成报告时自动汇集）]
// __REPORT_EQUIPMENT_END__:${f.code}__`;
  }
  if (f.type === 'report_image_gallery') {
    return `// __REPORT_IMAGES__:${f.code}__
#text(fill: gray)[（图片记录 — 生成报告时从原始记录的图片字段抓取）]
// __REPORT_IMAGES_END__:${f.code}__`;
  }
  if (f.type === 'report_photo_table') {
    return `// __REPORT_PHOTO_TABLE__:${f.code}__
#text(fill: gray)[（原样照片表 — 文员在编辑首页时上传照片）]
// __REPORT_PHOTO_TABLE_END__:${f.code}__`;
  }
  if (f.type === 'report_sample_table') {
    return `// __REPORT_SAMPLE_TABLE__:${f.code}__
#text(fill: gray)[（样品信息表 — 生成报告时按委托单样品自动列出）]
// __REPORT_SAMPLE_TABLE_END__:${f.code}__`;
  }
  // 富文本字段：留锚点，数据期（generateTypstWithData / injectReportFieldsIntoTypst）替换为转换后的 Typst markup
  if (f.rich) {
    return `// __RICH__:${f.code}__\n#block[#text(fill: gray)[（富文本）]]\n// __RICH_END__:${f.code}__`;
  }
  // hide_label：渲染成"纯文本块"（无「标签：」前缀）——用于报告里的自由段落 / 备注 / 声明。
  // 空值（含占位符 —）不渲染：避免空的资质备注/声明留下 "—" 或空块。
  if (f.hide_label) {
    // 无字段名（声明/备注/段落）：只渲染值，value_style 行内套 text()
    const vDict = fieldPartTextDict(f.value_style, true);
    const val = vDict === '(:)' ? `#multiline(data.${f.code})` : `#text(..${vDict})[#multiline(data.${f.code})]`;
    const body = `  #if data.${f.code} == none or data.${f.code} == "" or data.${f.code} == "—" [] else [#block[${val}]]`;
    return applyBlockStyle(body, f.style);
  }
  const unitArg = f.unit ? `, unit: "${escapeTypst(f.unit)}"` : '';
  // 字段名（标签）加粗：label_style.weight 优先（feed 主题 faux-bold），回退存量 label_bold，覆盖文档级 label_weight
  const labelBold = f.label_style?.weight === 'bold' ? true
    : f.label_style?.weight === 'regular' ? false
    : f.label_bold;
  const labelBoldArg = labelBold === undefined ? '' : `, label_bold: ${labelBold ? 'true' : 'false'}`;
  // 字段名/字段值的独立文字样式（P14·14.2）：label 一侧 weight 已走 label_bold，故 includeWeight=false
  const labelDict = fieldPartTextDict(f.label_style, false);
  const valueDict = fieldPartTextDict(f.value_style, true);
  const labelArgsArg = labelDict === '(:)' ? '' : `, label_args: ${labelDict}`;
  const valueArgsArg = valueDict === '(:)' ? '' : `, value_args: ${valueDict}`;
  // 字段间距（#field 块上下间距）。优先级：字段级 field_gap ＞ 分区 block_spacing(fieldGap) ＞ 文档级 line_gap。
  // 【关键修复·防泄漏】始终显式传 gap＝本模板自身的 line_gap；否则项目段 #field 不带 gap 时会落到
  //   首页那条 #show 主题里的 line_gap（renderContentDoc 全文共用首页 #show），导致"只在首页设的字段间距泄漏到所有项目"。
  const effGap = lenTypst(f.field_gap, 'pt') || fieldGap || lineGapTypst(template);
  const gapArg = `, gap: ${effGap}`;
  // 字段名↔字段值的"值对齐"(label_width，制表位宽)。优先级：分区 group.label_width ＞ 本模板 label_width ＞ none(紧贴)。
  // 【关键修复·防泄漏】始终显式传 label_width＝本模板自身值；否则项目段 #field 不带 label_width 时会落到首页那条
  //   #show 主题配置里的 label_width（renderContentDoc 全文共用首页 #show），导致"只在首页设的字段名↔字段值间距泄漏到所有项目"。
  const effLabelWidth = labelWidth !== undefined ? labelWidth : labelWidthTypst(template);
  const labelWidthArg = effLabelWidth === 'none' ? ', label_width: none'
    : `, label_width: ${lenTypst(effLabelWidth, 'em') || effLabelWidth}`;
  const body = `  #field("${escapeTypst(f.label)}", data.${f.code}${unitArg}${labelBoldArg}${labelArgsArg}${valueArgsArg}${gapArg}${labelWidthArg})`;
  // 字段级块样式（段前后/对齐/缩进，作用于普通 #field；内联/矩阵走区块级级联）
  return f.style ? applyBlockStyle(body, f.style) : body;
}

function generateVertical(fields: FieldDefinition[], template: RecordTemplate, fieldGap?: string, labelWidth?: string): string {
  return fields.map(f => generateFieldBlock(f, template, fieldGap, labelWidth)).filter(Boolean).join('\n');
}

/** 签名栏：每个字段 → 「标签 ＿＿＿」一格，组内多个等分整行；值（签名/日期）在下划线上居中。 */
function generateSignatureRow(fields: FieldDefinition[], template: RecordTemplate): string {
  const vis = fields.filter(f => !shouldSkipStandaloneField(template, f));
  if (!vis.length) return '';
  const lw = labelWeightTypst(template);
  // 列：每个签名 = (标签 auto) + (下划线 1fr)
  const colSpec = vis.map(() => 'auto, 1fr').join(', ');
  const cells = vis.map(f => {
    const label = escapeTypst(f.label);
    const onLine = `#if data.${f.code} == none or data.${f.code} == "" [ ] else [#multiline(data.${f.code})]`;
    // 下划线整体下移 3pt（move dy），让横线比标签基线稍低一点
    const lblStroke = lw === '700' ? fauxBoldStroke(f.label_style?.font) : '';
    return `text(weight: ${lw}${lblStroke})[${label}], move(dy: 3pt, box(width: 100%, height: 1.5em, stroke: (bottom: 0.6pt), inset: (bottom: 2pt))[#align(center + bottom)[${onLine}]])`;
  }).join(',\n    ');
  return `  #grid(columns: (${colSpec}), column-gutter: 10pt, align: bottom,\n    ${cells}\n  )`;
}

function generateInline(fields: FieldDefinition[], template: RecordTemplate): string {
  const visible = fields.filter(f => !shouldSkipStandaloneField(template, f));
  if (!visible.length) return '';
  const args = visible
    .map(f => `("${escapeTypst(f.label)}", data.${f.code}, "${f.unit || ''}")`)
    .join(', ');
  // 显式传 gap＝本模板自身 line_gap，避免项目段两列字段落到首页 #show 的 line_gap（防泄漏，与 #field 同口径）。
  return `  #inline-fields(${args}, gap: ${lineGapTypst(template)})`;
}

function generateTable(group: FieldGroup, fields: FieldDefinition[], template: RecordTemplate): string {
  const vis = fields.filter(f => !shouldSkipStandaloneField(template, f));
  if (!vis.length) return '';
  const lw = labelWeightTypst(template);
  const lines: string[] = [];
  lines.push(`  #table(columns: (auto, 1fr), stroke: 0.5pt, inset: 6pt,`);
  // 表头：缺省无表头（不再硬塞"项目|值"）；table_header='custom' 时用 columns 两列标题
  if (group.table_header === 'custom') {
    const cols = group.columns && group.columns.length >= 2 ? group.columns : ['项目', '值'];
    lines.push(`    table.header([*${escapeTypst(cols[0])}*], [*${escapeTypst(cols[1])}*]),`);
  }
  for (const f of vis) {
    // 字段名/字段值各自样式（P14）+ 多行换行（multiline），与普通字段口径一致
    const labelBold = f.label_style?.weight === 'bold' ? true
      : f.label_style?.weight === 'regular' ? false : f.label_bold;
    const effLw = labelBold === true ? '700' : labelBold === false ? '400' : lw;
    const labelDict = fieldPartTextDict(f.label_style, false);
    const valueDict = fieldPartTextDict(f.value_style, true);
    const labelArgs = labelDict === '(:)' ? '' : `, ..${labelDict}`;
    const unit = f.unit ? ` + " ${escapeTypst(f.unit)}"` : '';
    const valInner = `#if data.${f.code} == none or data.${f.code} == "" [] else [#multiline(str(data.${f.code})${unit})]`;
    const valCell = valueDict === '(:)' ? valInner : `#text(..${valueDict})[${valInner}]`;
    const labelStroke = effLw === '700' ? fauxBoldStroke(f.label_style?.font) : '';
    lines.push(`    [#text(weight: ${effLw}${labelStroke}${labelArgs})[${escapeTypst(f.label)}]], [${valCell}],`);
  }
  lines.push(`  )`);
  return lines.join('\n');
}

function generateTwoCol(fields: FieldDefinition[], template: RecordTemplate, rowGutter?: string, groupAlign?: 'left' | 'center' | 'right'): string {
  const visible = fields.filter(f => !shouldSkipStandaloneField(template, f));
  if (!visible.length) return '';
  return renderMultiCol(visible, template, 2, '24pt', rowGutter, groupAlign);
}

function generateGrid(fields: FieldDefinition[], template: RecordTemplate, gridColumns?: number, rowGutter?: string, groupAlign?: 'left' | 'center' | 'right'): string {
  const visible = fields.filter(f => !shouldSkipStandaloneField(template, f));
  if (!visible.length) return '';
  // 列数：显式 grid_columns 优先（2-4），否则按字段数自适应（≤4）
  const colCount = gridColumns && gridColumns >= 1
    ? Math.min(Math.max(Math.round(gridColumns), 1), 4)
    : Math.min(Math.max(visible.length, 1), 4);
  return renderMultiCol(visible, template, colCount, '16pt', rowGutter, groupAlign);
}

/**
 * grid cell 内字段：不调用主题的 #field（避免它内部 block 的 above/below 与 row-gutter 叠加导致重叠），
 * 改为 inline 表达。通过 context 读 theme state 的 label_weight，与 #field 视觉一致。
 */
function labelWeightTypst(template: RecordTemplate): string {
  const cfg = template.layout_options?.theme_config as Record<string, any> | undefined;
  const raw = cfg?.label_weight;
  return raw === 'regular' ? '400' : '700';
}

/** 多列格子内的字段内容（label：value，含名/值样式；不含外层 [] 与对齐）。 */
function cellFieldInner(f: FieldDefinition, template: RecordTemplate): string {
  const label = escapeTypst(f.label);
  const unit = f.unit ? ` + " ${escapeTypst(f.unit)}"` : '';
  const lw = labelWeightTypst(template);
  // 字段名加粗：label_style.weight 优先 → 存量 label_bold → 文档默认 label_weight
  const labelBold = f.label_style?.weight === 'bold' ? true
    : f.label_style?.weight === 'regular' ? false
    : f.label_bold;
  const effLw = labelBold === true ? '700' : labelBold === false ? '400' : lw;
  // 字段名/字段值的独立文字样式（P14；两列/网格格子里也生效，不再被忽略）
  const labelDict = fieldPartTextDict(f.label_style, false);
  const valueDict = fieldPartTextDict(f.value_style, true);
  const labelArgs = labelDict === '(:)' ? '' : `, ..${labelDict}`;
  const rawVal = `#if data.${f.code} == none or data.${f.code} == "" { "______" } else { str(data.${f.code})${unit} }`;
  const valueTxt = valueDict === '(:)' ? rawVal : `#text(..${valueDict})[${rawVal}]`;
  const labelStroke = effLw === '700' ? fauxBoldStroke(f.label_style?.font) : '';
  return `#text(weight: ${effLw}${labelStroke}${labelArgs})[${label}]：${valueTxt}`;
}

/**
 * 多列（grid/two-col）渲染：普通字段流入等宽列；**设了中/右对齐的字段（字段级优先，否则继承分区级
 * groupAlign）整页对齐**——做法是把它从网格里"拎出来"作为整行独立块 `#align(...)[...]`（前后网格各自闭合），
 * 这样对齐跨整页而非困在 1fr 列里（修"多列对齐只在半页"的 bug）。colspan 跨列会因落在行中而报错，故不用。
 */
function renderMultiCol(
  visible: FieldDefinition[], template: RecordTemplate, colCount: number,
  columnGutter: string, rowGutter: string | undefined, groupAlign?: 'left' | 'center' | 'right'
): string {
  const lg = rowGutter || lineGapTypst(template);
  const colSpec = Array(colCount).fill('1fr').join(', ');
  const out: string[] = [];
  let cells: string[] = [];
  const flushGrid = () => {
    if (cells.length) {
      out.push(`  #grid(columns: (${colSpec}), column-gutter: ${columnGutter}, row-gutter: ${lg},\n    ${cells.join(',\n    ')}\n  )`);
      cells = [];
    }
  };
  for (const f of visible) {
    const fieldAlign = (f.style?.align === 'left' || f.style?.align === 'center' || f.style?.align === 'right')
      ? f.style.align : undefined;
    const al = fieldAlign ?? groupAlign;
    if (al === 'center' || al === 'right') {
      flushGrid();
      out.push(`  #align(${al})[${cellFieldInner(f, template)}]`);
    } else {
      cells.push(`[${cellFieldInner(f, template)}]`);
    }
  }
  flushGrid();
  return out.join('\n');
}

function summaryRowsToTypst(
  matrixCode: string,
  params: MatrixParameterDef[],
  summaries: MatrixSummaryRowDef[],
  /** 录入时选定的表头备注（note_options 模式），key = summary row id */
  noteOverrides?: Record<string, string>
): string[] {
  const n = params.length;
  if (n === 0) return [];
  const lines: string[] = [];
  for (const sr of summaries) {
    // 统一表头模型：标签 + 备注（括号显示，如「判定要求 (客户要求)」）
    const note = noteOverrides?.[sr.id] ?? sr.note ?? '';
    const label = escapeTypst(sr.label) + (note ? ` (${escapeTypst(note)})` : '');

    // 逐列（每列独立一格，不 colspan）：per_column_aggregate（自动统计）或 per_column 手填行——
    // 二者展平到同一键 matrixSummaryColumnFlatKey，渲染一致。
    if (sr.source_type === 'per_column_aggregate' || sr.per_column) {
      const cells = params.map(p => {
        const dk = matrixSummaryColumnFlatKey(matrixCode, sr.id, p.code);
        // 空格默认显示横杠"—"（只有个别列填值/配公式时，其余列出 —）
        return `[#if data.${dk} == none or data.${dk} == "" { "—" } else { __cell(data.${dk}) }]`;
      }).join(', ');
      lines.push(`      [${label}], ${cells},`);
      continue;
    }

    // 其他模式：值跨 value_colspan 列
    const span = Math.min(Math.max(sr.value_colspan ?? n, 1), n);
    let inner: string;
    if (sr.source_type === 'literal') {
      inner = `#str(${toTypstLiteral(sr.literal ?? '')})`;
    } else if (sr.source_type === 'formula' && sr.formula) {
      const dk = matrixSummaryFlatKey(matrixCode, sr.id);
      inner = `#__cell(data.${dk})`;
    } else if (sr.source_type === 'input_text') {
      const dk = matrixSummaryFlatKey(matrixCode, sr.id);
      const unitSuffix = sr.unit ? ` + " ${escapeTypst(sr.unit)}"` : '';
      inner = `#if data.${dk} == none or data.${dk} == "" { "______" } else { str(data.${dk})${unitSuffix} }`;
    } else if (sr.source_type === 'input_number') {
      const dk = matrixSummaryFlatKey(matrixCode, sr.id);
      const unitSuffix = sr.unit ? ` + " ${escapeTypst(sr.unit)}"` : '';
      inner = `#if data.${dk} == none or data.${dk} == "" { "______" } else { str(data.${dk})${unitSuffix} }`;
    } else if (sr.source_type === 'input_choice') {
      const dk = matrixSummaryFlatKey(matrixCode, sr.id);
      inner = `#__cell(data.${dk})`;
    } else if (sr.field_code) {
      inner = `#__cell(data.${sr.field_code})`;
    } else {
      inner = `#str("")`;
    }
    const colspan = span >= n ? n : span;
    const tail = span >= n ? '' : ', ' + Array.from({ length: n - span }, () => '[]').join(', ');
    lines.push(`      [${label}], table.cell(colspan: ${colspan})[${inner}]${tail},`);
  }
  return lines;
}

/** 解析 theme_config.line_gap 为 typst length 字面量（grid row-gutter 等需要 length 而非 content） */
function lineGapTypst(template: RecordTemplate): string {
  const cfg = template.layout_options?.theme_config as Record<string, any> | undefined;
  const raw = cfg?.line_gap;
  if (raw === undefined || raw === null || raw === '') return '0.6em';
  if (typeof raw === 'number') return `${raw}em`;
  if (typeof raw === 'string') {
    if (/^\d+(\.\d+)?(pt|em|cm|mm|in)$/i.test(raw)) return raw;
  }
  return '0.6em';
}

/** 解析 theme_config.label_width 为 #field 的 label_width 实参；未设＝'none'（字段名↔字段值紧贴/行内，本模板自身默认）。 */
function labelWidthTypst(template: RecordTemplate): string {
  const cfg = template.layout_options?.theme_config as Record<string, any> | undefined;
  const raw = cfg?.label_width;
  if (raw === undefined || raw === null || raw === '' || raw === 'none') return 'none';
  if (typeof raw === 'number') return `${raw}em`;
  if (typeof raw === 'string' && /^\d+(\.\d+)?(pt|em|cm|mm|in)$/i.test(raw)) return raw;
  return 'none';
}

/** 解析 theme_config 中的 table_stroke 为 typst stroke 字面量。 */
function tableStrokeTypst(template: RecordTemplate): string {
  const cfg = template.layout_options?.theme_config as Record<string, any> | undefined;
  const raw = cfg?.table_stroke;
  if (raw === 0 || raw === '0' || raw === '0pt' || raw === 'none') return 'none';
  // 缺省 0.5pt
  if (raw === undefined || raw === null || raw === '') return '0.5pt';
  if (typeof raw === 'number') return `${raw}pt`;
  if (typeof raw === 'string') {
    if (/^\d+(\.\d+)?(pt|em|cm|mm|in)$/i.test(raw)) return raw;
    return '0.5pt';
  }
  return '0.5pt';
}

/** @param forTemplate — 为 true 时带注释锚点，供 generateTypstWithData 替换整块 */
/**
 * P-Map-13b：试样为列（转置）渲染。底层存储不变（试样仍是 s{idx} 维、参数仍是 parameters[]，
 * 展平键完全一致），仅把版式转置：参数→行、试样→列；汇总列→底部行、汇总行→右侧列。
 * 取数键与行模式逐一对应，故录入/绑定/报告全部沿用。多级参数分组 / 行分组场景暂不转置（调用方已 gate，回退行模式）。
 */
function embedDataMatrixColAxisTypst(field: FieldDefinition, cfg: DataMatrixConfig, v: DataMatrixValue, template: RecordTemplate, forTemplate: boolean): string {
  const params = v.parameters.length ? v.parameters : cfg.parameters;
  const sids = v.sample_ids.length ? v.sample_ids : createEmptyMatrixValue(cfg).sample_ids;
  const summaryCols = cfg.summary_cols || [];
  const summaryRows = cfg.summary_rows || [];
  const code = field.code;
  const start = forTemplate ? `// __MATRIX_BLOCK__:${field.code}__\n` : '';
  const end = forTemplate ? `\n// __MATRIX_END__:${field.code}__` : '';

  // 列头＝试样标签（+录入备注）；左列＝参数标签（+单位）；底部行＝汇总列标签；右列头＝汇总行标签
  const sidHeader = (sid: string, idx: number) => {
    let label = v.sample_labels?.[sid] ?? cfg.default_sample_labels?.[idx] ?? `${cfg.row_header_prefix || '试样'} ${idx + 1}`;
    const note = v.sample_note_overrides?.[sid] ?? cfg.sample_notes?.[idx]?.note ?? '';
    if (note) label = `${label} (${note})`;
    return `*${escapeTypst(label)}*`;
  };
  const paramLabel = (p: MatrixParameterDef) => {
    const u = v.parameter_unit_overrides?.[p.code] ?? p.unit ?? '';
    return `*${escapeTypst(p.label)}${u ? ` (${escapeTypst(u)})` : ''}*`;
  };
  const sumColLabel = (sc: MatrixSummaryColDef) => {
    const u = v.sumcol_unit_overrides?.[sc.id] ?? sc.unit ?? '';
    return `*${escapeTypst(sc.label)}${u ? ` (${escapeTypst(u)})` : ''}*`;
  };
  const sumRowLabel = (sr: MatrixSummaryRowDef) => {
    const note = v.summary_note_overrides?.[sr.id] ?? sr.note ?? '';
    return `*${escapeTypst(sr.label)}${note ? ` (${escapeTypst(note)})` : ''}*`;
  };
  // 单值内容（input/formula/literal/computed 通用）；逐格内容（空显示 —）
  const valInner = (dk: string, st: string, unit?: string, literal?: string, fieldCode?: string): string => {
    if (st === 'literal') return `#str(${toTypstLiteral(literal ?? '')})`;
    if (st === 'input_text' || st === 'input_number') {
      const u = unit ? ` + " ${escapeTypst(unit)}"` : '';
      return `#if data.${dk} == none or data.${dk} == "" { "______" } else { str(data.${dk})${u} }`;
    }
    if (st === 'computed_field' && fieldCode) return `#__cell(data.${fieldCode})`;
    return `#__cell(data.${dk})`;  // formula / input_choice / per_*_aggregate
  };
  const perCellInner = (dk: string) => `#if data.${dk} == none or data.${dk} == "" { "—" } else { __cell(data.${dk}) }`;

  // 转置版式（参数→行、试样→列）汇总【按逻辑维度真正转置】，取值键与"试样为行"完全一致(canonical)：
  //   · 统计行(per_column，按参数)  → 右侧列：每参数行一格 = summary__rowId__paramCode
  //   · 汇总行(跨参数单值)         → 右侧列：rowspan 整列一个值 = summary__rowId
  //   · 统计列(per_row，按试样)    → 底部行：每试样列一格 = sumcol__colId__sid
  //   · 汇总列(跨试样单值)         → 底部行：colspan 整行一个值 = sumcol__colId
  // （旧实现把汇总列/行原位摆放、且取键对调，导致录入存的 canonical 键读不到→转置布局汇总恒空；此处修正）
  const isPerColRow = (sr: MatrixSummaryRowDef) =>
    sr.source_type === 'per_column_aggregate' ||
    (sr.per_column === true && ['input_text', 'input_number', 'input_choice'].includes(sr.source_type));
  const axisW = cfg.axis_col_width ? colWidthSpec(cfg.axis_col_width) : 'auto';
  const colspec = [axisW, ...sids.map(() => '1fr'), ...summaryRows.map(() => 'auto')].join(', ');
  const alignKw = (cfg.cell_align || 'center') + ' + horizon';

  const cornerText = cfg.axis_header ?? '试样';
  const headerInner = [
    `[${cornerText ? `*${escapeTypst(cornerText)}*` : ''}]`,
    ...sids.map((sid, i) => `[${sidHeader(sid, i)}]`),
    ...summaryRows.map(sr => `[${sumRowLabel(sr)}]`),   // 汇总行/统计行 → 右侧列头
  ].join(', ');

  const bodyLines: string[] = [];
  // 参数行（每参数一行）：[参数名] + 每试样数据 + 汇总行单元格（右侧列）
  params.forEach((p, pIdx) => {
    const dataCells = sids.map(sid => `[#__cell(data.${code}__${matrixDataKey(sid, p.code)})]`);
    const srCells: string[] = [];
    for (const sr of summaryRows) {
      if (isPerColRow(sr)) {
        // 统计行（按参数）：本参数行一格
        srCells.push(`[${perCellInner(matrixSummaryColumnFlatKey(code, sr.id, p.code))}]`);
      } else if (pIdx === 0) {
        // 汇总行（跨参数单值）：首参数行 rowspan 整列
        srCells.push(`table.cell(rowspan: ${params.length})[${valInner(matrixSummaryFlatKey(code, sr.id), sr.source_type, sr.unit, sr.literal, sr.field_code)}]`);
      }
    }
    bodyLines.push(`      [${paramLabel(p)}], ${dataCells.concat(srCells).join(', ')},`);
  });
  // 汇总列/统计列 → 底部行：[列名] + 每试样格(统计列) 或 跨试样单值(汇总列) + 右侧汇总行列留空
  for (const sc of summaryCols) {
    const pad = summaryRows.map(() => '[]');
    if (sc.per_row === false) {
      // 汇总列（跨试样单值）
      const inner = valInner(`${code}__sumcol__${sc.id}`, sc.source_type, sc.unit, sc.literal);
      bodyLines.push(`      [${sumColLabel(sc)}], table.cell(colspan: ${sids.length})[${inner}]${pad.length ? ', ' + pad.join(', ') : ''},`);
    } else {
      // 统计列（按试样）：每试样一格
      const cells = sids.map(sid => `[${perCellInner(`${code}__sumcol__${sc.id}__${sid}`)}]`);
      bodyLines.push(`      [${sumColLabel(sc)}], ${[...cells, ...pad].join(', ')},`);
    }
  }

  const keepTogether = cfg.keep_together !== false;
  const repeatHeader = cfg.repeat_header_on_break !== false;
  const insetY = lenTypst(cfg.cell_inset_y, 'pt');
  const insetLine = insetY ? `      inset: (y: ${insetY}),\n` : '';
  const innerLines: string[] = [
    `  #block(breakable: ${keepTogether ? 'false' : 'true'})[`,
    `    #set block(spacing: 0.55em)`,
  ];
  if (!field.hide_label) {
    const mLabelGap = lenTypst(field.label_gap, 'pt') || '0.55em';
    innerLines.push(`    #block(sticky: true, below: ${mLabelGap})[#text(${titleTextArgs(field.label_style, '1em')})[${escapeTypst(field.label)}]]`);
  }
  innerLines.push(
    `    #table(`,
    `      columns: (${colspec}),`,
    `      stroke: ${tableStrokeTypst(template)},`,
    `      align: ${alignKw},`,
    insetLine +
    `      table.header(repeat: ${repeatHeader}, ${headerInner}),`,
    ...bodyLines,
    `    )`,
    ...(captionTypst(field.caption, field.caption_gap, 'above', field.caption_style) ? [captionTypst(field.caption, field.caption_gap, 'above', field.caption_style)] : []),
    `  ]`,
  );
  return start + innerLines.join('\n') + end;
}

function embedDataMatrixTypst(field: FieldDefinition, value: DataMatrixValue, forTemplate: boolean, template: RecordTemplate): string {
  const cfg = field.matrix!;
  const v = normalizeMatrixValue(cfg, value);
  const params = v.parameters.length ? v.parameters : cfg.parameters;
  const sids = v.sample_ids.length ? v.sample_ids : createEmptyMatrixValue(cfg).sample_ids;
  const summaryCols = cfg.summary_cols || [];
  // P-Map-13b：试样为列 → 转置渲染（多级参数分组 / 行分组暂不支持转置，回退行模式）。
  if (cfg.sample_axis === 'col' && params.length > 0
      && !params.some(p => (p.group || '').trim())
      && !(cfg.sample_groups || []).some(g => (g || '').trim())) {
    return embedDataMatrixColAxisTypst(field, cfg, v, template, forTemplate);
  }

  // 行分组表头（与列分组对偶）：任一默认行设了组 → 最左加一列竖向"超级行头"（相邻同组 rowspan 合并）
  const rowGroups = cfg.sample_groups || [];
  const hasRowGroups = rowGroups.some(g => (g || '').trim());
  const rowGroupAt = (idx: number) => (rowGroups[idx] || '').trim();   // 录入期新增行（超界）= 未分组
  /** 行 idx 的分组单元格跨度：0=未分组(发空格)，-1=同组延续(跳过)，>0=run 首行 rowspan */
  const rowGroupRunLen = (idx: number): number => {
    const g = rowGroupAt(idx);
    if (!g) return 0;
    if (idx > 0 && rowGroupAt(idx - 1) === g) return -1;
    let len = 1;
    while (idx + len < sids.length && rowGroupAt(idx + len) === g) len++;
    return len;
  };

  // 列规：[行分组列 auto] + 试样列（可拖宽，缺省 auto）+ 各参数列（可拖宽，缺省 1fr）+ 各汇总列 auto
  const axisW = cfg.axis_col_width ? colWidthSpec(cfg.axis_col_width) : 'auto';
  const colspec = [...(hasRowGroups ? ['auto'] : []), axisW, ...params.map(p => colWidthSpec(p.width)), ...summaryCols.map(() => 'auto')].join(', ');
  const alignKw = (cfg.cell_align || 'center') + ' + horizon';
  const start = forTemplate ? `// __MATRIX_BLOCK__:${field.code}__\n` : '';
  const end = forTemplate ? `\n// __MATRIX_END__:${field.code}__` : '';

  // 单格 markup（不含外层方括号），供单行/两行表头复用
  const paramMarkup = (p: typeof params[number]) => {
    const effectiveUnit = v.parameter_unit_overrides?.[p.code] ?? p.unit ?? '';
    const u = effectiveUnit ? ` (${escapeTypst(effectiveUnit)})` : '';
    return `*${escapeTypst(p.label)}*${u}`;
  };
  const sumColMarkup = (sc: typeof summaryCols[number]) => {
    const effectiveUnit = v.sumcol_unit_overrides?.[sc.id] ?? sc.unit ?? '';
    const u = effectiveUnit ? ` (${escapeTypst(effectiveUnit)})` : '';
    return `*${escapeTypst(sc.label)}*${u}`;
  };
  // 左上角表头：undefined=默认"试样"，''=用户显式留空
  const axisText = cfg.axis_header ?? '试样';
  const axisMarkup = axisText ? `*${escapeTypst(axisText)}*` : '';

  // 多级表头：任一参数列设了 group → 表头排成两行（相邻同组 colspan 合并，未分组列 rowspan:2）
  const hasGroups = params.some(p => (p.group || '').trim());
  let headerInner: string;
  if (!hasGroups) {
    headerInner = [
      `[${axisMarkup}]`,
      ...params.map(p => `[${paramMarkup(p)}]`),
      ...summaryCols.map(sc => `[${sumColMarkup(sc)}]`),
    ].join(', ');
  } else {
    const row1: string[] = [`table.cell(rowspan: 2)[${axisMarkup}]`];
    const row2: string[] = [];
    let i = 0;
    while (i < params.length) {
      const g = (params[i].group || '').trim();
      if (!g) {
        row1.push(`table.cell(rowspan: 2)[${paramMarkup(params[i])}]`);
        i++;
      } else {
        let j = i;
        while (j < params.length && (params[j].group || '').trim() === g) j++;
        const run = params.slice(i, j);
        row1.push(`table.cell(colspan: ${run.length})[*${escapeTypst(g)}*]`);
        for (const p of run) row2.push(`[${paramMarkup(p)}]`);
        i = j;
      }
    }
    for (const sc of summaryCols) row1.push(`table.cell(rowspan: 2)[${sumColMarkup(sc)}]`);
    headerInner = [...row1, ...row2].join(', ');
  }
  // 行分组列的表头补格（跨全部表头行）
  if (hasRowGroups) {
    headerInner = `${hasGroups ? 'table.cell(rowspan: 2)[]' : '[]'}, ${headerInner}`;
  }

  const bodyLines: string[] = [];
  sids.forEach((sid, idx) => {
    let label = v.sample_labels?.[sid] ?? cfg.default_sample_labels?.[idx] ?? `${cfg.row_header_prefix || '试样'} ${idx + 1}`;
    // 行表头备注（统一表头模型）：行列倒置使用时行头也能带单位/可选单位
    const rowNote = v.sample_note_overrides?.[sid] ?? cfg.sample_notes?.[idx]?.note ?? '';
    if (rowNote) label = `${label} (${rowNote})`;
    // 最小行高：行首格放零宽 box——行至少这么高、内容多时仍自动撑开
    const rowH = cfg.sample_row_heights?.[idx];
    const minH = rowH && /^\d+(\.\d+)?(cm|mm|pt|em|in)$/i.test(String(rowH).trim())
      ? `#box(width: 0pt, height: ${String(rowH).trim()})` : '';
    const rowCells = params
      .map(p => {
        const dk = `${field.code}__${matrixDataKey(sid, p.code)}`;
        return `[#__cell(data.${dk})]`;
      });
    // 汇总列：其他列(per_row≠false)＝每行一格；汇总列(per_row===false)＝跨行单值（首行发 rowspan）
    const sumCells = summaryCols.map(sc => {
      if (sc.per_row === false) {
        if (idx !== 0) return null;
        const dk = `${field.code}__sumcol__${sc.id}`;
        const inner = sc.source_type === 'literal' ? `#str(${toTypstLiteral(sc.literal ?? '')})`
          : (sc.source_type === 'input_text' || sc.source_type === 'input_number')
            ? `#if data.${dk} == none or data.${dk} == "" { "______" } else { str(data.${dk}) }`
            : `#__cell(data.${dk})`;
        return `table.cell(rowspan: ${sids.length})[${inner}]`;
      }
      if (sc.source_type === 'literal') return `[${escapeTypst(sc.literal || '')}]`;
      const dk = `${field.code}__sumcol__${sc.id}__${sid}`;
      return `[#__cell(data.${dk})]`;
    }).filter((x): x is string => x !== null);
    // 行分组列：run 首行发 rowspan 格，延续行跳过，未分组行发空格
    let groupCell = '';
    if (hasRowGroups) {
      const rl = rowGroupRunLen(idx);
      groupCell = rl === -1 ? '' : rl === 0 ? '[], ' : `table.cell(rowspan: ${rl})[*${escapeTypst(rowGroupAt(idx))}*], `;
    }
    bodyLines.push(`      ${groupCell}[${minH}${escapeTypst(label)}], ${rowCells.concat(sumCells).join(', ')},`);
  });

  // 汇总行：保持现有逻辑生成跨列单元格；汇总行占据"试样列 + 参数列"，
  // 行首补行分组列的空格、末尾补 summary_cols 的空格
  const summaries = summaryRowsToTypst(field.code, params, cfg.summary_rows || [], v.summary_note_overrides);
  const summariesWithPadding = summaries.map(line => {
    let out = line;
    if (hasRowGroups) out = out.replace(/^(\s*)/, '$1[], ');
    if (summaryCols.length > 0) {
      // summary 行已经以 ", \n" 结尾；插入 summary_cols.length 个 [] 单元格
      const padding = summaryCols.map(() => '[]').join(', ');
      out = out.replace(/,(\s*)$/, `, ${padding},$1`);
    }
    return out;
  });

  // 尽量同页：keep_together（缺省 true）→ 外层 #block(breakable:false)，整表放不下就整体移到下一页
  // （超过一整页的超长表 Typst 仍会自动跨页、不丢数据）。设 false = 允许就近跨页。
  const keepTogether = cfg.keep_together !== false;
  // 跨页时续页是否重复表头（仅在确实跨页时生效），缺省 true。
  const repeatHeader = cfg.repeat_header_on_break !== false;
  // 外层块【不设 above/below】——表格之间的间距交给【分区样式·字段间距】（styleSetRules 的
  // #set block(spacing:) 会级联进来；未设时用 Typst 默认块间距）。这样"改分区样式即改表间距"。
  const innerLines: string[] = [
    `  #block(breakable: ${keepTogether ? 'false' : 'true'})[`,
    // 表内：标题与表格保持紧凑（固定小间距），不随分区字段间距放大而被推远——标题像表的题注。
    `    #set block(spacing: 0.55em)`,
  ];
  if (!field.hide_label) {
    // 标题 sticky：与其后的表格粘在一起，避免"标题在上一页底、表格在下一页"的孤立。
    // 标签样式吃 label_style（字体/字号/加粗/斜体/颜色），缺省加粗（titleTextArgs 默认 weight!=='regular'）。
    // 标题与表格的距离＝label_gap（标题块 below，覆盖上面的 0.55em）；缺省回退 0.55em。
    const mLabelGap = lenTypst(field.label_gap, 'pt') || '0.55em';
    innerLines.push(`    #block(sticky: true, below: ${mLabelGap})[#text(${titleTextArgs(field.label_style, '1em')})[${escapeTypst(field.label)}]]`);
  }
  // 单元格上下内边距（行与行的疏密）：cell_inset_y 设了就覆盖，否则用 Typst 默认。
  const insetY = lenTypst(cfg.cell_inset_y, 'pt');
  const insetLine = insetY ? `      inset: (y: ${insetY}),\n` : '';
  innerLines.push(
    `    #table(`,
    `      columns: (${colspec}),`,
    `      stroke: ${tableStrokeTypst(template)},`,
    `      align: ${alignKw},`,
    insetLine +
    `      table.header(repeat: ${repeatHeader}, ${headerInner}),`,
    ...bodyLines,
    ...summariesWithPadding,
    `    )`,
    // 备注信息：紧贴表格下方（在表块内，随表一起）；备注与表的距离＝caption_gap（缺省 0.35em）
    ...(captionTypst(field.caption, field.caption_gap, 'above', field.caption_style) ? [captionTypst(field.caption, field.caption_gap, 'above', field.caption_style)] : []),
    `  ]`,
  );
  const inner = innerLines.join('\n');

  return start + inner + end;
}

function escapeTypst(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/** 转义 Typst **标记**里的特殊字符——把用户纯文本安全嵌进 markup，杜绝 `#代码`/`$公式` 等注入。 */
function escapeTypstMarkup(s: string): string {
  return s.replace(/([\\#$*_\[\]@<>`~])/g, '\\$1');
}

/** 行内：`**粗**` → `*粗*`(Typst)、`*斜*`/`_斜_` → `_斜_`(Typst)，其余文本转义。 */
function inlineRichToTypst(line: string): string {
  let out = '';
  let last = 0;
  const re = /\*\*([^*]+)\*\*|\*([^*]+)\*|_([^_]+)_/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    out += escapeTypstMarkup(line.slice(last, m.index));
    if (m[1] !== undefined) out += `*${escapeTypstMarkup(m[1])}*`;                 // 粗体
    else out += `_${escapeTypstMarkup((m[2] ?? m[3]) as string)}_`;                // 斜体
    last = re.lastIndex;
  }
  out += escapeTypstMarkup(line.slice(last));
  return out;
}

/**
 * 富文本（Markdown 子集）→ Typst markup。支持：空行=分段、换行、无序(`-`/`*`)与有序(`1.`)列表、`**粗**`、`*斜*`/`_斜_`。
 * 安全：先转义用户文本里的 Typst 特殊字符、再套白名单标记，绝不 eval，杜绝注入。返回值需放进 `[ ... ]` 内容块。
 */
export function richTextToTypst(src: string | undefined | null): string {
  if (src === undefined || src === null || src === '') return '';
  const paras = String(src).split(/\n[ \t]*\n/);
  const blocks: string[] = [];
  for (const para of paras) {
    const nonEmpty = para.split('\n').filter(l => l.trim());
    if (!nonEmpty.length) continue;
    const allList = nonEmpty.every(l => /^\s*([-*]|\d+\.)\s+/.test(l));
    if (allList) {
      blocks.push(nonEmpty.map(l => {
        const ordered = /^\s*\d+\.\s+/.test(l);
        const text = l.replace(/^\s*([-*]|\d+\.)\s+/, '');
        return `${ordered ? '+' : '-'} ${inlineRichToTypst(text)}`;
      }).join('\n'));
    } else {
      blocks.push(nonEmpty.map(l => inlineRichToTypst(l)).join(' #linebreak() '));
    }
  }
  return blocks.join('\n\n');
}

/** 长度字符串 → Typst 长度。带单位原样；裸数字补默认单位；非法原样返回。 */
function lenTypst(v: string | number | undefined, def: 'pt' | 'em'): string {
  if (v === undefined || v === null || v === '') return '';
  const s = String(v).trim();
  if (/^\d+(\.\d+)?(pt|em|cm|mm|in|%)$/i.test(s)) return s;
  if (/^\d+(\.\d+)?$/.test(s)) return `${s}${def}`;
  return s;
}

/** StyleOverride → 可 splat 进 text() 的 Typst dict（font/size/weight/style/fill）。空 → "(:)"。用于标题/副标题。 */
function styleOverrideToTextDict(style?: StyleOverride): string {
  if (!style) return '(:)';
  const t: string[] = [];
  if (style.font) t.push(`font: "${escapeTypst(style.font)}"`);
  const sz = lenTypst(style.size, 'pt'); if (sz) t.push(`size: ${sz}`);
  if (style.weight === 'bold') t.push('weight: "bold"');
  else if (style.weight === 'regular') t.push('weight: "regular"');
  if (style.italic) t.push('style: "italic"');
  if (style.color && /^#?[0-9a-fA-F]{6}$/.test(style.color)) t.push(`fill: rgb("${style.color.replace('#', '')}")`);
  return t.length ? `(${t.join(', ')})` : '(:)';
}

/** StyleOverride → Typst set 规则（#set text / #set par）。空样式返回空串。 */
/** 纯西文字体（选了它就整段用它，不要再回退）。其余（中文字体）前面垫 Arial，让英文/数字默认 Arial。 */
const LATIN_ONLY_FONTS = new Set(['Arial', 'Times New Roman']);

/**
 * StyleOverride → 字段名/字段值的行内 text() dict（P14·14.2）：font/size/weight/italic/color。
 * 可 splat 进主题 #field 的 label_args/value_args。空 → '(:)'（主题据 len 跳过，不改原样）。
 * 与 styleSetRules 同口径：中文字体垫 Arial 让英文/数字默认 Arial；无粗体字体加描边模拟粗体。
 * label 一侧 weight 走 #field 的 label_bold 通道（复用主题 faux-bold），故 includeWeight=false。
 */
function fieldPartTextDict(style: StyleOverride | undefined, includeWeight: boolean): string {
  if (!style) return '(:)';
  const t: string[] = [];
  if (style.font) {
    const f = escapeTypst(style.font);
    t.push(LATIN_ONLY_FONTS.has(style.font) ? `font: "${f}"` : `font: ("Arial", "${f}")`);
  }
  const sz = lenTypst(style.size, 'pt'); if (sz) t.push(`size: ${sz}`);
  if (includeWeight) {
    if (style.weight === 'bold') {
      t.push('weight: "bold"');
      if (isNoBoldFont(style.font || _docFont)) t.push('stroke: 0.03em');
    } else if (style.weight === 'regular') t.push('weight: "regular"');
  }
  if (style.italic) t.push('style: "italic"');
  if (style.color && /^#?[0-9a-fA-F]{6}$/.test(style.color)) t.push(`fill: rgb("${style.color.replace('#', '')}")`);
  return t.length ? `(${t.join(', ')})` : '(:)';
}

/**
 * "#text 直接加粗"处（标题/表格标签等不走主题 #field faux-bold 通道的位置）的描边补丁：
 * 无粗体字体（仿宋/黑体/楷体）weight:700 不生效 → 加 stroke 模拟粗体。有真粗体的字体 → 空串。
 */
function fauxBoldStroke(font?: string): string {
  return isNoBoldFont(font || _docFont) ? ', stroke: 0.03em' : '';
}

/**
 * 图/表下方的【备注信息】块：小字（9pt）、紧贴上方图/表（above 小间距）、左对齐、支持多行。
 * 空 → 空串（不渲染）。escapeTypst 中和 markup，`\n`→`#linebreak()`，杜绝注入。
 */
/**
 * 图/表下方（或上方）的备注块。`gap`＝备注与图/表之间的距离（缺省 0.35em）；
 * `side`＝图/表在备注的哪一侧：'above'（缺省，备注在图/表下方→间距加在备注上缘）/ 'below'（备注在图/表上方→间距加在备注下缘）。
 */
function captionTypst(caption?: string, gap?: string, side: 'above' | 'below' = 'above', style?: StyleOverride): string {
  if (caption == null || !String(caption).trim()) return '';
  const md = String(caption).split('\n').map(l => escapeTypst(l)).join(' #linebreak() ');
  // 备注↔表 距离：显式 caption_gap 优先；未设时跟随文档/分区「字段间距」(_figureGap)，兜底 0.35em。
  const g = lenTypst(gap, 'pt') || _figureGap || '0.35em';
  const above = side === 'above' ? g : '0.2em';
  const below = side === 'below' ? g : '0.2em';
  // 备注文字样式：缺省 9pt 常规；caption_style 可改字体/字号/加粗(faux-bold 感知)/斜体/颜色。
  const a: string[] = [`size: ${lenTypst(style?.size, 'pt') || '9pt'}`];
  if (style?.font) a.push(LATIN_ONLY_FONTS.has(style.font) ? `font: "${escapeTypst(style.font)}"` : `font: ("Arial", "${escapeTypst(style.font)}")`);
  if (style?.weight === 'bold') { a.push('weight: "bold"'); if (isNoBoldFont(style.font || _docFont)) a.push('stroke: 0.03em'); }
  else if (style?.weight === 'regular') a.push('weight: "regular"');
  if (style?.italic) a.push('style: "italic"');
  if (style?.color && /^#?[0-9a-fA-F]{6}$/.test(style.color)) a.push(`fill: rgb("${style.color.replace('#', '')}")`);
  return `\n#block(above: ${above}, below: ${below})[#text(${a.join(', ')})[${md}]]`;
}

/**
 * 报告表整表文字样式（font/size 包裹全表；表头/内容加粗）。
 * tableStyleWrap：把表 typst 包进 #text(font, size)[...]（font/size 都没设则原样返回）。
 * tableCellBold：把已转义的单元格内容按 on 包进加粗 text（faux-bold 感知）。
 */
function tableStyleWrap(table: string, ts?: FieldDefinition['table_style']): string {
  if (!ts) return table;
  const a: string[] = [];
  if (ts.font) a.push(LATIN_ONLY_FONTS.has(ts.font) ? `font: "${escapeTypst(ts.font)}"` : `font: ("Arial", "${escapeTypst(ts.font)}")`);
  const sz = lenTypst(ts.font_size, 'pt'); if (sz) a.push(`size: ${sz}`);
  return a.length ? `#text(${a.join(', ')})[\n${table}\n]` : table;
}
function tableCellBold(content: string, on: boolean, font?: string): string {
  return on ? `#text(weight: "bold"${fauxBoldStroke(font)})[${content}]` : content;
}

/**
 * 报告自动表/图（result_table / equipment_table / image_gallery）的「标题 + 题注 + 版式」统一包装：
 *  - 标题（图/表标签）：**缺省不显示**（报告表多半已在带标题的分区里，避免和分区标题重复）；
 *    仅 `hide_label === false`（属性面板显式打开「显示图/表标题」）时才出，样式吃 `label_style`，`sticky` 防分页孤立。
 *  - 标题与图/表的距离：`label_gap`（标题块 `below`，缺省 0.4em）。
 *  - 题注（caption）：`caption_position` 决定贴在表/图上方还是下方（缺省下方）。
 *  - 版式（field.style）：对齐 + 段前/段后间距（与上下内容的距离），走 `applyBlockStyle`。
 */
function wrapFigure(field: FieldDefinition, body: string): string {
  const showTitle = field.hide_label === false;   // 缺省(undefined)=不显示，显式 false=显示
  // 标题↔表 距离：显式 label_gap 优先；未设时跟随文档/分区「字段间距」(_figureGap)，让表/图与正文统一疏密
  // （回应"调字段间距时表格紧贴自己的小标题不动"）；_figureGap 兜底 0.4em。
  const labelGap = lenTypst(field.label_gap, 'pt') || _figureGap || '0.4em';
  const title = showTitle
    ? `#block(sticky: true, below: ${labelGap})[#text(${titleTextArgs(field.label_style, '1em')})[${escapeTypst(field.label)}]]\n`
    : '';
  const above = field.caption_position === 'above';
  // 备注在图/表上方时，图/表在备注下侧（side='below'）；缺省备注在下方，图/表在上侧（side='above'）
  const cap = captionTypst(field.caption, field.caption_gap, above ? 'below' : 'above', field.caption_style);
  const inner = title + (above && cap ? cap.replace(/^\n/, '') + '\n' : '') + body + (!above ? cap : '');
  // 用一个块把【标题↔图、图↔备注】的内部间距与分区级「字段间距」隔离：内部 #set block(spacing:0pt)，
  // 使这两段距离完全由 label_gap / caption_gap（标题块 below、备注块 above/below）决定。
  // 否则分区级 #set block(spacing: 字段间距) 会成为图/标题/备注块的默认 above/below，并以"取较大值"
  // 盖住较小的 label_gap/caption_gap（表现为：标题/备注离图的距离调小无效、被字段间距撑住）。
  // 外层块自身仍继承分区「字段间距」与相邻分区/字段等距（breakable:true 不阻止超长表跨页）。
  const isolated = `#block(breakable: true)[\n#set block(spacing: 0pt)\n${inner}\n]`;
  return applyBlockStyle(isolated, field.style);
}

/**
 * 分区标题的 text() 参数（逗号分隔，无外层括号）：weight + faux-bold 描边 + 字号 + 字体/斜体/颜色。
 * 标题默认加粗（除非 style.weight==='regular'）。defaultSize=未设字号时的默认（如 '1.15em' / '1.05em'）。
 * 供顶级分区（传给主题 #section 的 title_args）与子分区标题（生成器直发 #text）共用，口径一致。
 */
function titleTextArgs(style: StyleOverride | undefined, defaultSize: string): string {
  const bold = style?.weight !== 'regular';
  const parts: string[] = [`weight: ${bold ? '700' : '400'}`];
  if (bold && isNoBoldFont(style?.font || _docFont)) parts.push('stroke: 0.03em');
  const sz = lenTypst(style?.size, 'pt');
  parts.push(`size: ${sz || defaultSize}`);
  if (style?.font) {
    const f = escapeTypst(style.font);
    parts.push(LATIN_ONLY_FONTS.has(style.font) ? `font: "${f}"` : `font: ("Arial", "${f}")`);
  }
  if (style?.italic) parts.push('style: "italic"');
  if (style?.color && /^#?[0-9a-fA-F]{6}$/.test(style.color)) parts.push(`fill: rgb("${style.color.replace('#', '')}")`);
  return parts.join(', ');
}

function styleSetRules(style?: StyleOverride): string {
  if (!style) return '';
  const t: string[] = [];
  if (style.font) {
    const f = escapeTypst(style.font);
    t.push(LATIN_ONLY_FONTS.has(style.font) ? `font: "${f}"` : `font: ("Arial", "${f}")`);
  }
  const sz = lenTypst(style.size, 'pt'); if (sz) t.push(`size: ${sz}`);
  if (style.weight === 'bold') {
    t.push('weight: "bold"');
    // 无粗体字体（仿宋 FandolFang）：weight:bold 不生效 → 加描边模拟粗体，使"加粗"可见
    if (isNoBoldFont(style.font || _docFont)) t.push('stroke: 0.03em');
  }
  else if (style.weight === 'regular') t.push('weight: "regular"');
  if (style.italic) t.push('style: "italic"');
  if (style.color && /^#?[0-9a-fA-F]{6}$/.test(style.color)) t.push(`fill: rgb("${style.color.replace('#', '')}")`);
  const tk = lenTypst(style.tracking, 'pt'); if (tk) t.push(`tracking: ${tk}`);
  const out: string[] = [];
  if (t.length) out.push(`#set text(${t.join(', ')})`);
  const lh = lenTypst(style.line_height, 'em'); if (lh) out.push(`#set par(leading: ${lh})`);
  // 字段/表格间距（区块级）：级联到分区内所有块（含矩阵表格），让"分区样式"统一控制内部间距。
  const bsp = lenTypst(style.block_spacing, 'pt'); if (bsp) out.push(`#set block(spacing: ${bsp})`);
  return out.join('\n');
}

/** 给一段内容套上块级样式：set 规则 + 可选水平对齐。供区块 / 字段复用。 */
function applyBlockStyle(content: string, style?: StyleOverride): string {
  if (!style) return content;
  const rules = styleSetRules(style);
  let inner = content;
  if (style.align === 'left' || style.align === 'center' || style.align === 'right') {
    inner = `#align(${style.align})[\n${inner}\n]`;
  }
  // 页边距/缩进：#pad 把块整体内缩（left 用于横向定位，如把"签发日期"推到页中右）
  if (style.margin && typeof style.margin === 'object') {
    const m = style.margin;
    const mp: string[] = [];
    const ml = lenTypst(m.left, 'pt');   if (ml) mp.push(`left: ${ml}`);
    const mr = lenTypst(m.right, 'pt');  if (mr) mp.push(`right: ${mr}`);
    const mt = lenTypst(m.top, 'pt');    if (mt) mp.push(`top: ${mt}`);
    const mb = lenTypst(m.bottom, 'pt'); if (mb) mp.push(`bottom: ${mb}`);
    if (mp.length) inner = `#pad(${mp.join(', ')})[\n${inner}\n]`;
  }
  // 段前/段后间距：流式"调位置"（把块往下压 / 块之间留白），替代自由拖拽定位
  const before = lenTypst(style.space_before, 'pt');
  const after = lenTypst(style.space_after, 'pt');
  if (before) inner = `#v(${before})\n${inner}`;
  if (after) inner = `${inner}\n#v(${after})`;
  return (rules ? rules + '\n' : '') + inner;
}

/** 富文本字段 → 一个带样式的内容块（转换后的 Typst markup 放进 [ ] 内）。 */
function richBlock(value: any, style?: StyleOverride): string {
  const inner = richTextToTypst(value === null || value === undefined ? '' : String(value));
  return applyBlockStyle(`#block[\n${inner}\n]`, style);
}

/** 列宽字符串 → Typst 列宽。带单位(fr/cm/mm/pt/in/%)原样；裸数字按 fr；空/非法回退 1fr。 */
function colWidthSpec(w?: string | number): string {
  if (w === undefined || w === null || w === '') return '1fr';
  const s = String(w).trim();
  if (/^\d+(\.\d+)?(fr|cm|mm|pt|in|%)$/i.test(s)) return s;
  if (/^\d+(\.\d+)?$/.test(s)) return `${s}fr`;
  return '1fr';
}

/**
 * 图片记录分区渲染：根据 image_phase 分组
 *  - before(检测前)：独立一张表，整行一格
 *  - during + after(检测中/检测后)：合并为一张表，并排两格
 *  - 其他 phase：每个一张独立表
 *
 * 模板期：占位（用注释锚点 __IMAGE_GROUP__:<groupId>__ ... __IMAGE_END__:<groupId>__），
 * 数据期（generateTypstWithData）：替换为实际带图片 path 的 typst 代码。
 */
/**
 * 文员端·首页 image 字段的【统一渲染】——与 photo_table / gallery 同一套(renderSharedPhotoGrid / renderGalleryGrid)：
 *  - shared(缺省)：共用表内标题(field.label) + 直传 image_photos 铺网格。
 *  - per：每行＝表内标题 + 单张图(image_items)。
 *  支持 每行N张(image_cols)、尺寸(image_size,默认7×6)、单数独占(image_solo,默认first)、行(image_seamless,独立框/粘连)。
 *  保留 posMarker(编辑器⇄PDF 跳转) + 备注(caption) + 字段级样式(style)。
 */
function renderImageFieldUnified(f: FieldDefinition, photos: any[], stroke: number, inset: number): string {
  const layout = {
    cols: f.image_cols && f.image_cols > 0 ? f.image_cols : 1,
    width: f.image_size?.width_cm ?? 7, height: f.image_size?.height_cm ?? 6,
    stroke, inset,
    seamless: f.image_seamless !== false, solo: (f.image_solo === 'last' ? 'last' : 'first') as 'first' | 'last',
    headerFollow: f.image_header_follow !== false,
    insetX: f.image_inset_x, insetY: f.image_inset_y, titleInsetY: f.image_title_inset_y,
  };
  let body: string;
  if ((f.image_title_mode || 'shared') === 'per') {
    const items = (f.image_items || []).map(it => ({ title: it.label || '', hideTitle: !(it.label || '').trim(), photo: (Array.isArray(it.photos) ? it.photos : [])[0] }));
    body = items.length ? renderGalleryGrid(items, layout) : '#align(center)[#text(fill: gray)[（无图片）]]';
  } else {
    const title = (f.hide_label || !(f.label || '').trim()) ? '' : (f.label || '');
    body = renderSharedPhotoGrid(photos, title, f.label_style, layout);
  }
  return `${posMarker('field', f.code)}\n${applyBlockStyle(body, f.style)}${captionTypst(f.caption, f.caption_gap, 'above', f.caption_style)}`;
}

function generateImageGroupContent(group: FieldGroup): string {
  const imageFields = group.fields.filter(f => f.type === 'image');
  if (!imageFields.length) return '';
  // 模板期占位＝按真实图位布局渲染（空照片→「（无图片）」框）：这样首页编辑器（generateTypst+inject，
  // 不走 generateTypstWithData）也能所见即所得看到【字段标题 + 版式】，与录入后渲染一致。
  // 数据期 generateTypstWithData 会按 __IMAGE_GROUP__ 锚点整体替换成带真实照片 path 的版本（原始记录走 renderImageGroupTypst 旧路径）。
  const stroke = imageFields[0].image_table_style?.stroke_pt ?? 0.5;
  const inset = imageFields[0].image_table_style?.inset_pt ?? 6;
  // 照片来源：首页(content_doc)文员上传的 image_photos 直接在模板期渲染（首页不经 generateTypstWithData，
  // __IMAGE_GROUP__ 不会被替换）；原始记录模板里 image_photos 为空＝占位框，由 generateTypstWithData 用 record_data 替换。
  const body = imageFields.map(f => renderImageFieldUnified(f, Array.isArray(f.image_photos) ? f.image_photos : [], stroke, inset)).join('\n\n');
  return `// __IMAGE_GROUP__:${group.id}__
${body}
// __IMAGE_END__:${group.id}__`;
}

/** 统一图片渲染的内部"图位"：一张标题 + N 张照片 + 布局参数。供原始记录图片组 / 报告图片表共用。 */
interface ImgSlot {
  marker: string;            // posMarker（原始记录用，报告图片表为 ''）
  label: string;
  hideLabel: boolean;        // 含"空标题视为隐藏"
  labelStyle?: StyleOverride;
  layout: 'loose' | 'compact';
  ratio: number;             // compact 行内占比
  cols: number;              // 本图位多张照片每行排几张
  width: number; height: number;  // 单张图尺寸（cm）
  photos: any[];
  caption?: string; captionGap?: string; captionStyle?: StyleOverride;
  captionPosition?: 'above' | 'below';
  labelGap: string;                // 标题↔图 距离（显式 label_gap 优先，否则随字段间距 _figureGap）
  style?: StyleOverride;           // 字段级版式（对齐/段前后）
}

/** image 字段 → 图位（原始记录组 / 报告自动模式共用）。空标题视为隐藏。 */
function imageFieldToSlot(f: FieldDefinition, photos: any[], marker: string): ImgSlot {
  const label = f.label || '';
  return {
    marker,
    label,
    hideLabel: !!f.hide_label || !label.trim(),
    labelStyle: f.label_style,
    layout: (f.image_layout || 'loose') === 'compact' ? 'compact' : 'loose',
    ratio: Math.min(Math.max(f.image_row_ratio ?? 0.5, 0.1), 1),
    cols: f.image_cols && f.image_cols > 0 ? f.image_cols : 1,
    width: f.image_size?.width_cm ?? 8,
    height: f.image_size?.height_cm ?? 7,
    photos,
    caption: f.caption, captionGap: f.caption_gap, captionStyle: f.caption_style,
    captionPosition: f.caption_position,
    labelGap: lenTypst(f.label_gap, 'pt') || _figureGap || '0.4em',
    style: f.style,
  };
}

/**
 * 单张图片的表达式形式（供 #grid 位置参数用）。
 * 图框统一固定为配置的 w×h cm 并居中——无论「整行(宽松)」还是「并排(紧凑/分列)」都一样大。
 * （旧实现并排时用 width:100% 填满列宽，而列宽=1fr≈半页通常比配置 cm 宽，导致并排两张图比单张明显更大。
 *  改为固定 cm 后，并排与单张尺寸一致；box 比所在列窄时居中留白，fit:"contain" 保证不溢出。）
 * fill 参数保留以兼容调用方，但不再影响尺寸（两种布局都按 cm）。
 */
function imgExpr(img: any, w: number, h: number, _fill: boolean): string {
  const path = img?.server_path || img?.path || '';
  if (!path) return 'align(center, text(fill: gray)[（无图片）])';
  return `align(center, box(width: ${w}cm, height: ${h}cm, image("${escapeTypst(path)}", width: 100%, height: 100%, fit: "contain")))`;
}

/**
 * 一个图位的照片区（放进外层 table 单元格 [...] 里的 markup）：
 *  - 单张：直接居中图。
 *  - 多张（同一字段共享一个表内标题）：渲成【带分割线的内表格】，每行 cols 张、照片间有边框分隔；
 *    最后一行只剩 1 张时该张跨满整行（"单数最后一张独占一行"），剩 ≥2 张但不满 cols 时补空格保持矩形。
 */
// 报告表格（结果表/设备表/结论表/自由表）默认行高＝单元格上下留白(pt)。图片表内标题行高默认也用它，保持与其它表格一致。
const STD_TABLE_INSET_Y = 10;
// 图片单元格内边距（左右=insetX、上下=insetY，缺省回退到 inset）；表内标题行内边距（上下=titleInsetY，缺省=标准表格行高 STD_TABLE_INSET_Y）。
type InsetOpts = { inset: number; insetX?: number; insetY?: number; titleInsetY?: number };
function imgCellInset(o: InsetOpts): string { return `(x: ${o.insetX ?? o.inset}pt, y: ${o.insetY ?? o.inset}pt)`; }
function imgTitleInset(o: InsetOpts): string { return `(x: ${o.insetX ?? o.inset}pt, y: ${o.titleInsetY ?? STD_TABLE_INSET_Y}pt)`; }

function slotPhotoCell(slot: ImgSlot, fill: boolean, opts: { stroke: number; inset: number; insetX?: number; insetY?: number }): string {
  const ph = slot.photos || [];
  if (!ph.length) return '#align(center)[#text(fill: gray)[（无图片）]]';
  // imgExpr 返回裸 `align(center, box(...))`（代码表达式）。单张放进 markup/content 上下文需加 `#`；
  // 多张时作为 #table(...) 的位置参数（代码上下文），直接用裸表达式。
  if (ph.length === 1) return '#' + imgExpr(ph[0], slot.width, slot.height, fill);
  const cols = Math.max(1, slot.cols || 1);
  const colSpec = Array(cols).fill('1fr').join(', ');
  const n = ph.length;
  const lastRow = n % cols;   // 最后一行照片数（0=正好排满）
  const cells: string[] = ph.map((p, i) => {
    const expr = imgExpr(p, slot.width, slot.height, fill);   // align(center, box(...)) — 作为 table 位置参数的内容值
    if (i === n - 1 && lastRow === 1 && cols > 1) return `table.cell(colspan: ${cols}, ${expr})`;
    return expr;
  });
  if (lastRow >= 2) for (let k = 0; k < cols - lastRow; k++) cells.push('[]');
  return `#table(columns: (${colSpec}), stroke: ${opts.stroke}pt, inset: ${imgCellInset(opts)}, align: center + horizon, ${cells.join(', ')})`;
}

/**
 * 把一个图位的多张照片摊成【外层表格的单元格】（不再嵌套内表格）——照片间分隔线＝外表自身的网格线，
 * 只隔开、不多套一层框（对齐"检测中/检测后"那种单框样式）。返回 { cols, cells }：
 * cells 是 table 的位置参数（裸内容表达式 / table.cell(colspan) / 空格 []）。
 * 末行只剩 1 张 → 跨满整行；剩 ≥2 张不满 cols → 补空格保持矩形。
 */
function photoCellsFor(slot: ImgSlot, fill: boolean, solo: 'first' | 'last' = 'last'): { cols: number; cells: string[] } {
  const ph = slot.photos || [];
  const cols = Math.max(1, slot.cols || 1);
  // 占位＝裸代码表达式（与 imgExpr 的空图形式一致）：cells 是 #table(...) 的位置参数（代码上下文），
  // 不能用 markup 的 `#align[...]`（否则 typst 报「the character `#` is not valid in code」）。
  if (!ph.length) return { cols: 1, cells: ['align(center, text(fill: gray)[（无图片）])'] };
  const n = ph.length;
  const lastRow = n % cols;
  // 单数独占：剩 1 张时该张跨满整行——solo='first' 第一张独占（其余整除铺满）/ 'last' 最后一张独占。
  const soloIdx = (lastRow === 1 && cols > 1) ? (solo === 'first' ? 0 : n - 1) : -1;
  const cells = ph.map((p, i) => {
    const expr = imgExpr(p, slot.width, slot.height, fill);   // align(center, box(...)) — 作内容值
    if (i === soloIdx) return `table.cell(colspan: ${cols}, ${expr})`;
    return expr;
  });
  if (lastRow >= 2) for (let k = 0; k < cols - lastRow; k++) cells.push('[]');
  return { cols, cells };
}

function slotCaption(slot: ImgSlot): string {
  return captionTypst(slot.caption, slot.captionGap, 'above', slot.captionStyle);
}

/**
 * 统一图片渲染：把图位序列按"宽松独占行 / 紧凑按占比并排"打包成行，每个图位独立成框渲染。
 */
function renderImageSlotsTypst(slots: ImgSlot[], opts: { stroke: number; inset: number; solo?: 'first' | 'last'; seamless?: boolean; cols?: number; insetX?: number; insetY?: number; titleInsetY?: number }): string {
  if (!slots.length) return '';
  const EPS = 0.001;
  let rows: ImgSlot[][];
  if (opts.cols && opts.cols > 0) {
    // 分区级版式：每行 opts.cols 个图位（单数独占按 solo）——不再用逐字段「宽松/紧凑」
    rows = chunkWithSolo(slots, opts.cols, opts.solo || 'last');
  } else {
    rows = [];
    let cur: ImgSlot[] = []; let sum = 0;
    const flush = () => { if (cur.length) { rows.push(cur); cur = []; sum = 0; } };
    for (const s of slots) {
      if (s.layout !== 'compact') { flush(); rows.push([s]); continue; }
      if (sum + s.ratio > 1 + EPS) flush();
      cur.push(s); sum += s.ratio;
      if (sum >= 1 - EPS) flush();
    }
    flush();
  }

  const titleCell = (s: ImgSlot) => s.hideLabel ? '[]' : `table.cell(inset: ${imgTitleInset(opts)})[#text(${titleTextArgs(s.labelStyle, '1em')})[${escapeTypst(s.label)}]]`;

  // 每个图位独立成框（#block+#table）。早先的"粘连/无缝整组"已移除（它只是多套一层框，无实际价值）。
  const blocks = rows.map(row => {
    const markers = row.map(s => s.marker).filter(Boolean).join('\n');
    let block: string;
    if (row.length === 1) {
      const s = row[0];
      // 多张照片摊成外层表格的单元格（每行 cols 张），照片间用表格网格线隔开、共用一个外框、一个表内标题（跨列）。
      const { cols, cells } = photoCellsFor(s, false, opts.solo);
      const colSpec = Array(cols).fill('1fr').join(', ');
      // 表内标题（跨满整行、上下留白更大）；备注＝表下方小字题注。分区左上角标题由 generateImageGroupContent 另出。
      const labelRow = s.hideLabel ? '' : `    table.cell(${cols > 1 ? `colspan: ${cols}, ` : ''}inset: ${imgTitleInset(opts)})[#text(${titleTextArgs(s.labelStyle, '1em')})[${escapeTypst(s.label)}]],\n`;
      block = applyBlockStyle(`#block(breakable: false)[
  #table(columns: (${colSpec}), stroke: ${opts.stroke}pt, inset: ${imgCellInset(opts)}, align: center + horizon,
${labelRow}    ${cells.join(', ')},
  )
]${slotCaption(s)}`, s.style);
    } else {
      // 分区级 cols 模式＝等分 1fr；旧紧凑模式＝按各图位 ratio 占比
      const colspec = (opts.cols && opts.cols > 0)
        ? Array(row.length).fill('1fr').join(', ')
        : row.map(s => `${Math.round(s.ratio * 1000) / 10}%`).join(', ');
      const labelRow = row.some(s => !s.hideLabel) ? '    ' + row.map(titleCell).join(', ') + ',\n' : '';
      const cells = row.map(s => `[${slotPhotoCell(s, true, opts)}]`).join(', ');
      block = `#block(breakable: false)[
  #table(columns: (${colspec}), stroke: ${opts.stroke}pt, inset: ${imgCellInset(opts)}, align: center + horizon,
${labelRow}    ${cells},
  )
]${row.map(slotCaption).join('')}`;
    }
    return markers ? `${markers}\n${block}` : block;
  });
  // 原始记录图片分区（renderImageGroupTypst/renderImageFieldUnified 不传 seamless）：保持原样，零回退。
  if (opts.seamless === undefined) return blocks.join('\n\n');
  // 报告图库自动模式（传了 seamless）：显式块间距覆盖 wrapFigure 的 0pt——粘连=0pt、独立=0.8em。
  return `#block(width: 100%)[\n#set block(spacing: ${opts.seamless ? '0pt' : '0.8em'})\n${blocks.join('\n')}\n]`;
}

/**
 * 渲染"图片记录"分区：每个 image 字段＝一个图位。照片来源用注入的 photosOf 解析——
 * 原始记录＝按字段 code 从 record_data 取（`f => data[f.code]`）；项目报告＝按字段的绑定 `image_source_code`
 * 从关联原始记录 ctx.record_raw_data 取。布局/四类文字/分区级版式两处完全共用。
 */
function renderImageGroupTypst(group: FieldGroup, photosOf: (f: FieldDefinition) => any[]): string {
  const fields = group.fields.filter(f => f.type === 'image');
  if (!fields.length) return '';
  const stroke = fields[0].image_table_style?.stroke_pt ?? 0.5;
  const inset = fields[0].image_table_style?.inset_pt ?? 6;
  const sl = group.image_layout || {};
  // 四类文字之三/四（与布局解耦，即便没设分区级布局也渲染）：
  //   ② 上方标签（图表外·左上角，类似说明）  ④(下) 下方备注（整组一条）
  const topLabel = sl.top_label && sl.top_label.trim()
    ? `#block(below: ${lenTypst(sl.top_label_gap, 'pt') || '0.4em'})[#text(${titleTextArgs(sl.top_label_style, '1em')})[${escapeTypst(sl.top_label)}]]\n`
    : '';
  const cap = sl.caption && sl.caption.trim() ? captionTypst(sl.caption, sl.caption_gap, 'above', sl.caption_style) : '';
  // 是否设了「分区级布局」——仅看布局/表内标题相关键（不含 top_label/caption），故单设上方标签/下方备注不会把布局翻成分区级
  const hasLayout = sl.cols != null || sl.title_mode != null || sl.width_cm != null || sl.height_cm != null
    || sl.solo != null || sl.seamless != null || sl.shared_title != null || sl.label_style != null;
  let body: string;
  if (hasLayout) {
    // 分区级版式（新模型）：cols=每行几图位、尺寸、单数独占、独立框/粘连、表内标题模式（统一管全分区）
    const cols = sl.cols && sl.cols > 0 ? sl.cols : 2;   // 默认每行 2 张
    const width = sl.width_cm ?? 7, height = sl.height_cm ?? 6;
    const solo: 'first' | 'last' = sl.solo === 'last' ? 'last' : 'first';
    const seamless = sl.seamless !== false;   // 缺省粘连；分区级 image_layout.seamless=false → 独立框（每行独立、块间留白）
    const lgap = lenTypst(sl.label_gap, 'pt');
    if ((sl.title_mode || 'per') === 'shared') {
      // 共用表内标题：用「共用标题」作表内表头（样式＝分区级 label_style）；所有图位照片铺一张网格
      const photos = fields.flatMap(f => photosOf(f));
      body = renderSharedPhotoGrid(photos, sl.shared_title || '', sl.label_style, { cols, width, height, stroke, inset, seamless, solo, headerFollow: sl.header_follow !== false, insetX: sl.inset_x, insetY: sl.inset_y, titleInsetY: sl.title_inset_y });
    } else {
      // 每张一个表内标题：每个 image 字段＝一个图位，字段名作表内标题；尺寸/标题样式/标题距离用分区级
      const slots = fields.map(f => imageFieldToSlot(f, photosOf(f), posMarker('field', f.code)));
      for (const s of slots) { s.width = width; s.height = height; s.labelStyle = sl.label_style; s.caption = undefined; if (lgap) s.labelGap = lgap; }
      body = renderImageSlotsTypst(slots, { stroke, inset, cols, solo, seamless, insetX: sl.inset_x, insetY: sl.inset_y, titleInsetY: sl.title_inset_y });
    }
  } else {
    // 未设分区级布局：逐字段旧行为（向后兼容，零回退）
    const slots = fields.map(f => imageFieldToSlot(f, photosOf(f), posMarker('field', f.code)));
    body = renderImageSlotsTypst(slots, { stroke, inset });
  }
  return topLabel + body + cap;
}

function escapeReg(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function toTypstLiteral(v: any): string {
  if (v === null || v === undefined) return 'none';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  if (Array.isArray(v)) return `(${v.map(toTypstLiteral).join(', ')})`;
  return 'none';
}

function replaceDataLetBlock(source: string, merged: Record<string, any>): string {
  const keys = Object.keys(merged).sort();
  const body = keys.map(k => `  ${k}: ${toTypstLiteral(merged[k])},`).join('\n');
  const block = `#let data = (\n${body}\n)\n`;
  return source.replace(/#let data = \([\s\S]*?\)\n/, block);
}

export function generateTypstWithData(template: RecordTemplate, data: Record<string, any>, opts?: { deviceMap?: Record<string, { name?: string }> }): string {
  let source = generateTypst(template);
  const flatData = flattenDataForDisplay(template, data, opts);

  for (const f of template.groups.flatMap(g => g.fields)) {
    if (f.type === 'data_matrix' && f.matrix) {
      const re = new RegExp(
        `// __MATRIX_BLOCK__:${escapeReg(f.code)}__[\\s\\S]*?// __MATRIX_END__:${escapeReg(f.code)}__`,
        'g'
      );
      const val = normalizeMatrixValue(f.matrix, data[f.code]);
      source = source.replace(re, embedDataMatrixTypst(f, val, false, template));
    }
  }

  // 自由网格(free_grid)：锚点替换成带录入值的版本（录入值 = raw_data[code] 的 `${rowId}::${colId}` 映射，只填录入格）
  for (const f of template.groups.flatMap(g => g.fields)) {
    if (f.type === 'free_grid' && f.free_table) {
      const re = new RegExp(
        `// __FREE_GRID__:${escapeReg(f.code)}__[\\s\\S]*?// __FREE_GRID_END__:${escapeReg(f.code)}__`,
        'g'
      );
      const gv = (data[f.code] && typeof data[f.code] === 'object' && !Array.isArray(data[f.code])) ? data[f.code] : {};
      source = source.replace(re, renderFreeGridTypst(f, f.free_table, gv));
    }
  }

  // 富文本字段：把锚点替换成转换后的内容块（值取自录入数据）
  for (const f of template.groups.flatMap(g => g.fields)) {
    if (!f.rich) continue;
    const re = new RegExp(`// __RICH__:${escapeReg(f.code)}__[\\s\\S]*?// __RICH_END__:${escapeReg(f.code)}__`, 'g');
    source = source.replace(re, richBlock(data[f.code], f.style));
  }

  // 图片记录分区：以 group.id 为锚点替换
  for (const g of template.groups) {
    if (g.section_role !== 'images') continue;
    const re = new RegExp(
      `// __IMAGE_GROUP__:${escapeReg(g.id)}__[\\s\\S]*?// __IMAGE_END__:${escapeReg(g.id)}__`,
      'g'
    );
    // 原始记录：按字段 code 从 record_data 取照片
    source = source.replace(re, renderImageGroupTypst(g, f => Array.isArray(data[f.code]) ? data[f.code] : []));
  }

  const keys = new Set<string>();
  for (const k of collectTypstDataKeys(template)) keys.add(k);
  for (const k of Object.keys(flatData)) keys.add(k);

  const merged: Record<string, any> = {};
  for (const k of keys) {
    merged[k] = flatData[k] ?? null;
  }

  source = replaceDataLetBlock(source, merged);
  return source;
}

/**
 * 把 variant_list / checkbox / select(custom) / data_matrix 等复杂字段展平成 Typst 可注入标量
 */
export function flattenDataForDisplay(template: RecordTemplate, data: Record<string, any>, opts?: { deviceMap?: Record<string, { name?: string }> }): Record<string, any> {
  const result: Record<string, any> = { ...data };
  const allFields = template.groups.flatMap(g => g.fields);

  for (const f of allFields) {
    if (f.type === 'image') {
      // image 字段不进 #let data；通过 __IMAGE_GROUP__ 锚点替换
      delete result[f.code];
      continue;
    }
    if (f.type === 'free_grid') {
      // free_grid 录入值经 __FREE_GRID__ 锚点整块替换渲染，不进 #let data 字典
      delete result[f.code];
      continue;
    }
    const val = data[f.code];
    if (val === undefined || val === null) continue;

    if (f.type === 'data_matrix' && typeof val === 'object') {
      if (val.cells) {
        for (const [k, v] of Object.entries(val.cells)) {
          result[`${f.code}__${k}`] = v;
        }
      }
      if (val.summary_inputs && typeof val.summary_inputs === 'object') {
        for (const [rowId, v] of Object.entries(val.summary_inputs)) {
          const flat = v && typeof v === 'object' && 'custom' in (v as any)
            ? (v as any).custom ?? ''
            : v;
          result[`${f.code}__summary__${rowId}`] = flat;
        }
      }
      // 逐列录入型汇总行：key = `${rowId}__${paramCode}` → `${code}__summary__${rowId}__${paramCode}`（与 per_column_aggregate 同键）
      if (val.summary_row_inputs && typeof val.summary_row_inputs === 'object') {
        const rowFormulas = new Map((f.matrix?.summary_rows || []).map(sr => [sr.id, sr.cell_formulas]));
        for (const [rk, v] of Object.entries(val.summary_row_inputs)) {
          const us = rk.indexOf('__');
          if (us < 0) continue;
          const rowId = rk.slice(0, us), paramCode = rk.slice(us + 2);
          // 该列已配公式 ⇒ 跳过手填值（由 derived 里算好的值占位，不被旧手填覆盖）
          if (rowFormulas.get(rowId)?.[paramCode]) continue;
          const flat = v && typeof v === 'object' && 'custom' in (v as any) ? (v as any).custom ?? '' : v;
          result[matrixSummaryColumnFlatKey(f.code, rowId, paramCode)] = flat;
        }
      }
      delete result[f.code];
      continue;
    }

    if (f.type === 'variant_list' && Array.isArray(val)) {
      const lines = val.map((entry: any) => {
        const variant = (f.variants || []).find((v: any) => v.id === entry.variant_id);
        if (!variant) return '';
        if (variant.render === 'literal') return variant.literal_value || '';
        const parts = (variant.fields || []).map((sf: any) => {
          const sv = entry.values?.[sf.code];
          if (sv === undefined || sv === null || (sv === '' && sf.default_value === undefined)) {
            return `${sf.label}：____${sf.unit ? ' ' + sf.unit : ''}`;
          }
          const display = sv === '' || sv === null ? (sf.default_value ?? '') : stringifySubVal(sf, sv);
          return `${sf.label} ${display}${sf.unit ? sf.unit : ''}`;
        });
        return parts.join(variant.separator || '，');
      }).filter(Boolean);
      result[f.code] = lines.join('；  ');
    } else if (f.type === 'checkbox' && Array.isArray(val)) {
      const items = val.map((v: any) => (v && typeof v === 'object' && v.custom ? v.custom : v)).filter(Boolean);
      result[f.code] = items.join('、');
    } else if (f.type === 'select' && val && typeof val === 'object' && 'custom' in val) {
      result[f.code] = (val as any).custom ?? '';
    } else if (f.type === 'device_ref' && Array.isArray(val)) {
      // 显示「设备名称：管理编号」，多台设备各占一行（\n → 主题 multiline() 渲成 linebreak）。
      // 名称来源：值本身是对象({name,code}) 取 name；否则按 deviceMap[管理编号] 查名（录入端只存管理编号数组）。
      // 查不到名称时退回只显管理编号（旧行为兜底），绝不显示空串。
      const dm = opts?.deviceMap;
      result[f.code] = val.map((d: any) => {
        let code = '', name = '';
        if (d && typeof d === 'object') { code = String(d.code ?? d.asset_code ?? ''); name = String(d.name ?? ''); }
        else { code = String(d ?? ''); }
        if (!name && code && dm) name = String(dm[code]?.name ?? '');
        if (!code) return name;
        return name ? `${name}：${code}` : code;
      }).filter(Boolean).join('\n');
    }
  }
  return formatMatrixDecimalsForDisplay(
    template,
    applyMatrixSummaryFormulas(template, applyMatrixCellFormulas(template, result))
  );
}

/**
 * 显示期小数位：手填数字列按 param.decimals 四舍五入并补零。
 * 必须在全部公式计算**之后**执行——公式仍按原始输入计算，不损失精度。
 * 跳过汇总键（汇总行/列有自己的 decimals）与公式列（用 cell_formula_decimals）。
 */
function formatMatrixDecimalsForDisplay(template: RecordTemplate, flat: Record<string, any>): Record<string, any> {
  let out = flat;
  for (const g of template.groups) {
    for (const f of g.fields) {
      if (f.type !== 'data_matrix' || !f.matrix) continue;
      for (const p of f.matrix.parameters || []) {
        // 生效小数位：列级（存量覆盖）优先，否则整表统一配置
        const decimals = p.decimals ?? f.matrix.decimals;
        if (decimals === undefined || decimals === null || p.cell_formula?.trim()) continue;
        const prefix = `${f.code}__`;
        const suffix = `__${p.code}`;
        for (const k of Object.keys(out)) {
          if (!k.startsWith(prefix) || !k.endsWith(suffix)) continue;
          if (k.includes('__summary__') || k.includes('__sumcol__')) continue;
          const v = out[k];
          const n = typeof v === 'number' ? v : (typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);
          if (!Number.isFinite(n)) continue;
          if (out === flat) out = { ...flat };
          out[k] = n.toFixed(decimals);
        }
      }
    }
  }
  return out;
}

function stringifySubVal(sf: FieldDefinition, sv: any): string {
  if (sf.type === 'select' && sv && typeof sv === 'object' && 'custom' in sv) return String((sv as any).custom ?? '');
  return String(sv);
}

// ─── 报告渲染辅助 ─────────────────────────────────────────────────────────

/** 报告生成时的上下文（每个报告/项目都有自己的） */
export interface ReportRenderCtx {
  order?: { order_no?: string; customer_name?: string; sample_name?: string; received_at?: string };
  /** 委托单订单级扩展字段（接口 PushOrderInfos 1.1 → work_orders.payload.meta）。binding source='order' 的扩展键从这里取。 */
  order_meta?: Record<string, any>;
  /** 取号前（编辑首页草稿）：样品信息表 / 检测结论表尚未确定范围，渲染成占位提示而非填入整单数据。取号后各报告按自己 SampleList 生成。 */
  blank_scope?: boolean;
  /** 委托单全部样品（编号 + 名称 + 序号 + 零件号），供 order_samples 拼接 & 首页样品信息表(report_sample_table)。no 取 sort_no、缺则序号。 */
  order_samples?: Array<{ no: string; name: string; sort_no?: string; model?: string; barcode?: string }>;
  /** 报告样品信息（首页 binding source='report_sample'）：单样品=该样品、多样品=顿号连接兜底。概念上属报告(1.2)而非委托单。 */
  report_sample?: { name?: string; sort_no?: string; model?: string };
  /** 当前项目所属【样品】的接口字段（name/barcode/sort_no/model）。binding source='sample'。 */
  sample_info?: Record<string, any>;
  /** 当前项目【材料分单 / 测试项目】的接口字段（standard/test_method/limit_content/leader…）。binding source='test'。 */
  test_info?: Record<string, any>;
  /** 报告接口（PushReportInfos 1.2）页眉页脚 / 抬头字段（公司/客户/备注/资质 + 报告号/检验码/签发日期，中英文已按语种选中）。binding source='report_meta'。 */
  report_meta?: Record<string, any>;
  /** 用于 conclusion_table：每条 = 表里一行（一个子结论）。P-Map-7：带 sample_no/sample_name（样品分组）、sub_name（子项目名）。同一项目的多个子结论共享 index/name/sample。 */
  project_summary?: Array<{
    index?: number;
    name: string;
    standard?: string;
    conclusion?: string;
    sample_no?: string;
    sample_name?: string;
    sub_name?: string;
  }>;
  /** 用于 equipment_table：已查好的设备表行。trace_date/expire_date 从设备库直接取（溯源/到期日期）。 */
  equipment_rows?: Array<{ name: string; model?: string; asset_code: string; trace_date?: string; expire_date?: string }>;
  /** 当前项目的关联原始记录模板（解析 cell_path 时用） */
  linked_record_template?: RecordTemplate | null;
  /** 当前项目的原始记录数据（已 flatten） */
  record_flat_data?: Record<string, any>;
  /** 当前项目的原始记录原始嵌套数据（用于读 image 字段、device_ref 字段） */
  record_raw_data?: Record<string, any>;
  /** 当前项目原始记录的审核元数据（主检 / 审核 / 检测日期 / 审核日期） */
  record_meta?: { tester_name?: string | null; tested_at?: string | null; reviewer_name?: string | null; reviewed_at?: string | null };
}

/** 解析 CellBinding 为字符串值 */
/** 多样品时报告样品(report_sample)内联字段的缺省占位文案（详见首页样品信息表 / 后续页）。 */
export const REPORT_SAMPLE_MULTI_DEFAULT = '见后续页。';

/** 把带时间的 ISO 日期串规整成「年-月-日」（按中国时区 Asia/Shanghai）；非日期串原样返回。
 *  用于报告里的日期字段（如 接收日期 / 检测周期）只显示年月日、不带时分秒。 */
function formatDateOnly(s: string): string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(s)) return s;
  const d = new Date(s);
  if (isNaN(d.getTime())) return s.slice(0, 10);
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  } catch {
    return s.slice(0, 10);
  }
}

/** 解析数据绑定为字符串值；带时间的日期统一规整为「年-月-日」(formatDateOnly)。 */
export function resolveBinding(b: CellBinding | undefined, ctx: ReportRenderCtx): string {
  return formatDateOnly(resolveBindingInner(b, ctx));
}
function resolveBindingInner(b: CellBinding | undefined, ctx: ReportRenderCtx): string {
  if (!b) return '—';
  switch (b.source) {
    case 'literal':
      return b.text ?? '';
    case 'order': {
      // 历史 4 键（order_no/customer_name/sample_name/received_at）走 ctx.order，
      // 其余订单级扩展字段走 ctx.order_meta（接口 PushOrderInfos 1.1）。
      const legacy = ctx.order?.[b.key as keyof NonNullable<ReportRenderCtx['order']>];
      const v = legacy ?? ctx.order_meta?.[b.key];
      return v === null || v === undefined || v === '' ? `[${b.key}]` : String(v);
    }
    case 'order_samples': {
      // 样品清单（报告范围）：拼 "1#：名称、2#：名称…"。lines → 每样品一行（\n 经 multiline 渲染成换行）。
      const samples = ctx.order_samples || [];
      if (!samples.length) return ctx.order?.sample_name ?? '';
      const single = samples.length === 1;
      const numbered = b.numbered !== false && !single;   // 缺省带编号；单样品不显编号
      const sep = b.layout === 'lines' ? '\n' : (b.separator || '、');
      return samples.map((s, i) => {
        const no = (s.no && String(s.no).trim()) || String(i + 1);
        return numbered ? `${no}#：${s.name ?? ''}` : (s.name ?? '');
      }).join(sep);
    }
    case 'sample': {
      const v = ctx.sample_info?.[b.key];
      return v === null || v === undefined || v === '' ? '—' : String(v);
    }
    case 'test': {
      const v = ctx.test_info?.[b.key];
      return v === null || v === undefined || v === '' ? '—' : String(v);
    }
    case 'report_meta': {
      // 接口 1.2 页眉页脚/抬头字段（公司/客户/备注/资质 + 报告号/检验码/签发日期）。
      const v = ctx.report_meta?.[b.key];
      return v === null || v === undefined || v === '' ? '—' : String(v);
    }
    case 'report_sample': {
      // 报告样品（1.2）：样品名称/样品编号/零件号。系统按实际样品数自动切换：
      //   单样品 → 直接显示该样品值（ctx.report_sample 已由服务端算好）；
      //   多样品 → 首页不堆叠，统一显示 multi_text（缺省「见后续页。」），样品明细走首页样品信息表。
      const sampleCount = ctx.order_samples?.length ?? 0;
      if (sampleCount >= 2) {
        const t = (b.multi_text ?? '').trim();
        return t || REPORT_SAMPLE_MULTI_DEFAULT;
      }
      const v = ctx.report_sample?.[b.key];
      return v === null || v === undefined || v === '' ? '—' : String(v);
    }
    case 'system':
      if (b.key === 'today') return new Date().toISOString().slice(0, 10);
      if (b.key === 'now') return new Date().toLocaleString();
      return '';
    case 'record_field': {
      const v = ctx.record_flat_data?.[b.field_code];
      // 处理 select 自定义值 / checkbox 数组
      if (v && typeof v === 'object' && 'custom' in v) return String((v as any).custom ?? '');
      if (Array.isArray(v)) return v.map(x => typeof x === 'object' && 'custom' in x ? (x as any).custom : x).filter(x => x).join('、');
      return v === null || v === undefined || v === '' ? '—' : String(v);
    }
    case 'record_cell': {
      const k = `${b.matrix_code}__s${b.sample_idx}__${b.param_code}`;
      const v = ctx.record_flat_data?.[k];
      return v === null || v === undefined || v === '' ? '—' : String(v);
    }
    case 'record_summary': {
      const k = b.param_code
        ? `${b.matrix_code}__summary__${b.row_id}__${b.param_code}`
        : `${b.matrix_code}__summary__${b.row_id}`;
      const v = ctx.record_flat_data?.[k];
      return v === null || v === undefined || v === '' ? '—' : String(v);
    }
    case 'record_header': {
      // P-Map-9：原始记录矩阵表头上录入时所选的单位/备注（parameter_unit_overrides[param_code]）。
      // 无 override 时回退矩阵参数列静态 unit；仍无 ⇒ 返回 ''（表头渲染据此省略括号备注，不显示 —）。
      const raw = ctx.record_raw_data?.[b.matrix_code];
      const ov = raw && typeof raw === 'object' ? raw.parameter_unit_overrides?.[b.param_code] : undefined;
      if (ov !== undefined && ov !== null && String(ov).trim() !== '') return String(ov);
      const p = findMatrixConfig(ctx.linked_record_template, b.matrix_code)?.parameters?.find(x => x.code === b.param_code);
      return p?.unit ? String(p.unit) : '';
    }
    case 'record_cell_sample':
    case 'record_sample_label':
    case 'record_sample_index':
      // P-Map-10：样品带单元格——正常由 expandResultTableBand 在渲染前解析为字面量；
      // 裸调用（不在带上下文）无"当前样品"，回退占位。
      return '—';
    case 'record_formula':
      return '—';
    case 'record_meta': {
      const v = ctx.record_meta?.[b.key];
      if (!v) return '—';
      // 日期类只显示日期部分
      if (b.key === 'tested_at' || b.key === 'reviewed_at') {
        try { return new Date(v).toISOString().slice(0, 10); } catch { return String(v); }
      }
      return String(v);
    }
  }
  return '';
}

/** 渲染 report_conclusion_table */
/** rowspan 单元格：span>1 用 table.cell(rowspan)，否则普通 [内容]。 */
function rowspanCell(span: number, content: string): string {
  return span > 1 ? `table.cell(rowspan: ${span})[${content}]` : `[${content}]`;
}

/**
 * 统一「自由编辑表格」渲染：任意文本网格（表头 + 单元格皆纯文本）。三类报告表共用。
 * 列宽走 colWidthSpec（fr/cm/pt/%，空=auto）、行高用零宽 box 兜底最小高、表头/内容按 table_style 加粗，
 * 标题走 wrapFigure、整表字体走 tableStyleWrap——与各表自动模式同口径。
 */
export function renderFreeTableTypst(field: FieldDefinition, ft: NonNullable<FieldDefinition['free_table']>): string {
  const cols = ft.columns || [];
  if (!cols.length) return wrapFigure(field, '#text(fill: gray)[（空表）]');
  const ts = field.table_style;
  const headerBold = ts?.header_bold !== false;
  const bodyBold = ts?.body_bold === true;
  const tFont = ts?.font;
  const colSpec = cols.map(c => colWidthSpec(c.width)).join(', ');
  const out: string[] = [];
  out.push(`#table(columns: (${colSpec}), stroke: 0.5pt, inset: (x: 8pt, y: ${STD_TABLE_INSET_Y}pt), align: center + horizon,`);
  // 单元格/表头是【内容模式】（[...]），值可能含 # [ ] * 等（如样品编号 1#）——必须用 escapeTypstMarkup。
  out.push('  ' + cols.map(c => `[${tableCellBold(escapeTypstMarkup(c.label || ''), headerBold, tFont)}]`).join(', ') + ',');
  const rows = ft.rows || [];
  if (!rows.length) {
    out.push(`  table.cell(colspan: ${cols.length})[#text(fill: gray)[（空表）]],`);
  } else {
    // 合并：先算出被主格 span 覆盖的格子（按行列序号），渲染时跳过、主格 emit table.cell(colspan,rowspan)
    const colIdxOf = new Map(cols.map((c, i) => [c.id, i]));
    const rowIdxOf = new Map(rows.map((r, i) => [r.id, i]));
    const covered = new Set<string>();
    for (const [key, sp] of Object.entries(ft.spans || {})) {
      const [rid, cid] = key.split('::');
      const ri = rowIdxOf.get(rid), ci = colIdxOf.get(cid);
      if (ri == null || ci == null) continue;
      const cs = Math.min(Math.max(sp?.colspan ?? 1, 1), cols.length - ci);
      const rs = Math.min(Math.max(sp?.rowspan ?? 1, 1), rows.length - ri);
      for (let dr = 0; dr < rs; dr++) for (let dc = 0; dc < cs; dc++) { if (dr || dc) covered.add(`${ri + dr},${ci + dc}`); }
    }
    rows.forEach((r, ri) => {
      const h = r.height && /^\d+(\.\d+)?(cm|mm|pt|em|in)$/i.test(String(r.height).trim()) ? String(r.height).trim() : '';
      let pendingMinH = h ? `#box(width: 0pt, height: ${h})` : '';   // 放进本行第一个【出格】的单元格 → 最小行高
      const cells: string[] = [];
      cols.forEach((c, ci) => {
        if (covered.has(`${ri},${ci}`)) return;   // 被合并主格盖住：不出格
        const v = ft.cells?.[`${r.id}::${c.id}`] ?? '';
        const sp = ft.spans?.[`${r.id}::${c.id}`];
        const cs = Math.min(Math.max(sp?.colspan ?? 1, 1), cols.length - ci);
        const rs = Math.min(Math.max(sp?.rowspan ?? 1, 1), rows.length - ri);
        const body = `${pendingMinH}${tableCellBold(escapeTypstMarkup(v), bodyBold, tFont)}`;
        pendingMinH = '';
        cells.push((cs > 1 || rs > 1) ? `table.cell(colspan: ${cs}, rowspan: ${rs})[${body}]` : `[${body}]`);
      });
      out.push('  ' + cells.join(', ') + ',');
    });
  }
  out.push(')');
  return wrapFigure(field, tableStyleWrap(out.join('\n'), ts));
}

/**
 * F2：free_grid 样品带预展开。把标记为「样品带」的那一行/列，按录入样品数 N 复制成 N 份，
 * 带内格子的 record_cell_sample/record_sample_label/record_sample_index 绑定按各样品落成字面量，
 * 返回一张无 band 的普通网格，交给 renderFreeGridTypst 现有逻辑。与 expandResultTableBand 同口径。
 */
function expandFreeGridBand(
  ft: NonNullable<FieldDefinition['free_table']>,
  ctx: ReportRenderCtx,
): NonNullable<FieldDefinition['free_table']> {
  const band = ft.sample_band;
  if (!band || !band.matrix_code || !band.ref) return ft;
  const flat = ctx.record_flat_data || {};
  const sids = deriveMatrixSampleIds(flat, band.matrix_code);
  if (!sids.length) return ft;
  const rawVal = ctx.record_raw_data?.[band.matrix_code] as any;
  const labels: Record<string, string> = (rawVal && typeof rawVal === 'object' && rawVal.sample_labels) ? rawVal.sample_labels : {};
  const prefix = findMatrixConfig(ctx.linked_record_template, band.matrix_code)?.row_header_prefix || '试样';
  const sampleLabel = (sid: string, i: number) => labels[sid] || `${prefix} ${i + 1}`;
  const concretize = (b: CellBinding, sid: string, i: number): CellBinding => {
    if (b.source === 'record_cell_sample') {
      const v = flat[`${band.matrix_code}__${sid}__${b.param_code}`];
      return { source: 'literal', text: v === null || v === undefined ? '' : String(v) };
    }
    if (b.source === 'record_sample_label') return { source: 'literal', text: sampleLabel(sid, i) };
    if (b.source === 'record_sample_index') return { source: 'literal', text: String(i + 1) };
    return b;
  };

  const isRow = band.axis !== 'col';
  const cols = ft.columns || [];
  const rows = ft.rows || [];
  const axisArr: Array<{ id: string }> = isRow ? rows : cols;
  if (!axisArr.length) return ft;
  let idx = axisArr.findIndex(x => x.id === band.ref);
  if (idx < 0) idx = 0;
  const bandId = axisArr[idx].id;
  const touches = (rid: string, cid: string) => isRow ? rid === bandId : cid === bandId;
  const remapKey = (rid: string, cid: string, sid: string) => isRow ? `${bandId}#${sid}::${cid}` : `${rid}::${bandId}#${sid}`;
  function remap<T>(m: Record<string, T> | undefined, xf?: (v: T, sid: string, i: number) => T): Record<string, T> {
    const out: Record<string, T> = {};
    for (const [k, v] of Object.entries(m || {})) {
      const [rid, cid] = k.split('::');
      if (!touches(rid, cid)) { out[k] = v; continue; }
      sids.forEach((sid, i) => { out[remapKey(rid, cid, sid)] = xf ? xf(v, sid, i) : v; });
    }
    return out;
  }
  const newRows = isRow
    ? [...rows.slice(0, idx), ...sids.map(sid => ({ ...rows[idx], id: `${bandId}#${sid}` })), ...rows.slice(idx + 1)]
    : rows;
  const newCols = !isRow
    ? [...cols.slice(0, idx), ...sids.map(sid => ({ ...cols[idx], id: `${bandId}#${sid}`, label: cols[idx].label ?? '' })), ...cols.slice(idx + 1)]
    : cols;
  return {
    ...ft,
    sample_band: undefined,
    rows: newRows,
    columns: newCols,
    cells: remap(ft.cells),
    spans: remap(ft.spans),
    header_cells: remap(ft.header_cells),
    input_cells: remap(ft.input_cells),
    cell_bindings: remap(ft.cell_bindings, (b, sid, i) => concretize(b, sid, i)),
  };
}

/**
 * F0 统一自由网格（free_grid 字段）渲染。与 renderFreeTableTypst 的区别：
 *  - 不强制"列标签表头行"——所有内容都来自 rows×cells（列只提供 id/宽度）；
 *  - `header_cells` 里的格子加粗（表头也是普通格、可自由合并）；
 *  - `dataOverride`（录入值，键 `rowId::colId`）优先于模板 `cells`（供录入/带数据渲染，见 F0 录入切片）。
 */
export function renderFreeGridTypst(
  field: FieldDefinition,
  ft: NonNullable<FieldDefinition['free_table']>,
  dataOverride?: Record<string, any>,
  ctx?: ReportRenderCtx,
): string {
  // F2：报告侧样品带按录入样品数预展开（无 band / 无 ctx ⇒ 原样）
  if (ctx && ft.sample_band) ft = expandFreeGridBand(ft, ctx);
  const cols = ft.columns || [];
  const rows = ft.rows || [];
  if (!cols.length || !rows.length) return wrapFigure(field, '#text(fill: gray)[（空网格）]');
  const ts = field.table_style;
  const tFont = ts?.font;
  const colSpec = cols.map(c => colWidthSpec(c.width)).join(', ');
  const out: string[] = [`#table(columns: (${colSpec}), stroke: 0.5pt, inset: (x: 8pt, y: ${STD_TABLE_INSET_Y}pt), align: center + horizon,`];
  // 合并：算被主格 span 覆盖的格（行列序号），渲染时跳过
  const colIdxOf = new Map(cols.map((c, i) => [c.id, i]));
  const rowIdxOf = new Map(rows.map((r, i) => [r.id, i]));
  const covered = new Set<string>();
  for (const [key, sp] of Object.entries(ft.spans || {})) {
    const [rid, cid] = key.split('::');
    const ri = rowIdxOf.get(rid), ci = colIdxOf.get(cid);
    if (ri == null || ci == null) continue;
    const cs = Math.min(Math.max(sp?.colspan ?? 1, 1), cols.length - ci);
    const rs = Math.min(Math.max(sp?.rowspan ?? 1, 1), rows.length - ri);
    for (let dr = 0; dr < rs; dr++) for (let dc = 0; dc < cs; dc++) { if (dr || dc) covered.add(`${ri + dr},${ci + dc}`); }
  }
  rows.forEach((r, ri) => {
    const h = r.height && /^\d+(\.\d+)?(cm|mm|pt|em|in)$/i.test(String(r.height).trim()) ? String(r.height).trim() : '';
    let pendingMinH = h ? `#box(width: 0pt, height: ${h})` : '';
    const cells: string[] = [];
    cols.forEach((c, ci) => {
      if (covered.has(`${ri},${ci}`)) return;   // 被合并主格盖住：不出格
      const key = `${r.id}::${c.id}`;
      // 取值优先级：报告侧绑定(resolveBinding) > 录入值(dataOverride) > 模板固定文字(cells)
      const bindVal = (ctx && ft.cell_bindings?.[key]) ? resolveBinding(ft.cell_bindings[key], ctx) : undefined;
      const ov = dataOverride ? dataOverride[key] : undefined;
      const raw = (bindVal != null && bindVal !== '') ? bindVal
        : (ov != null && ov !== '') ? ov
        : (ft.cells?.[key] ?? '');
      const isHeader = !!ft.header_cells?.[key];
      const sp = ft.spans?.[key];
      const cs = Math.min(Math.max(sp?.colspan ?? 1, 1), cols.length - ci);
      const rs = Math.min(Math.max(sp?.rowspan ?? 1, 1), rows.length - ri);
      const body = `${pendingMinH}${tableCellBold(escapeTypstMarkup(String(raw)), isHeader, tFont)}`;
      pendingMinH = '';
      cells.push((cs > 1 || rs > 1) ? `table.cell(colspan: ${cs}, rowspan: ${rs})[${body}]` : `[${body}]`);
    });
    out.push('  ' + cells.join(', ') + ',');
  });
  out.push(')');
  return wrapFigure(field, tableStyleWrap(out.join('\n'), ts));
}

export function renderConclusionTableTypst(field: FieldDefinition, ctx: ReportRenderCtx): string {
  // 取号前（编辑首页草稿）：检测结论随报告编号(1.2)的样品×项目范围确定，尚未取号 → 出灰字占位。
  if (ctx.blank_scope) return wrapFigure(field, '#block(width: 100%)[#text(fill: gray)[（检测结论 — 取号后按报告编号自动生成）]]');
  // 统一自由编辑表格优先（一键把当前内容快照成纯文本网格后逐格可改）。
  if (field.free_table?.columns?.length) return renderFreeTableTypst(field, field.free_table);
  const cfg = field.conclusion_table || {};

  // 自由编辑模式：任意网格（列宽 fr/cm、行高 cm、表头/单元格自由填）。脱离样品/项目语义列与自动展开。
  if (cfg.free && Array.isArray(cfg.free_columns) && cfg.free_columns.length) {
    const fcols = cfg.free_columns;
    const colSpec = fcols.map(c => colWidthSpec(c.width)).join(', ');
    const insetY0 = lenTypst(cfg.cell_inset_y, 'pt');
    const insetSpec0 = insetY0 ? `(x: 8pt, y: ${insetY0})` : `(x: 8pt, y: ${STD_TABLE_INSET_Y}pt)`;
    const out: string[] = [];
    out.push(`#table(columns: (${colSpec}), stroke: 0.5pt, inset: ${insetSpec0}, align: center + horizon,`);
    out.push('  ' + fcols.map(c => `[*${escapeTypst(c.label || '')}*]`).join(', ') + ',');
    const frows = Array.isArray(cfg.free_rows) ? cfg.free_rows : [];
    if (!frows.length) {
      out.push(`  table.cell(colspan: ${fcols.length})[#text(fill: gray)[（空表）]],`);
    } else {
      frows.forEach(r => {
        const h = r.height && /^\d+(\.\d+)?(cm|mm|pt|em|in)$/i.test(String(r.height).trim()) ? String(r.height).trim() : '';
        const minH = h ? `#box(width: 0pt, height: ${h})` : '';   // 行首格放零宽 box → 最小行高
        out.push('  ' + fcols.map((c, ci) => {
          const v = cfg.free_cells?.[`${r.id}::${c.id}`] ?? '';
          return `[${ci === 0 ? minH : ''}${escapeTypst(v)}]`;
        }).join(', ') + ',');
      });
    }
    out.push(')');
    return wrapFigure(field, out.join('\n'));
  }

  const rows = ctx.project_summary || [];
  // 样品列显示：auto=多样品才显示（单样品自动隐藏样品列）；show/hide=强制
  const distinctSamples = new Set(rows.map(r => r.sample_no).filter(Boolean));
  const hasSample = distinctSamples.size > 0;
  const sampleMode = cfg.sample_col || 'auto';
  const showSample = sampleMode === 'show' ? true : sampleMode === 'hide' ? false : distinctSamples.size > 1;
  // 列：配置优先；缺省按是否有样品给默认；再据 showSample 增删 'sample'
  let cols: Array<'sample' | 'index' | 'project' | 'standard' | 'result'> =
    (cfg.columns && cfg.columns.length) ? [...cfg.columns]
      : (hasSample ? ['sample', 'index', 'project', 'result'] : ['index', 'project', 'result']);
  if (showSample && !cols.includes('sample')) cols = ['sample', ...cols];
  if (!showSample) cols = cols.filter(c => c !== 'sample');

  const colLabels: Record<string, string> = {
    sample: '样品', index: '序号', project: '项目', standard: '标准', result: '结论',
    ...(cfg.column_labels || {}),
  };
  // 列宽：按【列名】映射（样品列因 sample_col 自动增减、或列重排都不串位）。新版 col_widths_map（按名）；
  // 兼容旧位置数组 col_widths（按 cfg.columns/默认 同序）。缺省 序号/样品列自适应（窄），其余均分页宽。
  const widthByKey: Record<string, string> = {};
  const legacySrc = (cfg.columns && cfg.columns.length) ? cfg.columns : ['index', 'project', 'result'];
  legacySrc.forEach((c, i) => { if (cfg.col_widths?.[i]) widthByKey[c] = cfg.col_widths![i]!; });
  for (const [k, v] of Object.entries(cfg.col_widths_map || {})) { if (v) widthByKey[k] = v as string; }
  const colSpec = cols.map(c => {
    const w = widthByKey[c];
    return w ? colWidthSpec(w) : (c === 'index' || c === 'sample' ? 'auto' : '1fr');
  }).join(', ');

  // 标题：不再自带居中标题——统一走 wrapFigure（field.label 标题、居左、字体跟随模板、由「显示标签」开关控制）。
  // 行高＝单元格上下留白 cell_inset_y（缺省 8pt），与结果表/设备表同口径。
  // 整表文字样式（「版式」Tab）：表头加粗（缺省 true）/ 内容加粗（缺省 false）/ 字体 / 内容对齐（缺省 center）。font/size 在 return 处 tableStyleWrap 包裹。
  const ts = field.table_style;
  const headerBold = ts?.header_bold !== false;
  const bodyBold = ts?.body_bold === true;
  const tFont = ts?.font;
  const alignKw = `${ts?.cell_align || 'center'} + horizon`;
  const insetY = lenTypst(cfg.cell_inset_y, 'pt');
  const insetSpec = insetY ? `(x: 8pt, y: ${insetY})` : `(x: 8pt, y: ${STD_TABLE_INSET_Y}pt)`;
  const lines: string[] = [];
  lines.push(`#table(columns: (${colSpec}), stroke: 0.5pt, inset: ${insetSpec}, align: ${alignKw},`);
  lines.push('  ' + cols.map(c => `[${tableCellBold(escapeTypst(colLabels[c] || c), headerBold, tFont)}]`).join(', ') + ',');

  if (cfg.manual && Array.isArray(cfg.rows)) {
    // 手动固化：扁平渲染（无 rowspan 分组）
    if (cfg.rows.length === 0) {
      lines.push(`  table.cell(colspan: ${cols.length})[#text(fill: gray)[（无项目数据）]],`);
    } else {
      cfg.rows.forEach((r, i) => {
        lines.push('  ' + cols.map(c =>
          c === 'index' ? `[${tableCellBold(escapeTypst(r.index ?? String(i + 1)), bodyBold, tFont)}]` : `[${tableCellBold(escapeTypst((r as Record<string, string>)[c] ?? ''), bodyBold, tFont)}]`
        ).join(', ') + ',');
      });
    }
  } else if (rows.length === 0) {
    lines.push(`  table.cell(colspan: ${cols.length})[#text(fill: gray)[（无项目数据）]],`);
  } else {
    // 自动展开：每条 project_summary = 一行（一个子结论）；按 样品 / 序号(项目) 做 rowspan 分组。
    // 依赖入参已按 样品→项目 排序（buildReportTypst 负责）；渲染端只按"连续相同"分组。
    const sampleFirst = rows.map((r, i) => i === 0 || r.sample_no !== rows[i - 1].sample_no);
    const projFirst = rows.map((r, i) => i === 0 || r.index !== rows[i - 1].index || r.sample_no !== rows[i - 1].sample_no);
    const spanFrom = (firsts: boolean[], i: number) => { let n = 1; while (i + n < firsts.length && !firsts[i + n]) n++; return n; };
    rows.forEach((r, i) => {
      const cells: string[] = [];
      for (const c of cols) {
        if (c === 'sample') {
          // 样品号显示成 "1#"；# 是 Typst markup 特殊字符，需转义成 \#（否则被当代码起始报错）。
          if (sampleFirst[i]) {
            const noTxt = r.sample_no ? escapeTypst(String(r.sample_no).replace(/#\s*$/, '')) + '\\#' : '';
            cells.push(rowspanCell(spanFrom(sampleFirst, i), tableCellBold(noTxt, bodyBold, tFont)));
          }
        }
        else if (c === 'index') { if (projFirst[i]) cells.push(rowspanCell(spanFrom(projFirst, i), tableCellBold(String(r.index ?? i + 1), bodyBold, tFont))); }
        else if (c === 'standard') { if (projFirst[i]) cells.push(rowspanCell(spanFrom(projFirst, i), tableCellBold(escapeTypst(r.standard ?? '—'), bodyBold, tFont))); }
        else if (c === 'project') cells.push(`[${tableCellBold(escapeTypst(r.sub_name || r.name || ''), bodyBold, tFont)}]`);
        else if (c === 'result') cells.push(`[${tableCellBold(escapeTypst(r.conclusion ?? '—'), bodyBold, tFont)}]`);
      }
      lines.push('  ' + cells.join(', ') + ',');
    });
  }
  lines.push(')');
  // wrapFigure：标题(field.label，居左、跟随模板字体、hide_label 开关) + 备注(field.caption) + 题注位置 + 标题/备注间距 + 段前后间距，与其余图表统一。
  // tableStyleWrap：整表字体/字号（table_style.font/font_size）包裹全表。
  return wrapFigure(field, tableStyleWrap(lines.join('\n'), ts));
}

/** 找关联原始记录里某 data_matrix 字段的配置 */
function findMatrixConfig(recTpl: RecordTemplate | null | undefined, matrixCode: string): DataMatrixConfig | undefined {
  for (const g of recTpl?.groups || []) {
    for (const f of g.fields || []) {
      if (f.type === 'data_matrix' && f.code === matrixCode && f.matrix) return f.matrix;
    }
  }
  return undefined;
}

/**
 * 从已展平数据里按【首次出现顺序】派生某矩阵实际录入的样品 id 列表。
 * 通用于编辑器预览（record_raw_data 是扁平 mock）与真实出报告（flat 由 record_data 展平）——
 * 二者的 flat 都含 `${matrixCode}__${sampleId}__${paramCode}` 键。跳过 summary/sumcol 虚拟键。
 */
function deriveMatrixSampleIds(flat: Record<string, any>, matrixCode: string): string[] {
  const prefix = `${matrixCode}__`;
  const seen: string[] = [];
  const set = new Set<string>();
  for (const k of Object.keys(flat)) {
    if (!k.startsWith(prefix)) continue;
    const seg = k.slice(prefix.length).split('__');
    if (seg.length < 2) continue;            // 需要 sid__param
    const sid = seg[0];
    if (sid === 'summary' || sid === 'sumcol') continue;
    if (!set.has(sid)) { set.add(sid); seen.push(sid); }
  }
  return seen;
}

/**
 * P-Map-1：矩阵驱动的动态结果表。按实际录入样品数展开行（不再逐格 sample_idx 绑定）。
 * 样品 id 从 flat 键派生（保证与录入一致）；样品名优先取嵌套 raw 的 sample_labels，回退「{前缀} N」；
 * 单元格值读 flat 的 `${matrixCode}__${sid}__${paramCode}`（已含 computed 值）。
 */
/**
 * 报告表（结果表 / 设备表）的显示版式（与数据矩阵 embedDataMatrixTypst 同口径）。
 * 缺省＝旧行为：尽量同页 + 跨页重复表头 + inset 8pt + 居中 + 空值符「—」。
 */
function resultTableLayout(o?: {
  keep_together?: boolean;
  repeat_header_on_break?: boolean;
  cell_inset_y?: string;
  cell_align?: 'left' | 'center' | 'right';
  empty_cell_display?: string;
}) {
  const insetY = lenTypst(o?.cell_inset_y, 'pt');
  return {
    keepTogether: o?.keep_together !== false,
    repeatHeader: o?.repeat_header_on_break !== false,
    insetSpec: insetY ? `(x: 8pt, y: ${insetY})` : `(x: 8pt, y: ${STD_TABLE_INSET_Y}pt)`,
    alignKw: `${o?.cell_align || 'center'} + horizon`,
    empty: o?.empty_cell_display && String(o.empty_cell_display).length ? String(o.empty_cell_display) : '—',
  };
}

/**
 * 多级表头：数据列可选 `group` → 相邻同组列合并成上层超级表头（两行表头），
 * 与数据矩阵列分组同口径。无任一分组 → 单行表头。
 * dataCols.inner / leading / trailing 都是「不含外层方括号」的已格式化 markup；
 * groupFmt 把分组名格式化成超级表头内容（不含方括号）。返回 table.header 内部内容（不含 table.header() 包裹）。
 */
function groupedHeaderCells(
  dataCols: Array<{ inner: string; group?: string }>,
  leading: string[],
  trailing: string[],
  groupFmt: (g: string) => string,
): string {
  const hasGroups = dataCols.some(c => (c.group || '').trim());
  if (!hasGroups) {
    return [...leading.map(m => `[${m}]`), ...dataCols.map(c => `[${c.inner}]`), ...trailing.map(m => `[${m}]`)].join(', ');
  }
  const row1: string[] = leading.map(m => `table.cell(rowspan: 2)[${m}]`);
  const row2: string[] = [];
  let i = 0;
  while (i < dataCols.length) {
    const g = (dataCols[i].group || '').trim();
    if (!g) { row1.push(`table.cell(rowspan: 2)[${dataCols[i].inner}]`); i++; }
    else {
      let j = i;
      while (j < dataCols.length && (dataCols[j].group || '').trim() === g) j++;
      row1.push(`table.cell(colspan: ${j - i})[${groupFmt(g)}]`);
      for (let k = i; k < j; k++) row2.push(`[${dataCols[k].inner}]`);
      i = j;
    }
  }
  for (const m of trailing) row1.push(`table.cell(rowspan: 2)[${m}]`);
  return [...row1, ...row2].join(', ');
}

/** P-Map-9：解析表头槽位绑定。返回 resolve 后的非空文本；无绑定/解析为空/占位「—」⇒ undefined（调用方回退字面量）。 */
function resolveHeaderSlot(b: CellBinding | undefined, ctx: ReportRenderCtx): string | undefined {
  if (!b) return undefined;
  const v = resolveBinding(b, ctx);
  return v && v !== '—' && String(v).trim() !== '' ? v : undefined;
}

/**
 * P-Map-10：样品带预展开。把静态结果表里被标记为"样品带"的那一行/列，按实际录入样品数 N
 * 复制成 N 行/列（带内单元格的 record_cell_sample / record_sample_label 按各样品 sid 解析为字面量），
 * 返回一张**普通静态表**（无 band），交给现有渲染逻辑——合并格/汇总行列/行高等全部不动。
 * 无 band / 无样品 / ref 不存在 ⇒ 原样返回（向后兼容）。
 */
function expandResultTableBand(
  cfg: NonNullable<FieldDefinition['result_table']>,
  ctx: ReportRenderCtx,
): NonNullable<FieldDefinition['result_table']> {
  const band = cfg.band;
  if (!band || !band.matrix_code || !band.ref_id) return cfg;
  const flat = ctx.record_flat_data || {};
  const sids = deriveMatrixSampleIds(flat, band.matrix_code);
  const rawVal = ctx.record_raw_data?.[band.matrix_code];
  const labels: Record<string, string> =
    rawVal && typeof rawVal === 'object' && rawVal.sample_labels ? rawVal.sample_labels : {};
  const prefix = findMatrixConfig(ctx.linked_record_template, band.matrix_code)?.row_header_prefix || '试样';
  const sampleLabel = (sid: string, i: number) => labels[sid] || `${prefix} ${i + 1}`;
  // 把带内单元格的"当前样品"绑定按某 sid 落成字面量；其余来源原样保留（每份重复出相同值）
  const concretize = (b: CellBinding, sid: string, i: number): CellBinding => {
    if (b.source === 'record_cell_sample') {
      const v = flat[`${band.matrix_code}__${sid}__${b.param_code}`];
      return { source: 'literal', text: v === null || v === undefined ? '' : String(v) };
    }
    if (b.source === 'record_sample_label') return { source: 'literal', text: sampleLabel(sid, i) };
    if (b.source === 'record_sample_index') return { source: 'literal', text: String(i + 1) };  // 样品序号自动 1,2,3…
    return b;
  };

  if (band.axis === 'row') {
    // ref_id 缺省/失效时用第一行（画布已不再让用户选具体行，"按样品出行"即第一条数据行作样板）
    let ri = cfg.rows.findIndex(r => r.id === band.ref_id);
    if (ri < 0) ri = 0;
    if (!cfg.rows.length) return cfg;
    const bandRowId = cfg.rows[ri].id;
    const tmplRow = cfg.rows[ri];
    const tmplCells = cfg.cells.filter(c => c.rowId === bandRowId);
    const otherCells = cfg.cells.filter(c => c.rowId !== bandRowId);
    const newRows = sids.map(sid => ({ ...tmplRow, id: `${bandRowId}#${sid}` }));
    const newCells = sids.flatMap((sid, i) =>
      tmplCells.map(c => ({ ...c, rowId: `${bandRowId}#${sid}`, binding: concretize(c.binding, sid, i) })));
    return { ...cfg, band: undefined, rows: [...cfg.rows.slice(0, ri), ...newRows, ...cfg.rows.slice(ri + 1)], cells: [...otherCells, ...newCells] };
  } else {
    let ci = cfg.columns.findIndex(c => c.id === band.ref_id);
    if (ci < 0) ci = 0;
    if (!cfg.columns.length) return cfg;
    const bandColId = cfg.columns[ci].id;
    const tmplCol = cfg.columns[ci];
    const tmplCells = cfg.cells.filter(c => c.colId === bandColId);
    const otherCells = cfg.cells.filter(c => c.colId !== bandColId);
    // 列样板：每个样品一列。列头标题/备注的绑定也按"当前样品"逐列落地（与"按样品出行"行格同口径）——
    // 这样把列头绑定到「样品序号 record_sample_index」即可让试样编号在列表头 1,2,3… 递增；未绑则用样品名兜底。
    const newCols = sids.map((sid, i) => ({
      ...tmplCol, id: `${bandColId}#${sid}`, label: sampleLabel(sid, i),
      label_binding: tmplCol.label_binding ? concretize(tmplCol.label_binding, sid, i) : tmplCol.label_binding,
      note_binding: tmplCol.note_binding ? concretize(tmplCol.note_binding, sid, i) : tmplCol.note_binding,
    }));
    const newCells = sids.flatMap((sid, i) =>
      tmplCells.map(c => ({ ...c, colId: `${bandColId}#${sid}`, binding: concretize(c.binding, sid, i) })));
    return { ...cfg, band: undefined, columns: [...cfg.columns.slice(0, ci), ...newCols, ...cfg.columns.slice(ci + 1)], cells: [...otherCells, ...newCells] };
  }
}

/** 渲染 report_result_table */
export function renderReportResultTableTypst(field: FieldDefinition, ctx: ReportRenderCtx): string {
  if (field.free_table?.columns?.length) return renderFreeTableTypst(field, field.free_table);
  const rawCfg = field.result_table;
  // P-Map-10：样品带预展开（无 band 时原样返回）
  const cfg = rawCfg ? expandResultTableBand(rawCfg, ctx) : rawCfg;
  if (!cfg || !cfg.columns?.length || !cfg.rows?.length) {
    return '#text(fill: gray)[（结果表未配置）]';
  }
  const cols = cfg.columns;
  const rows = cfg.rows;
  const cells = cfg.cells || [];
  const sumCols = cfg.summary_cols || [];
  const sumRows = cfg.summary_rows || [];
  // 整表文字样式：表头加粗（缺省 true）、内容加粗（缺省 false）、字体（用于 faux-bold 描边判断）。font/size 在 return 处 wrap。
  const ts = field.table_style;
  const headerBold = ts?.header_bold !== false;
  const bodyBold = ts?.body_bold === true;
  const tFont = ts?.font;
  // 列宽：数据列、汇总列都用各自 width（缺省 1fr，可由编辑器拖拽设置）
  const colSpec = [
    ...cols.map(c => colWidthSpec(c.width)),
    ...sumCols.map(sc => sc.width ? colWidthSpec(sc.width) : '1fr'),
  ].join(', ');
  const L = resultTableLayout(cfg);
  const lines: string[] = [];
  lines.push(`#table(columns: (${colSpec}), stroke: 0.5pt, inset: ${L.insetSpec}, align: ${L.alignKw},`);
  // 表头：数据列（可分组成多级表头 + 列头括号备注）+ 汇总列；跨页时按 repeat 重复表头
  // P-Map-9：列头标题/备注可绑定（优先于字面量）
  const dataHeadCells = cols.map(c => {
    const label = resolveHeaderSlot(c.label_binding, ctx) ?? c.label;
    const note = resolveHeaderSlot(c.note_binding, ctx) ?? c.note;
    return {
      inner: tableCellBold(escapeTypst(note && note.trim() ? `${label}（${note.trim()}）` : label), headerBold, tFont),
      group: c.group,
    };
  });
  // P-Map-12：汇总列表头标题/备注与数据列同口径可绑定
  const sumHeadCells = sumCols.map(sc => {
    const label = resolveHeaderSlot(sc.label_binding, ctx) ?? sc.label;
    const note = resolveHeaderSlot(sc.note_binding, ctx) ?? sc.note;
    return tableCellBold(escapeTypst(note && note.trim() ? `${label}（${note.trim()}）` : label), headerBold, tFont);
  });
  const headerInner = groupedHeaderCells(dataHeadCells, [], sumHeadCells, g => tableCellBold(escapeTypst(g), headerBold, tFont));
  lines.push(`  table.header(repeat: ${L.repeatHeader}, ${headerInner}),`);
  // 合并单元格：先算出被主格 span 覆盖的格子（按行列序号），渲染时跳过，主格 emit table.cell(colspan,rowspan)
  const colIdxOf = new Map(cols.map((c, i) => [c.id, i]));
  const rowIdxOf = new Map(rows.map((r, i) => [r.id, i]));
  const covered = new Set<string>();
  for (const cell of cells) {
    const rs = cell.rowspan ?? 1;
    const cs = cell.colspan ?? 1;
    if (rs <= 1 && cs <= 1) continue;
    const ri = rowIdxOf.get(cell.rowId);
    const ci = colIdxOf.get(cell.colId);
    if (ri == null || ci == null) continue;
    for (let dr = 0; dr < rs; dr++) for (let dc = 0; dc < cs; dc++) {
      if (dr === 0 && dc === 0) continue;
      covered.add(`${ri + dr},${ci + dc}`);
    }
  }
  // 数据行：数据格 + 汇总列在第一行用 rowspan 跨所有数据行
  for (let ri = 0; ri < rows.length; ri++) {
    const r = rows[ri];
    const cellTexts: string[] = [];
    // 最小行高：本行第一个出格的单元格内放零宽 box——行至少这么高、内容多时仍自动撑开（与数据矩阵行高同口径）
    const rh = r.height && /^\d+(\.\d+)?(cm|mm|pt|em|in)$/i.test(String(r.height).trim())
      ? `#box(width: 0pt, height: ${String(r.height).trim()})` : '';
    let rowBoxPending = !!rh;
    for (let ci = 0; ci < cols.length; ci++) {
      if (covered.has(`${ri},${ci}`)) continue;  // 被合并主格覆盖：不出格
      const c = cols[ci];
      // P-Map-13c：行头列——渲染该行的行头(行名/可绑 + 备注)，表头加粗，而非数据格
      if ((c as any).row_header) {
        const rlabel = resolveHeaderSlot((r as any).label_binding, ctx) ?? r.label ?? '';
        const rnote = resolveHeaderSlot((r as any).note_binding, ctx) ?? (r as any).note;
        let inner = tableCellBold(escapeTypst(rnote && String(rnote).trim() ? `${rlabel}（${String(rnote).trim()}）` : rlabel), headerBold, tFont);
        if (rowBoxPending) { inner = rh + inner; rowBoxPending = false; }
        cellTexts.push(`[${inner}]`);
        continue;
      }
      const cell = cells.find(x => x.rowId === r.id && x.colId === c.id);
      let inner: string;
      if (cell) { const rv = resolveBinding(cell.binding, ctx); inner = escapeTypst(rv === '' ? L.empty : rv); }
      else if (r.label && ci === 0) inner = escapeTypst(r.label);
      else inner = escapeTypst(L.empty);
      inner = tableCellBold(inner, bodyBold, tFont);   // 内容加粗（缺省否）
      if (rowBoxPending) { inner = rh + inner; rowBoxPending = false; }
      // 跨度钳制在数据网格内，不溢出到汇总行/列
      const cspan = Math.min(Math.max(cell?.colspan ?? 1, 1), cols.length - ci);
      const rspan = Math.min(Math.max(cell?.rowspan ?? 1, 1), rows.length - ri);
      if (cspan > 1 || rspan > 1) {
        cellTexts.push(`table.cell(colspan: ${cspan}, rowspan: ${rspan})[${inner}]`);
      } else {
        cellTexts.push(`[${inner}]`);
      }
    }
    // 汇总列(跨行,rowspan,仅首行) / 其他列(per_row,逐行每格)
    for (const sc of sumCols) {
      if (sc.per_row) {
        const cell = (sc.cells || []).find(x => x.rowId === r.id);
        const v = tableCellBold(escapeTypst(cell ? resolveBinding(cell.binding, ctx) : L.empty), bodyBold, tFont);
        cellTexts.push(`[${v}]`);
      } else if (ri === 0) {
        const v = tableCellBold(escapeTypst(resolveBinding(sc.binding, ctx)), bodyBold, tFont);
        cellTexts.push(rows.length > 1 ? `table.cell(rowspan: ${rows.length})[${v}]` : `[${v}]`);
      }
      // 跨行汇总列在 ri>0 不出格（被 rowspan 覆盖）
    }
    lines.push('  ' + cellTexts.join(', ') + ',');
  }
  // 汇总行：默认跨数据列 colspan；per_column＝每个数据列一格（各列平均值等）。汇总列位置补空格。
  for (const sr of sumRows) {
    const sumColPad = sumCols.length ? ', ' + sumCols.map(() => '[]').join(', ') : '';
    // 汇总行表头标题/备注与数据列同口径可绑定
    const srLabel = resolveHeaderSlot(sr.label_binding, ctx) ?? sr.label;
    const srNote = resolveHeaderSlot(sr.note_binding, ctx) ?? sr.note;
    const srHead = srNote && srNote.trim() ? `${srLabel}（${srNote.trim()}）` : srLabel;
    const headCell = `[${tableCellBold(escapeTypst(srHead), headerBold, tFont)}]`;
    if (sr.per_column) {
      // 首列＝标签，其余每个数据列一格（按 colId 取 cells[].binding）
      const byCol = new Map((sr.cells || []).map(c => [c.colId, c.binding]));
      const valCells = cols.slice(1).map(c => {
        const b = byCol.get(c.id);
        const rv = b ? resolveBinding(b, ctx) : '';
        return `[${tableCellBold(escapeTypst(rv === '' ? L.empty : rv), bodyBold, tFont)}]`;
      });
      lines.push('  ' + [headCell, ...valCells].join(', ') + sumColPad + ',');
    } else {
      const v = resolveBinding(sr.binding, ctx);
      lines.push(`  ${headCell}, table.cell(colspan: ${cols.length - 1})[${tableCellBold(escapeTypst(v === '' ? L.empty : v), bodyBold, tFont)}]${sumColPad},`);
    }
  }
  lines.push(')');
  // 尽量同页：keep_together → 外层 #block(breakable:false)，整表放不下整体移到下一页
  const tableStr = `#block(breakable: ${L.keepTogether ? 'false' : 'true'})[\n${lines.join('\n')}\n]`;
  return wrapFigure(field, tableStyleWrap(tableStr, ts));
}

/** 渲染 report_equipment_table */
export function renderReportEquipmentTableTypst(field: FieldDefinition, ctx: ReportRenderCtx): string {
  if (field.free_table?.columns?.length) return renderFreeTableTypst(field, field.free_table);
  const cfg = field.equipment_table || {};
  // 列：设备名称/型号/编号 + 溯源日期 + 到期日期（后两者从设备库直接取；原"校准有效期"已拆掉）。
  const colLabels: Record<string, string> = {
    name: '设备名称', model: '设备型号', asset_code: '设备编号',
    trace_date: '溯源日期', expire_date: '到期日期',
  };
  const DEFAULT_EQ_COLS = ['name', 'model', 'asset_code', 'trace_date', 'expire_date'];
  // 过滤掉未知/已废弃列（如存量模板里残留的 'calibration'），过滤后为空则回退缺省列。
  const reqCols = (cfg.columns && cfg.columns.length ? cfg.columns : DEFAULT_EQ_COLS).filter(c => c in colLabels);
  const cols = reqCols.length ? reqCols : DEFAULT_EQ_COLS;
  const rows = ctx.equipment_rows || [];
  const ts = field.table_style;
  const headerBold = ts?.header_bold !== false;
  const bodyBold = ts?.body_bold === true;
  const tFont = ts?.font;
  // 全页宽：所有列均分
  const colSpec = cols.map(() => '1fr').join(', ');
  const L = resultTableLayout(cfg);
  const lines: string[] = [];
  lines.push(`#table(columns: (${colSpec}), stroke: 0.5pt, inset: ${L.insetSpec}, align: ${L.alignKw},`);
  lines.push(`  table.header(repeat: ${L.repeatHeader}, ${cols.map(c => `[${tableCellBold(escapeTypst(colLabels[c] || c), headerBold, tFont)}]`).join(', ')}),`);
  if (rows.length === 0) {
    lines.push(`  table.cell(colspan: ${cols.length})[#text(fill: gray)[（无设备数据）]],`);
  } else {
    for (const r of rows) {
      const row = cols.map(c => {
        const val = c === 'name' ? (r.name || '')
          : c === 'model' ? (r.model ?? '')
          : c === 'asset_code' ? (r.asset_code || '')
          : c === 'trace_date' ? (r.trace_date || '')
          : c === 'expire_date' ? (r.expire_date || '')
          : '';
        return `[${tableCellBold(escapeTypst(String(val) === '' ? L.empty : String(val)), bodyBold, tFont)}]`;
      }).join(', ');
      lines.push('  ' + row + ',');
    }
  }
  lines.push(')');
  // 尽量同页：keep_together → 外层 #block(breakable:false)
  const tableStr = `#block(breakable: ${L.keepTogether ? 'false' : 'true'})[\n${lines.join('\n')}\n]`;
  return wrapFigure(field, tableStyleWrap(tableStr, ts));
}

/**
 * 结果表 → 自由编辑网格：与渲染器同布局【保留合并】——数据格合并、汇总列跨所有数据行(rowspan)、
 * 汇总行跨其余数据列(colspan) 都落成 spans，被覆盖的格不存键。这样转自由编辑后仍是"合并的样子"且逐格可改。
 */
function buildResultFreeTable(field: FieldDefinition, ctx: ReportRenderCtx): NonNullable<FieldDefinition['free_table']> {
  const raw = field.result_table;
  if (!raw) return { columns: [], rows: [], cells: {} };
  const cfg = expandResultTableBand(raw, ctx);
  const dataCols = cfg.columns || [];
  const dataRows = cfg.rows || [];
  const cells = cfg.cells || [];
  const sumCols = cfg.summary_cols || [];
  const sumRows = cfg.summary_rows || [];
  const headOf = (label?: string, note?: string) => (note && note.trim() ? `${label ?? ''}（${note.trim()}）` : (label ?? ''));
  const nData = dataCols.length;
  const nDataRows = dataRows.length;

  const allCols = [
    ...dataCols.map((c, i) => ({ id: `c${i}`, label: headOf(resolveHeaderSlot(c.label_binding, ctx) ?? c.label, resolveHeaderSlot(c.note_binding, ctx) ?? c.note), width: c.width })),
    ...sumCols.map((sc, i) => ({ id: `c${nData + i}`, label: headOf(resolveHeaderSlot(sc.label_binding, ctx) ?? sc.label, resolveHeaderSlot(sc.note_binding, ctx) ?? sc.note), width: sc.width })),
  ];
  const outRows = [
    ...dataRows.map((r, i) => ({ id: `r${i}`, height: r.height })),
    ...sumRows.map((_, i) => ({ id: `r${nDataRows + i}` })),
  ];
  const cellMap: Record<string, string> = {};
  const spanMap: Record<string, { colspan?: number; rowspan?: number }> = {};
  const put = (ri: number, ci: number, text: string, cs = 1, rs = 1) => {
    if (!allCols[ci] || !outRows[ri]) return;
    const key = `${outRows[ri].id}::${allCols[ci].id}`;
    cellMap[key] = text;
    if (cs > 1 || rs > 1) spanMap[key] = { ...(cs > 1 ? { colspan: cs } : {}), ...(rs > 1 ? { rowspan: rs } : {}) };
  };

  // 数据区合并：复刻渲染器 covered（被合并主格盖住的数据格不出键）
  const colIdxOf = new Map(dataCols.map((c, i) => [c.id, i]));
  const rowIdxOf = new Map(dataRows.map((r, i) => [r.id, i]));
  const coveredData = new Set<string>();
  for (const cell of cells) {
    const rs0 = cell.rowspan ?? 1, cs0 = cell.colspan ?? 1;
    if (rs0 <= 1 && cs0 <= 1) continue;
    const ri = rowIdxOf.get(cell.rowId), ci = colIdxOf.get(cell.colId);
    if (ri == null || ci == null) continue;
    for (let dr = 0; dr < rs0; dr++) for (let dc = 0; dc < cs0; dc++) { if (dr || dc) coveredData.add(`${ri + dr},${ci + dc}`); }
  }
  for (let ri = 0; ri < nDataRows; ri++) {
    const r = dataRows[ri];
    for (let ci = 0; ci < nData; ci++) {
      if (coveredData.has(`${ri},${ci}`)) continue;
      const c = dataCols[ci];
      const cell = cells.find(x => x.rowId === r.id && x.colId === c.id);
      let text: string;
      if ((c as any).row_header) text = headOf(resolveHeaderSlot((r as any).label_binding, ctx) ?? r.label ?? '', resolveHeaderSlot((r as any).note_binding, ctx) ?? (r as any).note);
      else if (cell) text = resolveBinding(cell.binding, ctx);
      else if (r.label && ci === 0) text = r.label;
      else text = '';
      const cs = Math.min(Math.max(cell?.colspan ?? 1, 1), nData - ci);
      const rs = Math.min(Math.max(cell?.rowspan ?? 1, 1), nDataRows - ri);
      put(ri, ci, text, cs, rs);
    }
    sumCols.forEach((sc, si) => {
      const ci = nData + si;
      if (sc.per_row) { const cell = (sc.cells || []).find(x => x.rowId === r.id); put(ri, ci, cell ? resolveBinding(cell.binding, ctx) : ''); }
      else if (ri === 0) put(0, ci, resolveBinding(sc.binding, ctx), 1, nDataRows > 1 ? nDataRows : 1);   // 跨所有数据行
      // ri>0 非 per_row：被 rowspan 覆盖，不出键
    });
  }
  sumRows.forEach((sr, si) => {
    const ri = nDataRows + si;
    const head = headOf(resolveHeaderSlot(sr.label_binding, ctx) ?? sr.label, resolveHeaderSlot(sr.note_binding, ctx) ?? sr.note);
    if (sr.per_column) {
      put(ri, 0, head);
      const byCol = new Map((sr.cells || []).map(c => [c.colId, c.binding]));
      dataCols.slice(1).forEach((c, i) => { const b = byCol.get(c.id); put(ri, i + 1, b ? resolveBinding(b, ctx) : ''); });
    } else if (nData >= 2) {
      put(ri, 0, head);
      put(ri, 1, resolveBinding(sr.binding, ctx), nData - 1, 1);   // 标签后跨满其余数据列
    } else {
      put(ri, 0, [head, resolveBinding(sr.binding, ctx)].filter(Boolean).join(' '));
    }
    sumCols.forEach((_, sidx) => put(ri, nData + sidx, ''));   // 汇总列位置留空（可编辑空格）
  });

  return { columns: allCols, rows: outRows, cells: cellMap, spans: Object.keys(spanMap).length ? spanMap : undefined };
}

/**
 * 把三类报告表的【当前渲染内容】快照成统一「自由编辑表格」纯文本网格（表头 + 单元格 + 汇总行/设备行）。
 * 与各自渲染器同口径取值：结论表按 ctx.project_summary（或手动行）展开；结果表预展开试样带 + 解析绑定 + 拼汇总行列
 * （合并格摊平：值落主格、被覆盖格留空；跨行汇总列仅首行有值）；设备表按 ctx.equipment_rows。
 * 实例编辑器「自由编辑表格」用它做种子，之后逐格可改。
 */
export function buildFreeTableFromField(
  field: FieldDefinition,
  ctx: ReportRenderCtx,
): NonNullable<FieldDefinition['free_table']> {
  // 结果表保留合并外观，单独走带 spans 的构造
  if (field.type === 'report_result_table') return buildResultFreeTable(field, ctx);

  let header: Array<{ label: string; width?: string }> = [];
  let matrix: string[][] = [];
  let rowHeights: Array<string | undefined> = [];

  if (field.type === 'report_conclusion_table') {
    const cfg = field.conclusion_table || {};
    const summary = ctx.project_summary || [];
    const distinct = new Set(summary.map(r => r.sample_no).filter(Boolean));
    const sampleMode = cfg.sample_col || 'auto';
    const showSample = sampleMode === 'show' ? true : sampleMode === 'hide' ? false : distinct.size > 1;
    let cols: Array<'sample' | 'index' | 'project' | 'standard' | 'result'> =
      (cfg.columns && cfg.columns.length) ? [...cfg.columns]
        : (distinct.size > 0 ? ['sample', 'index', 'project', 'result'] : ['index', 'project', 'result']);
    if (showSample && !cols.includes('sample')) cols = ['sample', ...cols];
    if (!showSample) cols = cols.filter(c => c !== 'sample');
    const colLabels: Record<string, string> = { sample: '样品', index: '序号', project: '项目', standard: '标准', result: '结论', ...(cfg.column_labels || {}) };
    const widthByKey: Record<string, string> = {};
    const legacySrc = (cfg.columns && cfg.columns.length) ? cfg.columns : ['index', 'project', 'result'];
    legacySrc.forEach((c, i) => { if (cfg.col_widths?.[i]) widthByKey[c] = cfg.col_widths![i]!; });
    for (const [k, v] of Object.entries(cfg.col_widths_map || {})) { if (v) widthByKey[k] = v as string; }
    header = cols.map(c => ({ label: colLabels[c] || c, width: widthByKey[c] }));
    const src = (cfg.manual && Array.isArray(cfg.rows))
      ? cfg.rows.map((r, i) => ({ sample: r.sample ?? '', index: r.index ?? String(i + 1), project: r.project ?? '', standard: r.standard ?? '', result: r.result ?? '' }))
      : summary.map((r, i) => ({ sample: r.sample_no ? String(r.sample_no).replace(/#\s*$/, '') + '#' : '', index: String(r.index ?? i + 1), project: r.name || '', standard: r.standard ?? '', result: r.conclusion ?? '' }));
    matrix = src.map(r => cols.map(c => (r as Record<string, string>)[c] ?? ''));
    rowHeights = src.map(() => undefined);

  } else if (field.type === 'report_sample_table') {
    const cfg = field.sample_table || {};
    const samples = ctx.order_samples || [];
    const colKeys = (cfg.columns && cfg.columns.length ? cfg.columns : ['index', 'name', 'model']) as Array<'index' | 'name' | 'model'>;
    const labels: Record<string, string> = { index: cfg.column_labels?.index || '样品编号', name: cfg.column_labels?.name || '样品名称', model: cfg.column_labels?.model || '零件号' };
    const widthByKey: Record<string, string> = {};
    colKeys.forEach((c, i) => { if (cfg.col_widths?.[i]) widthByKey[c] = cfg.col_widths![i]!; });
    for (const [k, v] of Object.entries(cfg.col_widths_map || {})) { if (v) widthByKey[k] = v as string; }
    const valOf = (s: any, k: string): string => k === 'index' ? ((s.sort_no && String(s.sort_no).trim()) || String(s.no ?? '')) : k === 'name' ? String(s.name ?? '') : String(s.model ?? '');
    header = colKeys.map(c => ({ label: labels[c] || c, width: widthByKey[c] }));
    matrix = samples.map(s => colKeys.map(k => valOf(s, k)));
    rowHeights = samples.map(() => undefined);

  } else if (field.type === 'report_equipment_table') {
    const cfg = field.equipment_table || {};
    const colLabels: Record<string, string> = { name: '设备名称', model: '设备型号', asset_code: '设备编号', trace_date: '溯源日期', expire_date: '到期日期' };
    const DEF = ['name', 'model', 'asset_code', 'trace_date', 'expire_date'];
    const reqCols = (cfg.columns && cfg.columns.length ? cfg.columns : DEF).filter(c => c in colLabels);
    const cols = reqCols.length ? reqCols : DEF;
    const rows = ctx.equipment_rows || [];
    header = cols.map(c => ({ label: colLabels[c] || c }));
    matrix = rows.map(r => cols.map(c => String((r as Record<string, any>)[c] ?? '')));
    rowHeights = rows.map(() => undefined);
  }

  const columns = header.map((h, i) => ({ id: `c${i}`, label: h.label, width: h.width }));
  const outRows = matrix.map((_, i) => ({ id: `r${i}`, height: rowHeights[i] }));
  const cells: Record<string, string> = {};
  matrix.forEach((vals, ri) => vals.forEach((v, ci) => { if (columns[ci]) cells[`${outRows[ri].id}::${columns[ci].id}`] = v ?? ''; }));
  return { columns, rows: outRows, cells };
}

/**
 * 渲染 report_image_gallery。
 *  - 手动模式（cfg.items）：项目模板直接定义图位 + 样式，每个图位绑定一个原始记录 image 字段作为照片来源。
 *  - 自动模式（无 items）：按 source_field_codes（空=全部）从关联原始记录抓 image 字段，继承其样式。
 *  无缝/铺排走统一 renderImageSlotsTypst。
 */
/** 把序列按每行 cols 个分组；剩 1 个时按 solo 放到首行或末行独占（其余整除铺满）。 */
function chunkWithSolo<T>(arr: T[], cols: number, solo: 'first' | 'last'): T[][] {
  const n = arr.length;
  const groups: T[][] = [];
  if (cols > 1 && n % cols === 1 && n > 1) {
    if (solo === 'first') { groups.push([arr[0]]); for (let i = 1; i < n; i += cols) groups.push(arr.slice(i, i + cols)); }
    else { for (let i = 0; i < n - 1; i += cols) groups.push(arr.slice(i, i + cols)); groups.push([arr[n - 1]]); }
  } else {
    for (let i = 0; i < n; i += cols) groups.push(arr.slice(i, i + cols));
  }
  return groups;
}

/**
 * 共用标题照片网格：一个共享标题（表内表头行，在框内）+ 一串照片（无逐张标题）铺成每行 cols 张的网格。
 *  - 粘连(seamless)：整组一张连续表格，标题为跨列表头行。
 *  - 独立框：照片每行各自一个边框；共用标题作为【第一框】的表头行（在框内，不悬浮在框外）。
 *  - 单数独占：剩 1 张时该张独占整行（solo='first'/'last'）。
 */
function renderSharedPhotoGrid(
  photos: any[], header: string, headerStyle: StyleOverride | undefined,
  cfg: { cols: number; width: number; height: number; stroke: number; inset: number; seamless: boolean; solo: 'first' | 'last'; headerFollow?: boolean; insetX?: number; insetY?: number; titleInsetY?: number },
): string {
  const cols = Math.max(1, cfg.cols || 1);
  const { width, height, stroke, seamless, solo } = cfg;
  const exprOf = (p: any) => imgExpr(p, width, height, false);
  const groups = chunkWithSolo(photos, cols, solo);
  const hdr = (header || '').trim();
  if (!photos.length) return '#text(fill: gray)[（未上传照片）]';

  if (seamless) {
    const colSpec = Array(cols).fill('1fr').join(', ');
    const lines = [`#table(columns: (${colSpec}), stroke: ${stroke}pt, inset: ${imgCellInset(cfg)}, align: center + horizon,`];
    if (hdr) {
      // 跨页表头跟随：用 table.header(repeat: true) 包裹，表格跨页时表头在新页重复。
      const headerCell = `table.cell(colspan: ${cols}, inset: ${imgTitleInset(cfg)})[#text(${titleTextArgs(headerStyle, '1em')})[${escapeTypstMarkup(hdr)}]]`;
      lines.push(cfg.headerFollow === false ? `  ${headerCell},` : `  table.header(repeat: true, ${headerCell}),`);
    }
    for (const g of groups) {
      const span = (g.length === 1 && cols > 1) ? cols : 1;
      const cells = g.map(p => span > 1 ? `table.cell(colspan: ${span}, ${exprOf(p)})` : exprOf(p));
      if (g.length >= 2 && g.length < cols) for (let p = 0; p < cols - g.length; p++) cells.push('[]');
      lines.push('  ' + cells.join(', ') + ',');
    }
    lines.push(')');
    return `#block(width: 100%, breakable: true)[\n${lines.join('\n')}\n]`;
  }
  // 独立框：照片每行各自一框；共用标题作为【第一框】的表头行（在框内）。
  const blocks = groups.map((g, idx) => {
    const tc = (g.length === 1 && cols > 1) ? 1 : cols;
    const colSpec = Array(tc).fill('1fr').join(', ');
    const cells = g.map(p => exprOf(p));
    if (g.length >= 2 && g.length < tc) for (let p = 0; p < tc - g.length; p++) cells.push('[]');
    const headerRow = (idx === 0 && hdr)
      ? `  table.cell(colspan: ${tc}, inset: ${imgTitleInset(cfg)})[#text(${titleTextArgs(headerStyle, '1em')})[${escapeTypstMarkup(hdr)}]],\n`
      : '';
    return `#block(width: 100%, breakable: false)[\n#table(columns: (${colSpec}), stroke: ${stroke}pt, inset: ${imgCellInset(cfg)}, align: center + horizon,\n${headerRow}  ${cells.join(', ')},\n)\n]`;
  });
  // 独立框：显式 0.8em 块间距，覆盖 wrapFigure 的 #set block(spacing:0pt)（否则各框紧贴=粘连）
  return `#block(width: 100%)[\n#set block(spacing: 0.8em)\n${blocks.join('\n')}\n]`;
}

/**
 * 图库网格（手动模式）：每个图位＝[表内标题 + 单张图]，每行 cols 张铺成网格。
 *  - 表内标题＝带边框的表头行（在图上方，与图之间有分隔线）。
 *  - 单数独占：剩 1 张时该张独占整行（solo='first' 第一张 / 'last' 最后一张）。
 *  - 行：seamless=true 整组连续（块间距 0、视觉相连）；false 每行独立框（块间留间距）。
 *  - 每组（标题行 + 图行）各自一张 breakable:false 表 → 标题与图永不跨页分离，始终同页。
 */
function renderGalleryGrid(
  items: Array<{ title: string; hideTitle: boolean; photo: any; labelStyle?: StyleOverride }>,
  cfg: { cols: number; width: number; height: number; stroke: number; inset: number; seamless: boolean; solo: 'first' | 'last'; insetX?: number; insetY?: number; titleInsetY?: number },
): string {
  const cols = Math.max(1, cfg.cols || 1);
  const { width, height, stroke, seamless, solo } = cfg;
  const hasTitle = items.some(it => !it.hideTitle && (it.title || '').trim());

  // 分行：cols 张一行；剩 1 张时按 solo 放到首行或末行独占
  const groups = chunkWithSolo(items, cols, solo);

  // 一组（一行图位）→ table 的 标题行 + 图片行（按 tableCols 补空格/跨列）
  const groupRows = (group: typeof items, tableCols: number): string[] => {
    const K = group.length;
    const span = (K === 1 && tableCols > 1) ? tableCols : 1;
    const lines: string[] = [];
    if (hasTitle) {
      const tcells = group.map(it => {
        const inner = (it.hideTitle || !(it.title || '').trim()) ? '' : `#text(${titleTextArgs(it.labelStyle, '1em')})[${escapeTypstMarkup(it.title)}]`;
        return `table.cell(${span > 1 ? `colspan: ${span}, ` : ''}inset: ${imgTitleInset(cfg)})[${inner}]`;
      });
      if (K >= 2 && K < tableCols) for (let p = 0; p < tableCols - K; p++) tcells.push('[]');
      lines.push('  ' + tcells.join(', ') + ',');
    }
    const pcells = group.map(it => {
      const expr = imgExpr(it.photo, width, height, false);
      return span > 1 ? `table.cell(colspan: ${span}, ${expr})` : expr;
    });
    if (K >= 2 && K < tableCols) for (let p = 0; p < tableCols - K; p++) pcells.push('[]');
    lines.push('  ' + pcells.join(', ') + ',');
    return lines;
  };

  // 每组独立成一张 breakable:false 表（标题行＋图行不拆页）。粘连＝块间距 0 视觉相连；独立框＝默认间距。
  const blocks = groups.map(g => {
    const tableCols = (g.length === 1 && cols > 1) ? 1 : cols;
    const colSpec = Array(tableCols).fill('1fr').join(', ');
    const lines = [`#table(columns: (${colSpec}), stroke: ${stroke}pt, inset: ${imgCellInset(cfg)}, align: center + horizon,`];
    lines.push(...groupRows(g, tableCols));
    lines.push(')');
    return `#block(width: 100%, breakable: false)[\n${lines.join('\n')}\n]`;
  });
  // 显式设块间距：粘连=0pt、独立=0.8em。【必须显式】——否则被外层 wrapFigure 的 #set block(spacing:0pt)
  // 盖成 0、永远粘连、切换独立无效（这正是"项目模板独立、报告却粘连/切换无效"的根因）。
  const spacingRule = `#set block(spacing: ${seamless ? '0pt' : '0.8em'})\n`;
  return `#block(width: 100%)[\n${spacingRule}${blocks.join('\n')}\n]`;
}

export function renderReportImageGalleryTypst(field: FieldDefinition, ctx: ReportRenderCtx): string {
  const cfg = field.image_gallery || {};
  const recTpl = ctx.linked_record_template;
  const rawData = ctx.record_raw_data || {};
  if (!recTpl) return wrapFigure(field, '#text(fill: gray)[（未关联原始记录模板）]');

  // 索引关联原始记录的 image 字段（按 code）
  const imgByCode = new Map<string, FieldDefinition>();
  for (const g of recTpl.groups) for (const f of g.fields) if (f.type === 'image') imgByCode.set(f.code, f);

  if (cfg.items && cfg.items.length) {
    // 手动模式：每个图位绑定一个来源(原始记录 image 字段) → 取首张图。统一尺寸/每行张数/单数独占/行。
    const layout = {
      cols: cfg.cols && cfg.cols > 0 ? cfg.cols : 2,
      width: cfg.width_cm ?? 7, height: cfg.height_cm ?? 6,
      stroke: cfg.stroke_pt ?? 0.5, inset: cfg.inset_pt ?? 6,
      seamless: cfg.seamless !== false, solo: (cfg.solo === 'last' ? 'last' : 'first') as 'first' | 'last',
      headerFollow: cfg.header_follow !== false,
      insetX: cfg.inset_x, insetY: cfg.inset_y, titleInsetY: cfg.title_inset_y,
    };
    const photoOf = (it: any) => (Array.isArray(rawData[it.source_field_code]) ? rawData[it.source_field_code] : [])[0];
    if ((cfg.title_mode || 'per') === 'shared') {
      // 共用标题：所有来源照片铺一张网格，共用一个 shared_title。
      const photos = cfg.items.map(photoOf);
      return wrapFigure(field, renderSharedPhotoGrid(photos, cfg.shared_title ?? '', undefined, layout));
    }
    // 每张一个标题
    const items = cfg.items.map(it => {
      const rf = imgByCode.get(it.source_field_code);
      const label = it.label !== undefined ? it.label : (rf?.label || '');
      return { title: label, hideTitle: !!it.hide_label || !label.trim(), photo: photoOf(it), labelStyle: rf?.label_style };
    });
    return wrapFigure(field, renderGalleryGrid(items, layout));
  }

  // 自动模式：从关联原始记录的 image 字段继承（保持原行为）
  const fields = [...imgByCode.values()].filter(f => !cfg.source_field_codes?.length || cfg.source_field_codes!.includes(f.code));
  if (fields.length === 0) return wrapFigure(field, '#text(fill: gray)[（关联的原始记录中没有图片字段）]');
  const slots = fields.map(f => imageFieldToSlot(f, Array.isArray(rawData[f.code]) ? rawData[f.code] : [], ''));
  if (!slots.length) return wrapFigure(field, '#text(fill: gray)[（未配置图片位）]');
  // 自动模式也吃图库的「粘连/独立」与「单数独占」（修：原先忽略 → 报告里切换无效）
  const body = renderImageSlotsTypst(slots, {
    stroke: cfg.stroke_pt ?? 0.5, inset: cfg.inset_pt ?? 6,
    seamless: cfg.seamless !== false, solo: (cfg.solo === 'last' ? 'last' : 'first') as 'first' | 'last',
    insetX: cfg.inset_x, insetY: cfg.inset_y, titleInsetY: cfg.title_inset_y,
  });
  return wrapFigure(field, `#block(width: 100%)[\n${body}\n]`);
}

/**
 * 渲染 report_photo_table（首页·原样照片表）：一行「加粗标签：普通说明」 + 一张带表头的图片表。
 * 照片来自 ctx.photo_tables[field.code]（文员直接上传，无记录绑定）。复用 renderImageSlotsTypst 出表。
 */
export function renderPhotoTableTypst(field: FieldDefinition, _ctx: ReportRenderCtx): string {
  const cfg = field.photo_table || {};

  // 说明行：「加粗标签：」+ 普通文字（标签自动跟全角冒号；无标签则只出文字）
  let caption = '';
  const lbl = (cfg.caption_label ?? '').trim();
  const txt = (cfg.caption_text ?? '').trim();
  if (lbl || txt) {
    const boldArgs = isNoBoldFont(_docFont) ? 'weight: "bold", stroke: 0.03em' : 'weight: "bold"';
    const boldPart = lbl ? `#text(${boldArgs})[${escapeTypst(lbl)}：]` : '';
    caption = `#block(below: 0.4em)[${boldPart}${escapeTypst(txt)}]\n`;
  }

  const layout = {
    cols: cfg.cols && cfg.cols > 0 ? cfg.cols : 2,
    width: cfg.width_cm ?? 7, height: cfg.height_cm ?? 6,
    stroke: cfg.stroke_pt ?? 0.5, inset: cfg.inset_pt ?? 6,
    seamless: cfg.seamless !== false, solo: (cfg.solo === 'last' ? 'last' : 'first') as 'first' | 'last',
    headerFollow: cfg.header_follow !== false,
    insetX: cfg.inset_x, insetY: cfg.inset_y, titleInsetY: cfg.title_inset_y,
  };
  let body: string;
  if ((cfg.title_mode || 'shared') === 'per') {
    // 每张一个标题：每行＝表内标题 + 单张直传图（it.photos[0]）
    const items = (cfg.items || []).map(it => ({ title: it.label || '', hideTitle: !(it.label || '').trim(), photo: (Array.isArray(it.photos) ? it.photos : [])[0] }));
    body = items.length ? renderGalleryGrid(items, layout) : '#text(fill: gray)[（未配置照片）]';
  } else {
    // 共用标题：直传照片铺网格 + 共用表头
    body = renderSharedPhotoGrid(Array.isArray(cfg.photos) ? cfg.photos : [], cfg.header ?? '', undefined, layout);
  }
  // width:100% 撑满整页；说明行在表上方、备注（wrapFigure）在表下方。
  return wrapFigure(field, `#block(width: 100%, breakable: true)[\n#set block(spacing: 0pt)\n${caption}${body}\n]`);
}

/**
 * 渲染 report_sample_table（首页·样品信息表）：多样品时把委托单样品按 序号/样品名称/零件号 列成一张满宽表格。
 * 数据来自 ctx.order_samples（{ no, name, sort_no, model }）。
 * mode='auto'（缺省）时单样品（≤1）自动折叠（返回空串），由首页「样品名称/零件号」字段直接显示；'always' 则始终出表。
 */
export function renderSampleTableTypst(field: FieldDefinition, ctx: ReportRenderCtx): string {
  // 取号前（编辑首页草稿）：样品由报告编号(1.2)决定，尚未取号 → 出灰字占位而非填整单样品。
  if (ctx.blank_scope) return wrapFigure(field, '#block(width: 100%)[#text(fill: gray)[（样品信息 — 取号后按报告编号自动生成）]]');
  if (field.free_table?.columns?.length) return renderFreeTableTypst(field, field.free_table);
  const cfg = field.sample_table || {};
  const samples = ctx.order_samples || [];
  // 单/多样品自动切换（系统固定规则）：auto（缺省）模式下样品 ≤1 时折叠本表——
  // 单样品由首页「样品名称/零件号」字段直接显示，无需表格。'always' 则不论几个都出表。
  if ((cfg.mode || 'auto') === 'auto' && samples.length <= 1) return '';
  const colKeys = (cfg.columns && cfg.columns.length ? cfg.columns : ['index', 'name', 'model']) as Array<'index' | 'name' | 'model'>;
  const labels: Record<string, string> = {
    index: cfg.column_labels?.index || '样品编号',   // 第一列＝接口 SampleSortNo（样品编号），非"序号"
    name: cfg.column_labels?.name || '样品名称',
    model: cfg.column_labels?.model || '零件号',
  };
  // 列宽：按【列名】映射——新版 col_widths_map；兼容旧位置数组 col_widths（与 colKeys 同序）。
  const widthByKey: Record<string, string> = {};
  colKeys.forEach((c, i) => { if (cfg.col_widths?.[i]) widthByKey[c] = cfg.col_widths![i]!; });
  for (const [k, v] of Object.entries(cfg.col_widths_map || {})) { if (v) widthByKey[k] = v as string; }
  const valOf = (s: any, k: string): string => {
    if (k === 'index') return (s.sort_no && String(s.sort_no).trim()) || String(s.no ?? '');
    if (k === 'name') return String(s.name ?? '');
    if (k === 'model') return String(s.model ?? '');
    return '';
  };
  if (!samples.length) {
    return wrapFigure(field, '#block(width: 100%)[#text(fill: gray)[（样品信息表 — 暂无样品，生成报告时按委托单自动列出）]]');
  }
  const widths = colKeys.map(c => widthByKey[c] ? colWidthSpec(widthByKey[c]) : '1fr');
  // 行高＝单元格上下留白 cell_inset_y（缺省 6pt）。
  const insetY = lenTypst(cfg.cell_inset_y, 'pt');
  const insetSpec = insetY ? `(x: 6pt, y: ${insetY})` : '6pt';
  // 整表文字样式（「版式」Tab）：表头加粗（缺省 true）/ 内容加粗（缺省 false）/ 字体 / 内容对齐（缺省 center）。font/size 在 return 处 tableStyleWrap 包裹。
  const ts = field.table_style;
  const headerBold = ts?.header_bold !== false;
  const bodyBold = ts?.body_bold === true;
  const tFont = ts?.font;
  const alignKw = `${ts?.cell_align || 'center'} + horizon`;
  const lines: string[] = [`#table(columns: (${widths.join(', ')}), stroke: 0.5pt, inset: ${insetSpec}, align: ${alignKw},`];
  // 单元格是【内容模式】（[...]），值/标签可能含 # [ ] 等（如样品序号 1#）——必须用 escapeTypstMarkup 转义，否则破坏分隔符。
  lines.push('  ' + colKeys.map(k => `[${tableCellBold(escapeTypstMarkup(labels[k]), headerBold, tFont)}]`).join(', ') + ',');
  for (const s of samples) {
    lines.push('  ' + colKeys.map(k => `[${tableCellBold(escapeTypstMarkup(valOf(s, k)), bodyBold, tFont)}]`).join(', ') + ',');
  }
  lines.push(')');
  // wrapFigure：field.label 标题(显示标签开关)/field.caption 备注/题注位置/标题·备注间距/段前后间距统一生效（默认 hide_label:true → 不显示标题，向后兼容）。
  // tableStyleWrap：整表字体/字号（table_style.font/font_size）包裹全表。
  return wrapFigure(field, tableStyleWrap(`#block(width: 100%, breakable: true)[\n${lines.join('\n')}\n]`, ts));
}

/** daterange（时间范围）→ "开始 ~ 结束"。两端各解析其 CellBinding（literal=手填 / order 等=绑定）；缺一端只显另一端。 */
export function formatDateRange(field: FieldDefinition, ctx: ReportRenderCtx): string {
  // 报告实例里文员直接改过整段值：用字面量覆盖两端计算（生成报告编辑器把 daterange 也当可编辑字段，
  // 改值＝设 field.binding={source:'literal',text}）。空字符串也按覆盖处理（允许清空）。
  if (field.binding && field.binding.source === 'literal') return String((field.binding as any).text ?? '');
  const dr = field.date_range || {};
  const clean = (b?: CellBinding): string => {
    if (!b) return '';
    const v = resolveBinding(b, ctx);
    return (v == null || v === '—') ? '' : String(v).trim();
  };
  const start = clean(dr.start);
  const end = clean(dr.end);
  const sep = (dr.separator != null && dr.separator !== '') ? dr.separator : ' ~ ';
  if (start && end) return `${start}${sep}${end}`;
  return start || end || '';
}

/** 在已生成的 typst 源码中替换 4 类报告字段的锚点 */
export function injectReportFieldsIntoTypst(source: string, template: RecordTemplate, ctx: ReportRenderCtx): string {
  // 报告自动表/图（wrapFigure）在本阶段渲染——按本模板「字段间距」设缺省「标题↔表」「备注↔表」距离。
  _figureGap = lineGapTypst(template);
  let out = source;
  // 收集普通字段 binding 解析值，注入到 #let data
  const resolvedData: Record<string, string> = {};
  for (const g of template.groups || []) {
    for (const f of g.fields || []) {
      const re = (s: string) => new RegExp(`// __${s}__:${escapeReg(f.code)}__[\\s\\S]*?// __${s}_END__:${escapeReg(f.code)}__`, 'g');
      if (f.type === 'report_conclusion_table') {
        out = out.replace(re('REPORT_CONCLUSION'), renderConclusionTableTypst(f, ctx));
      } else if (f.type === 'report_result_table') {
        out = out.replace(re('REPORT_RESULT'), renderReportResultTableTypst(f, ctx));
      } else if (f.type === 'report_equipment_table') {
        out = out.replace(re('REPORT_EQUIPMENT'), renderReportEquipmentTableTypst(f, ctx));
      } else if (f.type === 'report_image_gallery') {
        out = out.replace(re('REPORT_IMAGES'), renderReportImageGalleryTypst(f, ctx));
      } else if (f.type === 'report_photo_table') {
        out = out.replace(re('REPORT_PHOTO_TABLE'), renderPhotoTableTypst(f, ctx));
      } else if (f.type === 'report_sample_table') {
        out = out.replace(re('REPORT_SAMPLE_TABLE'), renderSampleTableTypst(f, ctx));
      } else if (f.type === 'free_grid') {
        // 统一网格（报告侧）：按 ctx 解析每格绑定（cell_bindings）→ 从原始记录取值
        out = out.replace(re('FREE_GRID'), renderFreeGridTypst(f, f.free_table || { columns: [], rows: [], cells: {} }, undefined, ctx));
      } else if (f.rich) {
        // 富文本字段：把锚点替换成转换后的内容块（值来自 binding，多为 literal 手填）
        const richRe = new RegExp(`// __RICH__:${escapeReg(f.code)}__[\\s\\S]*?// __RICH_END__:${escapeReg(f.code)}__`, 'g');
        out = out.replace(richRe, richBlock(f.binding ? resolveBinding(f.binding, ctx) : '', f.style));
      } else if (f.type === 'daterange') {
        // 时间范围：两端各解析 → "开始 ~ 结束"
        resolvedData[f.code] = formatDateRange(f, ctx);
      } else if (f.binding) {
        // 普通字段：解析 binding 并注入到 data
        resolvedData[f.code] = resolveBinding(f.binding, ctx);
      }
    }
  }
  // 项目报告·图片分区（section_role='images' + image 字段 + 绑定）：按 group.id 锚点整体替换；
  // 每个图片字段按 image_source_code（未设则回退字段 code）从关联原始记录 ctx.record_raw_data 取照片，
  // 布局/四类文字与原始记录图片分区【完全共用】renderImageGroupTypst。
  for (const g of template.groups || []) {
    if (g.section_role !== 'images' || !(g.fields || []).some(f => f.type === 'image')) continue;
    const re = new RegExp(`// __IMAGE_GROUP__:${escapeReg(g.id)}__[\\s\\S]*?// __IMAGE_END__:${escapeReg(g.id)}__`, 'g');
    out = out.replace(re, renderImageGroupTypst(g, f => {
      const arr = (ctx.record_raw_data || {})[f.image_source_code || f.code];
      if (Array.isArray(arr) && arr.length) return arr;
      // 首页(content_doc)文员【直接上传】的原样照片存在字段自身 f.image_photos（无记录绑定，ctx 无 record_raw_data）。
      // 套用到报告 / 生成报告走本注入路径时，若不回退取 image_photos，会把首页上传的照片整块清空（显示空）。
      return Array.isArray(f.image_photos) ? f.image_photos : [];
    }));
  }
  // 重写 #let data = (...) 把 resolvedData 的值放进去
  out = out.replace(/#let data = \(([\s\S]*?)\)/m, (_m, body) => {
    const lines = body.split('\n').map((line: string) => {
      const trimmed = line.trim();
      const match = trimmed.match(/^(\w+):\s*none,?$/);
      if (match && resolvedData[match[1]] !== undefined) {
        const v = resolvedData[match[1]];
        const safe = String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
        return `  ${match[1]}: "${safe}",`;
      }
      return line;
    });
    return `#let data = (\n${lines.join('\n').replace(/^\n|\n$/g, '')}\n)`;
  });
  return out;
}

/**
 * 从「报告实例文档」渲染最终 Typst（P2）。
 *
 * 这是报告生成（buildReportTypst v3 分支）与"实例编辑后重渲染"的【统一装配路径】：
 * cover + 各项目，每个用冻结的 groups + ctx 走 generateTypst + injectReportFieldsIntoTypst。
 * 编辑只改 doc（groups / binding），重渲染调本函数即可，无需 record_data。
 */
export function renderContentDoc(doc: {
  front_cover?: { name?: string; groups: FieldGroup[]; layout_options?: Record<string, any>; ctx: ReportRenderCtx };
  cover: { name?: string; groups: FieldGroup[]; layout_options?: Record<string, any>; ctx: ReportRenderCtx };
  projects: Array<{ name?: string; title?: string; page_break?: boolean; seq?: number; groups: FieldGroup[]; layout_options?: Record<string, any>; ctx: ReportRenderCtx }>;
}): string {
  // 全文字体＝首页(cover)的文档字体（#show 在首页设一次、覆盖全文）；项目段无自己的字体，
  // 故项目标题 faux-bold 需按 cover 字体判定（不能用循环里被 projTpl 覆盖后的 _docFont）。
  const docFont = String((doc.cover.layout_options?.theme_config as Record<string, any> | undefined)?.font || '');
  const coverAsRecord: RecordTemplate = {
    id: 0, name: doc.cover.name || '首页', version: 1,
    groups: doc.cover.groups, layout_options: doc.cover.layout_options || {},
  };
  let coverSrc = generateTypst(coverAsRecord);
  coverSrc = injectReportFieldsIntoTypst(coverSrc, coverAsRecord, doc.cover.ctx);
  coverSrc = prefixPosMarkers(coverSrc, 'cover');   // 段内 marker code 前缀，跨段不撞车（见 prefixPosMarkers）

  // 真·封面（P3）：渲染为最前一页。做法——把封面的「#let data + 正文」插到首页 #show 行之后、
  // 首页 #let data 之前，再接 #pagebreak()。这样：① 首页那条 #show 仍统管全文页眉页脚；
  // ② data 在每段正文前各自 rebind（封面用封面 data → 首页 #let data 重新绑定 → 首页正文），互不串。
  if (doc.front_cover) {
    const fcTpl: RecordTemplate = {
      id: 0, name: doc.front_cover.name || '封面', version: 1,
      groups: doc.front_cover.groups, layout_options: doc.front_cover.layout_options || {},
    };
    let fcSrc = generateTypst(fcTpl);
    fcSrc = injectReportFieldsIntoTypst(fcSrc, fcTpl, doc.front_cover.ctx);
    fcSrc = prefixPosMarkers(fcSrc, 'front');
    // 去掉封面自己的前导（import/__cell/#show），只保留 #let data + 正文
    const fcShow = fcSrc.indexOf('#show: record-theme');
    if (fcShow >= 0) fcSrc = fcSrc.slice(fcSrc.indexOf('\n', fcShow) + 1);
    const cShow = coverSrc.indexOf('#show: record-theme');
    const insertAt = coverSrc.indexOf('\n', cShow) + 1;
    coverSrc = coverSrc.slice(0, insertAt) + '\n' + fcSrc + '\n#pagebreak()\n' + coverSrc.slice(insertAt);
  }

  const projectSources: string[] = [];
  const projList = doc.projects || [];
  for (let pIdx = 0; pIdx < projList.length; pIdx++) {
    const p = projList[pIdx];
    const projTpl: RecordTemplate = {
      id: 0, name: p.name || '', version: 1,
      groups: p.groups, layout_options: p.layout_options || {},
    };
    let src = generateTypst(projTpl);
    src = injectReportFieldsIntoTypst(src, projTpl, p.ctx);
    src = prefixPosMarkers(src, `proj${pIdx}`);   // 与 InstanceEditor 的 section key `proj${i}` 对齐
    const showIdx = src.indexOf('#show: record-theme');
    if (showIdx >= 0) {
      const lineEnd = src.indexOf('\n', showIdx);
      src = src.slice(lineEnd + 1);
    }
    // 项目明细段编号标题「N) 项目名」（参考样张：左对齐、加粗、小标题；序号由生成端按结论汇总表同序赋号）。
    // 项目之间靠 #pagebreak() 分页隔开（缺省）。项目名取 title/name，缺省则不出标题。
    const projName = (p.title || p.name || '').trim();
    // weight:700 对无粗体字体（仿宋等）不生效——按 cover 文档字体补 faux-bold 描边，保证项目标题真加粗
    const titleSrc = (p.seq && projName)
      ? `#block(below: 0.6em)[#text(weight: 700${fauxBoldStroke(docFont)}, size: 1.05em)[${escapeTypst(`${p.seq}) ${projName}`)}]]\n`
      : '';
    const prefix = p.page_break === false ? '' : '#pagebreak()\n';
    projectSources.push(prefix + titleSrc + src);
  }
  return coverSrc + '\n' + projectSources.join('\n');
}

/**
 * 把实例文档摊平成「路径 → {label, value}」，用于报告编辑的留痕 diff 与偏离对比（P3）。
 * 普通字段值 = resolveBinding(binding, ctx)；结果表每个单元格单列一条。
 */
export function flattenContentDocValues(doc: any): Record<string, { label: string; value: string }> {
  const out: Record<string, { label: string; value: string }> = {};
  const walk = (sectionKey: string, section: any) => {
    if (!section) return;
    for (const g of section.groups || []) {
      for (const f of (g.fields || []) as FieldDefinition[]) {
        if (f.type === 'report_result_table' && f.result_table) {
          const cols = f.result_table.columns || [];
          for (const cell of f.result_table.cells || []) {
            const col = cols.find(c => c.id === cell.colId);
            out[`${sectionKey}/${f.id}/${cell.rowId}/${cell.colId}`] = {
              label: `${f.label || '结果表'}·${col?.label || cell.colId}`,
              value: resolveBinding(cell.binding, section.ctx),
            };
          }
        } else if (f.binding) {
          out[`${sectionKey}/${f.id}`] = { label: f.label, value: resolveBinding(f.binding, section.ctx) };
        }
      }
    }
  };
  walk('cover', doc?.cover);
  (doc?.projects || []).forEach((p: any, i: number) => walk(`proj${i}`, p));
  return out;
}

/** 比较两份实例文档的字段值，返回 diff 列表（added/removed/changed） */
export function diffContentDocValues(prev: any, next: any): Array<{ path: string; label: string; kind: 'added' | 'removed' | 'changed'; from: string; to: string }> {
  const a = flattenContentDocValues(prev);
  const b = flattenContentDocValues(next);
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const diffs: Array<{ path: string; label: string; kind: 'added' | 'removed' | 'changed'; from: string; to: string }> = [];
  for (const k of keys) {
    const pa = a[k]; const pb = b[k];
    if (pa && !pb) diffs.push({ path: k, label: pa.label, kind: 'removed', from: pa.value, to: '' });
    else if (!pa && pb) diffs.push({ path: k, label: pb.label, kind: 'added', from: '', to: pb.value });
    else if (pa && pb && pa.value !== pb.value) diffs.push({ path: k, label: pb.label, kind: 'changed', from: pa.value, to: pb.value });
  }
  return diffs;
}

/** 报告渲染入口：拼接首页 + 多个项目 */
export function generateReportTypst(opts: {
  cover: RecordTemplate;            // 首页模板（kind=cover）作为伪 RecordTemplate
  coverCtx: ReportRenderCtx;
  projects: Array<{
    template: RecordTemplate;       // 项目模板（kind=project）作为伪 RecordTemplate
    ctx: ReportRenderCtx;
  }>;
}): string {
  // 渲染首页（含 conclusion_table）
  let coverSrc = generateTypst(opts.cover);
  coverSrc = injectReportFieldsIntoTypst(coverSrc, opts.cover, opts.coverCtx);

  // 项目页：每项一组 typst，去掉 #import 头（第一行）以避免重复 import
  const projectSources: string[] = [];
  for (const p of opts.projects) {
    let src = generateTypst(p.template);
    src = injectReportFieldsIntoTypst(src, p.template, p.ctx);
    // 移除项目 typst 的头部（直到第一个 #show 之后），保留正文
    const showIdx = src.indexOf('#show: record-theme');
    if (showIdx > 0) {
      const lineEnd = src.indexOf('\n', showIdx);
      src = src.slice(lineEnd + 1);
    }
    projectSources.push('#pagebreak()\n' + src);
  }
  return coverSrc + '\n' + projectSources.join('\n');
}
