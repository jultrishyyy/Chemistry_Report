// 广电计量 - 检测报告主题包

#let report-theme(title: "TEST REPORT", org: "广电计量", body) = {
  set page(paper: "a4", margin: (top: 2.5cm, bottom: 2cm, left: 2cm, right: 2cm))
  set text(font: "Songti SC", size: 10pt, lang: "zh")
  set heading(numbering: none)

  align(center)[
    #text(size: 16pt, weight: "bold")[#title]
    #v(4pt)
    #text(size: 10pt)[#org]
  ]
  v(16pt)
  body
}

#let info-row(label, value) = {
  grid(columns: (120pt, 1fr),
    text(weight: "bold")[#label：],
    if value == none { text(fill: red)[______] } else { [#value] }
  )
  v(4pt)
}

#let report-section(title, body) = {
  v(12pt)
  text(size: 12pt, weight: "bold")[#title]
  v(6pt)
  body
  v(6pt)
}

#let result-row(project, conclusion) = {
  (project, if conclusion == none { text(fill: red)[____] } else { conclusion })
}

#let placeholder(name) = {
  text(fill: red, weight: "bold")[{#name}]
}
