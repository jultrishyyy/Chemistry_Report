// 广电计量 - 原始记录主题包
// 提供统一的排版规范函数
//
// 通过 record-theme.with(title, org, config: (...)) 整体定制文档样式。
// config 支持的键（全部可选，缺省走内置默认）：
//   font:              str  — 字体族
//   body_size:         length — 正文字号（如 10pt）
//   heading_scale:     float — 分组标题相对正文的倍率（如 1.15）
//   title_scale:       float — 文档大标题相对正文的倍率（如 1.4）
//   title_text_args:   dict  — 大标题 text() 覆盖参数（font/size/weight/style/fill），与默认合并
//   title_align:       str   — 大标题对齐 "left"/"center"/"right"（缺省 center）
//   subtitle_text_args:dict  — 副标题(org) text() 覆盖参数，同上
//   subtitle_align:    str   — 副标题对齐（缺省 center）。注：副标题文字＝record-theme 的 org 参数，空串则不渲染
//   line_gap:          length — 「行距」：字段/块之间的上下间距，也用于双列/网格 row-gutter
//   paragraph_gap:     length — 「段间距」：相邻分组（section）之间的空白
//   label_weight:      str  — 字段标签字重（"bold" / "regular"）
//   section_style:     str  — 分组标题样式："left-bold" / "center-bold" / "banner"
//   table_stroke:      length — 表格边框粗细
//   margin:            str/length — 页边距预设("compact"/"normal"/"wide") 或自定义长度(四边统一)
//   margin_v:          length — 上下页边距(覆盖 margin 的 top/bottom)
//   margin_h:          length — 左右页边距(覆盖 margin 的 left/right)

#let _theme-config = state("record-theme-config", (:))

#let _cfg-get(key, default) = {
  let c = _theme-config.get()
  if key in c and c.at(key) != none { c.at(key) } else { default }
}

#let _margin-value(preset) = {
  if preset == "compact" { (top: 1.5cm, bottom: 1.5cm, left: 1.5cm, right: 1.5cm) }
  else if preset == "wide" { (top: 2.5cm, bottom: 2.5cm, left: 2.5cm, right: 2.5cm) }
  else { (top: 2cm, bottom: 2cm, left: 2cm, right: 2cm) }
}

#let _label-weight-value(s) = {
  if s == "regular" { 400 } else { 700 }
}

// 英文/数字默认 Arial：把 Arial 放在字体列表最前，CJK 字符 Arial 无字形→自动回退到中文字体。
// 入参可为字符串或数组；返回 ("Arial", ...原字体)。
#let _with-latin(font) = if type(font) == array { ("Arial",) + font } else { ("Arial", font) }
// 无粗体字重的字体（FandolFang / 仿宋 FangSong(_GB2312) / 黑体 SimHei / 楷体 KaiTi 都只有 Regular）：
// 用描边模拟粗体（faux bold），否则点"加粗"/页眉标题加粗无反应。Songti SC 有真粗体，不在此列。
#let _nobold-font(font) = font != none and font != "" and (
  "Fandol" in font or "FangSong" in font or "SimHei" in font or "KaiTi" in font
)
// 加粗渲染：weight≥700 时——有真粗体的字体用 weight，无粗体的用描边。on=false 则原样。
#let _bold(body, on: true, font: auto) = context {
  if not on { body } else {
    let f = if font == auto { _cfg-get("font", "Songti SC") } else { font }
    if _nobold-font(f) { text(stroke: 0.015em, body) } else { text(weight: 700, body) }
  }
}

// 公开工具：仅在 #field 等已有 context 的位置使用；外部调用方一般用生成器直接拼字面量。
#let label-weight() = _label-weight-value(_cfg-get("label_weight", "bold"))
#let line-gap() = _cfg-get("line_gap", 0.6em)

