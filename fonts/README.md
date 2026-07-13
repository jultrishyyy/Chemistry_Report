# 项目字体目录（typst 渲染用）

报告/原始记录 PDF 由 `typst` 渲染。`server/src/services/typst-compiler.ts`：**只要本目录里有字体文件，就只用本目录渲染**（`--font-path <本目录> --ignore-system-fonts`）——这样报告版面在**任何服务器上都一致**，不受该机器系统字体影响。若本目录没有字体（如刚 clone、字体被 gitignore），回退到系统字体（原行为）。

> 英文 / 数字默认走 **Arial**：主题与字段级渲染都把 `Arial` 放字体列表最前，CJK 字符自动回退到中文字体（见 `record-theme/lib.typ` 的 `_with-latin` 与 `typst-generator.ts` 的 `styleSetRules`）。

## 当前已加装（本地，未入库）

| 文件 | typst family 名 | 编辑器里选 |
|---|---|---|
| `Songti.ttc` | `Songti SC` / `STSong` | 宋体 / 华文宋体 |
| `SimHei.ttf` | `SimHei` | 黑体 |
| `Kaiti.ttf` | `KaiTi` | 楷体 |
| `Fangsong.ttf` | `FangSong` | 仿宋 |
| `仿宋_GB2312.ttf` | `FangSong_GB2312` | 仿宋_GB2312 |
| `arial*.ttf` | `Arial` | Arial（英文/数字默认） |
| `times*.ttf` | `Times New Roman` | Times New Roman |

> 这些都是**完整**字体、中文全覆盖、已渲染验证。多数取自本机 Microsoft Office / 系统字体（**专有**，仅本地用，已在 `.gitignore` 排除不入库）。部署到别的服务器时需**手动把本目录的字体文件一起拷过去**。

## 加装 / 替换字体

1. 把字体文件（`.ttf` / `.ttc` / `.otf`）拷进**本目录**；
2. 用 `typst fonts --font-path ./fonts --ignore-system-fonts` 查它的 family 名；
3. 在 `client/.../FormatPanel.tsx` 和 `DocumentStylePanel.tsx` 的字体列表加一行（value=family 名）；
4. 重启 server。

> ⚠️ 字体大多为专有字体，本仓库不内置分发——请自备字体文件。
> ⚠️ 因为是 `--ignore-system-fonts`，**模板用到的每个字体都必须在本目录里**，否则会缺字（豆腐块）。改动后请渲染验证。

## 确认 typst 能看到本目录的字体

```bash
typst fonts --font-path ./fonts --ignore-system-fonts | grep -iE "fang|kai|song|hei|arial|times"
```