// 页眉页脚（报告用）：config.header_footer 提供一组机构级元数据 + 版式开关。
// 缺省（普通原始记录模板）时不出页眉页脚，行为与改造前一致。
#let _hf-get(hf, key) = if key in hf and hf.at(key) != none { hf.at(key) } else { "" }

// 页眉/页脚与正文之间「隐藏分割线」两侧的 1.0 行间距（单倍，≈正文 12pt 的一行高）。
// 页眉：报告编号 →(此距)→ 分割线 →(此距)→ 正文；页脚：正文 →(此距)→ 分割线 →(此距)→ 公司信息。
#let _hf-line-gap = 14pt

// 版式对齐参考报告 .doc：页眉=标题居中 + 校验码/报告编号靠右两行；页脚=公司名称/地址/电话传真三行居中 + 页码右下。
#let _render-header(hf) = context {
  let first = counter(page).get().first() == 1
  let cover-no = _hf-get(hf, "cover_report_no")
  let rno = if first and cover-no != "" { cover-no } else { _hf-get(hf, "report_no") }
  let title = _hf-get(hf, "title")
  // 标题字号：首页可单独放大（title_size_first），其余页用 title_size；都缺省 13pt（向后兼容）
  let t-size = hf.at("title_size", default: 13pt)
  let t-size-first = hf.at("title_size_first", default: t-size)
  let title-size = if first { t-size-first } else { t-size }
  // 标题字距（首页大标题常拉开，如"检 测 报 告"）：title_tracking，缺省 0
  let t-track = hf.at("title_tracking", default: 0pt)
  // 是否在页眉下画分隔线：header_rule，缺省 true（向后兼容）。false=隐藏但保留占位距离（见下 hide()）
  let show-rule = hf.at("header_rule", default: true)
  // 页眉字体【固定】：可由 header_footer.font 指定；缺省固定为「仿宋」，**不随文档样式的正文字体变**
  // （页眉是报告版面的固定部分，不应被「文档样式·字体」影响）。
  let hf-font = hf.at("font", default: "FangSong")
  // 可调几何（缺省=原值）：页眉行距 header_leading、报告编号↔正文间距 header_gap（缺省回退 hf_line_gap）
  let hlead = hf.at("header_leading", default: 0.55em)
  let lgap = hf.at("header_gap", default: hf.at("hf_line_gap", default: _hf-line-gap))
  // 标题「检测报告」左右位置（title_align: left/center/right，缺省 center）+ 水平微调 title_dx（缺省 0）
  let talign-s = hf.at("title_align", default: "center")
  let talign = if talign-s == "left" { left } else if talign-s == "right" { right } else { center }
  let tdx = hf.at("title_dx", default: 0pt)
  // 标题 ↔ 校验码 的额外间距（title_gap，缺省 0；除 header_leading 行距外再加这个 v）
  let tgap = hf.at("title_gap", default: 0pt)
  set text(font: _with-latin(hf-font))
  // 行距：校验码/报告编号两行（可调 header_leading）
  set par(leading: hlead, spacing: hlead)
  // 标题「检测报告」独占一行、加粗（仿宋等无粗体字体走 _bold 描边 faux-bold）；对齐/水平位置可调
  align(talign)[#move(dx: tdx)[#text(size: title-size, tracking: t-track)[#_bold([#(if title != "" { title } else { "检测报告" })], on: true, font: hf-font)]]]
  // 标题 → 校验码 的额外间距（可调）
  v(tgap, weak: false)
  // 校验码 / 报告编号 在标题的下一行、右对齐（两行），10.5pt
  align(right)[#text(size: 10.5pt)[校验码：#_hf-get(hf, "verify_code") \ 报告编号：#rno]]
  // 报告编号 → 分割线：hf_line_gap
  v(lgap, weak: false)
  // 页眉与正文的分割线：show-rule=true 画线；false 用 hide() —— 线不可见，但其占位距离仍保留（对齐 .doc 的"隐藏分割线"）。
  // 分割线 → 正文：1.0 行间距由 set page(header-ascent: _hf-line-gap) 提供。
  if show-rule { line(length: 100%, stroke: 0.5pt) } else { hide(line(length: 100%, stroke: 0.5pt)) }
}

#let _render-footer(hf) = context {
  let show-pageno = hf.at("show_page_number", default: true)
  let web = _hf-get(hf, "website")
  let show-rule = hf.at("footer_rule", default: hf.at("header_rule", default: true))
  // 页脚字体【固定】：可由 header_footer.font 指定；缺省固定为「仿宋」，**不随文档样式的正文字体变**。
  let hf-font = hf.at("font", default: "FangSong")
  // 可调几何（缺省=原值）：页脚行距 footer_leading、正文↔页脚间距 footer_gap（缺省回退 hf_line_gap）
  let flead = hf.at("footer_leading", default: 0.4em)
  let lgap = hf.at("footer_gap", default: hf.at("hf_line_gap", default: _hf-line-gap))
  set text(font: _with-latin(hf-font))
  // 每行间距用显式 v() 控制（可调 footer_leading）
  set par(leading: flead, spacing: 0pt)
  // 页脚顶部「隐藏分割线」：不可见但保留占位（与页眉一致）；footer_rule/header_rule 控制是否画线
  if show-rule { line(length: 100%, stroke: 0.5pt) } else { hide(line(length: 100%, stroke: 0.5pt)) }
  // 分割线 → 公司信息：hf_line_gap
  v(lgap, weak: false)
  // 公司名称：12pt 加粗、居中
  align(center)[#text(size: 12pt)[#_bold([#_hf-get(hf, "company_name")], on: true, font: hf-font)]]
  v(6pt, weak: false)   // 公司名称 → 地址 ≈ 16pt
  // 地址：9pt、不加粗、居中（「地址：」标签写死在渲染里，与电话/传真/网址一致；数据只存纯地址值）
  let addr = _hf-get(hf, "company_address")
  align(center)[#text(size: 9pt)[#if addr != "" [地址：#addr]]]
  v(4pt, weak: false)   // 地址 → 电话 ≈ 12pt
  // 电话·传真·网址：9pt、不加粗、居中
  align(center)[#text(size: 9pt)[电话：#_hf-get(hf, "phone")　传真：#_hf-get(hf, "fax")#if web != "" [　网址：#web]]]
  // 页码：9pt、不加粗、右对齐、独占一行（在三行下方，不重叠）
  if show-pageno {
    v(4pt, weak: false)   // 电话 → 页码 ≈ 12pt
    align(right)[#text(size: 9pt)[第 #counter(page).display() 页 共 #counter(page).final().first() 页]]
  }
}

#let record-theme(title: "", org: "广电计量", config: (:), body) = {
  _theme-config.update(config)

  let font = if "font" in config { config.font } else { "Songti SC" }
  let body_size = if "body_size" in config { config.body_size } else { 10pt }
  let title_scale = if "title_scale" in config { config.title_scale } else { 1.4 }
  let margin_preset = if "margin" in config { config.margin } else { "normal" }

  let hf = if "header_footer" in config { config.header_footer } else { none }
  let hf-on = hf != none and hf.at("enabled", default: true)

  // margin 可以是字符串预设(compact/normal/wide)，也可以是自定义长度(如 2cm)——后者四边统一
  let base-margin = if type(margin_preset) == length {
    (top: margin_preset, bottom: margin_preset, left: margin_preset, right: margin_preset)
  } else { _margin-value(margin_preset) }
  // margin_v（上下）/ margin_h（左右）若提供则分别覆盖；缺省继承上面的四边值
  let margin_v = if "margin_v" in config { config.margin_v } else { none }
  let margin_h = if "margin_h" in config { config.margin_h } else { none }
  let base-margin = (
    top: if margin_v != none { margin_v } else { base-margin.top },
    bottom: if margin_v != none { margin_v } else { base-margin.bottom },
    left: if margin_h != none { margin_h } else { base-margin.left },
    right: if margin_h != none { margin_h } else { base-margin.right },
  )
  // 有页眉页脚时放大上下页边距，给页眉/页脚留出空间。可调（缺省=原值）：
  //   top_margin（页眉区/正文上边距，缺省 5.3cm）、bottom_margin（页脚区/正文下边距，缺省 3.6cm）
  let hf-top = if hf-on { hf.at("top_margin", default: 5.3cm) } else { base-margin.top }
  let hf-bottom = if hf-on { hf.at("bottom_margin", default: 3.6cm) } else { base-margin.bottom }
  let page-margin = if hf-on {
    (top: hf-top, bottom: hf-bottom, left: base-margin.left, right: base-margin.right)
  } else { base-margin }
  // 页眉/页脚与正文之间间距：拆成 header_gap（报告编号↔正文）/ footer_gap（正文↔页脚），缺省回退 hf_line_gap（14pt）
  let header-gap = if hf-on { hf.at("header_gap", default: hf.at("hf_line_gap", default: _hf-line-gap)) } else { 30% }
  let footer-gap = if hf-on { hf.at("footer_gap", default: hf.at("hf_line_gap", default: _hf-line-gap)) } else { 30% }
  // 页面尺寸：缺省 A4(21×29.7)；header_footer.page_height 设了就用 21cm × 该高度（如参考样张 29.0cm）
  let ph = if hf != none { hf.at("page_height", default: none) } else { none }

  set page(
    ..(if ph != none { (width: 21cm, height: ph) } else { (paper: "a4") }),
    margin: page-margin,
    // 分割线 → 正文 / 正文 → 分割线 的间距（与页眉/页脚内 v(header_gap/footer_gap) 对称）
    header-ascent: header-gap,
    footer-descent: footer-gap,
    header: if hf-on { _render-header(hf) } else { none },
    footer: if hf-on { _render-footer(hf) } else { none },
  )
  set text(font: _with-latin(font), size: body_size, lang: "zh")
  set par(leading: 0.65em)  // 字内行距固定，不暴露
  set heading(numbering: none)
  // 全局 faux-bold：`*粗*` markup / #strong 在无粗体中文字体（仿宋/黑体/楷体）下 weight:bold 不生效，
  // 给 strong 补描边模拟粗体（保留 weight，故西文真粗体不丢）——一处覆盖所有表头/富文本加粗。
  show strong: it => if _nobold-font(font) { text(stroke: 0.015em, it) } else { it }
  // 报告项目章节标题（renderContentDoc 为每个项目段前置 #heading level 1）：默认 10.5pt 加粗、居中。
  // faux-bold 感知：无粗体中文字体（仿宋等）补描边，否则用真粗体。
  show heading.where(level: 1): it => align(center, block(above: 0.9em, below: 0.5em)[
    #text(size: 10.5pt, weight: "bold", ..(if _nobold-font(font) { (stroke: 0.015em) } else { (:) }))[#it.body]
  ])

  // 顶部受控行（原始记录用）：受控号 + 颁布日期 + 实施日期。对齐 .xls 顶部样式。
  let ctrl = if "controlled" in config { config.controlled } else { none }
  if ctrl != none and ctrl.at("no", default: "") != "" {
    grid(columns: (1fr, auto, auto), column-gutter: 14pt,
      align(left)[#text(size: 10.5pt)[#ctrl.at("no", default: "")]],
      align(right)[#text(size: 10.5pt)[颁布日期：#ctrl.at("issue_date", default: "")]],
      align(right)[#text(size: 10.5pt)[实施日期：#ctrl.at("effective_date", default: "")]],
    )
    v(16pt)
  }

  // 标题 / 副标题：默认样式 + 用户在编辑器配置的 title_text_args/subtitle_text_args（字典合并，后者覆盖）+ 独立对齐
  let _al(s) = if s == "left" { left } else if s == "right" { right } else { center }
  let title_args = (size: body_size * title_scale, weight: 700) + (if "title_text_args" in config { config.title_text_args } else { (:) })
  let subtitle_args = (size: body_size * 0.9, fill: gray) + (if "subtitle_text_args" in config { config.subtitle_text_args } else { (:) })
  let title_al = _al(if "title_align" in config { config.title_align } else { "center" })
  let subtitle_al = _al(if "subtitle_align" in config { config.subtitle_align } else { "center" })

  // 标题/副标题：空串＝不渲染（首页模板"只渲染字段"时把两者置空即可，连顶部间距也省掉）
  if title != "" {
    // 大标题加粗走 faux-bold（仿宋等无粗体字体也能加粗）；weight 非加粗（regular/400）则不描边
    let t-on = title_args.at("weight", default: 700) in (700, "bold")
    align(title_al)[#_bold(text(..title_args)[#title], on: t-on)]
  }
  if org != "" {
    if title != "" { v(4pt) }
    align(subtitle_al)[#text(..subtitle_args)[#org]]
  }
  if title != "" or org != "" { v(12pt) }
  body
}

// title_args=auto → 默认标题（faux-bold 感知加粗，使仿宋等无粗体字体的标题也加粗）；
// 否则用生成器算好的 text() 参数（含 weight/stroke/font/size/fill），供分区「标题格式」逐分区定制。
#let section(title, body, title_args: auto, title_gap: 0.4em) = context {
  let body_size = _cfg-get("body_size", 10pt)
  let scale = _cfg-get("heading_scale", 1.15)
  let style = _cfg-get("section_style", "left-bold")
  let pg = _cfg-get("paragraph_gap", 0.8em)
  v(pg)
  // 标题渲染：默认走 _bold（按文档字体决定真粗体 or 描边模拟）；有 title_args 则直接套用。
  let titled = if title_args == auto {
    _bold(text(size: body_size * scale)[#title], on: true)
  } else {
    text(..title_args)[#title]
  }
  // sticky: 让标题与紧随其后的内容尽量保持同页（若下一块装不下则一起换页）
  block(sticky: true)[
    #if style == "center-bold" {
      align(center, titled)
    } else if style == "banner" {
      block(
        fill: rgb("#f0f5ff"),
        inset: (x: 8pt, y: 5pt),
        width: 100%,
        radius: 2pt,
        titled,
      )
    } else {
      titled
    }
    #v(title_gap)
  ]
  body
}

// 文本换行：把值里的 "\n" 渲染成换行、空行渲染成分段。
// 供生成器的 __cell（矩阵/内联单元格）使用，让多行文本框 / 报告里手填的多行文字在 PDF 里真的换行
// （否则 Typst 正文会把单个换行折叠成空格）。普通单行值原样返回，不受影响。
// 注：#field 的值不走这里（它内部用 linebreak 拆行——见 field 内注释，为配合悬挂缩进的 par()）。
#let multiline(v) = {
  if v == none { "" } else {
    let s = if type(v) == str { v } else { str(v) }
    s.split("\n\n").map(p => p.split("\n").join(linebreak())).join(parbreak())
  }
}

#let field(label, value, unit: none, label_bold: none, label_args: (:), value_args: (:), gap: none, label_width: auto) = context {
  // gap（来自分区「格式·字段间距」block_spacing）优先；未给时用文档级 line_gap。
  // 这样调分区字段间距时普通字段与图/表一起变（图/表靠 set block(spacing)，字段靠这里的 above/below）。
  let lg = if gap != none { gap } else { _cfg-get("line_gap", 0.6em) }
  // 值内换行不走 multiline()：下方悬挂缩进用显式 par() 包裹，par() 内出现 parbreak 会被吞掉并告警，
  // 故空行（\n\n）在这里渲染成两个 linebreak（视觉上仍是空一行，且保持缩进对齐）。
  let display = if value == none or value == "" { "______" } else {
    let s = if type(value) == str { value } else { str(value) }
    s.split("\n").join(linebreak())
  }
  let suffix = if unit != none { " " + unit } else { "" }
  // label_width：标签固定列宽（含冒号），使所有字段的「值」对齐到同一制表位（公文/报告版面）。
  // 分区级覆盖（label_width 参数）优先：auto=跟随文档全局、none=紧贴、长度=按该宽度对齐。缺省 none = 行内紧贴。
  let lw = if label_width != auto { label_width } else { _cfg-get("label_width", none) }
  // 标签是否加粗：字段级 label_bold 优先，否则跟随文档 label_weight。faux-bold 兼容无粗体字体（仿宋）。
  let on = if label_bold != none { label_bold } else { _label-weight-value(_cfg-get("label_weight", "bold")) == 700 }
  let lbl = _bold([#label], on: on)
  // 字段名/字段值各自的独立文字样式（P14·14.2）：缺省空 dict ⇒ 不包 text()，向后兼容。
  let lbl_styled = if label_args.len() > 0 { text(..label_args)[#lbl] } else { lbl }
  let val_styled = if value_args.len() > 0 { text(..value_args)[#display] } else { display }
  // 悬挂缩进：值内 \n 换行（如多台测试设备各占一行）或长值自然折行时，
  // 第二行起对齐到值的起点（标签「XX：」之后），不再顶格。
  // 必须用显式 par()——#set par(hanging-indent) 对 block 内松散行内内容不生效（Typst 0.13+）。
  // 缩进量：lw 固定列宽时 = lw；否则实测标签宽——注意不能直接 measure([#lbl_styled：])：
  // 全角冒号在测量时位于"行尾"，CJK 标点调整会裁掉它的尾部空白，量出来偏短约半个冒号，
  // 第二行会左漂。故带一个尾随汉字测量再减去该汉字宽，取到冒号在行中的全宽 advance。
  // 标签装进 indent 等宽的 box：首行值起点与悬挂缩进在构造上严格相等
  // （也隔断 CJK⇄拉丁自动间距，值以英文开头时首行不会多出对不齐的间隙）。
  let indent = if lw != none { lw } else { measure([#lbl_styled：字]).width - measure([字]).width }
  block(above: lg, below: lg, par(hanging-indent: indent)[#box(width: indent)[#lbl_styled：]#val_styled#suffix])
}

#let inline-fields(gap: none, ..items) = context {
  let weight = _label-weight-value(_cfg-get("label_weight", "bold"))
  // gap（来自生成端按本模板 line_gap 显式传入）优先；缺省回退主题 line_gap。
  // 与 #field 同口径——避免报告里项目段两列字段落到首页 #show 的 line_gap（全文共用首页 #show）造成间距泄漏。
  let lg = if gap != none { gap } else { _cfg-get("line_gap", 0.6em) }
  let cells = items.pos().map(item => {
    let (label, value, unit) = item
    let display = if value == none { "____" } else { str(value) }
    let suffix = if unit != "" { " " + unit } else { "" }
    [#text(weight: weight)[#label]: #display#suffix]
  })
  block(above: lg, below: lg)[
    #grid(columns: cells.len(), column-gutter: 24pt, ..cells)
  ]
}

#let result-table(headers: (), rows: ()) = context {
  let stroke_w = _cfg-get("table_stroke", 0.5pt)
  let stroke = if stroke_w == 0pt { none } else { stroke_w + black }
  let cols = headers.len()
  // 列宽：第一列（"项目"标签）auto，其余 1fr 均分剩余页宽
  let col_widths = if cols == 0 {
    (1fr,)
  } else if cols == 1 {
    (1fr,)
  } else {
    (auto,) + (cols - 1) * (1fr,)
  }
  let all-cells = headers.map(h => [*#h*])
  for row in rows {
    let (label, value) = row
    all-cells.push([#label])
    let display = if value == none { "" } else { str(value) }
    all-cells.push([#display])
  }
  table(columns: col_widths, stroke: stroke, inset: 6pt, ..all-cells)
}
