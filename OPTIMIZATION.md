# 待优化事项（Backlog）

> 本文件记录已知但尚未实现的优化 / 设计改进项，供日后有空时逐项落地。
>
> **如何追加**：发现新待优化项时，在下方「待办」区按优先级加一节，按模板填写
> （现状 / 问题 / 建议方案 / 影响文件）。完成后把整节移到文末「已完成」区并标注完成日期。
>
> **优先级**：🔴 当前就坏 / 阻断 ｜ 🟠 高（数据/正确性风险）｜ 🟡 中（维护性/规模化）｜ ⚪ 低（清理/锦上添花）
>
> **注**：本文件是项目约定（README 第六节「不要再开决策/分析/TODO markdown」）的一个例外，
> 经决定保留为独立 backlog。变更性的"系统现状"仍应写进 README，本文件只记"想做还没做的事"。

---

## 待办

### ⚪ 报告生成异步化（任务队列 + 前端轮询）——降级，仅剩体验优化

> **2026-06-26 更新**：原以为瓶颈是「生成请求挂太久」，排查后发现 200 人并发的真实 CPU 大头是
> **每次查看/下载报告都重编 typst**——已由「PDF 产物磁盘持久化」（见下方已完成）解决。
> 因此本项**降级为纯体验优化**：生成请求在限流排队靠后时仍会等一会、占一条 HTTP 连接，但 Node 扛
> 数千空闲连接无压力，且生成产物已落盘、后续查看不再重编。**非必需，按需再做。**

#### 方案（若要做）

- `POST /external/requisitions/generate`（UI 实际生成路径）入队后立即返回 `{ job_id }`。
- 任务存储：内存 Map + LRU；多进程部署要持久化再上 `report_jobs` 表。
- 新增 `GET .../jobs/:id` 查状态（pending/running/done/failed + report_id）。
- 前端 `Report/Workbench.tsx` 轮询/SSE。

#### 风险

- 改了生成接口返回契约，动演示主流程，**必须前端 UI 验证回合**（modify-system 阶段 5 I）。这也是它没和后端项一起做的原因。

---

### 🟡 模板编辑器灵活性：统一编辑器重构（详见独立方案）

> **完整设计已单列到根目录 `编辑器改进方案.md`**——统一文档模型 + 一个编辑器三种模式 + 层叠样式 → Typst +
> 直接操作手柄；含数据录入权限边界、报告部件化/封面/logo/页眉页脚、生成端编辑、分期路线（P0 快速赢含
> 文本换行/列宽拖拽/图片表样式）。本条只作指针，避免重复；评审与实现以该文件为准。下方为早期草稿，已并入该文件。

<!-- 以下早期草稿已并入 编辑器改进方案.md，保留备查 -->

#### 背景与问题

- 工程师其实**不写 Typst**，用的是结构化的 `FieldEditor`（拖字段 + 属性面板 + 右侧 PDF 预览），Typst 只是后端"出片引擎"。
- "不灵活"的真实原因有两层：
  1. **结构化模型上"直接操作"的 UI 没建够**。例：`result_table` 的列**模型里已有 `width` 字段**（`shared/types.ts:228`），但画布编辑器没给拖拽手柄、渲染端 `#table(columns: …)` 也还是均分——能力在、入口没接上。
  2. **预览是"死的 PDF"**：`TypstViewer → PdfPreview` 是 `compile → output.pdf → iframe`（`services/typst-compiler.ts`），平面图上没法拖列边 / 拽 logo。

#### 设计原则（不能丢的约束）

- **Typst 仍是输出引擎**：数据绑定、版本化、按锁定版本可复现（合规）这些都靠它，不能换成自由画布。
- **目标是"受约束的直接操作"，不是 Word/InDesign 自由画布**：自由摆任意文本框会和"内容来自数据绑定、必须可复现、要版本化"打架。给**预设 + 可调旋钮 + 拖拽手柄 + 吸附对齐 + 一键回到预设**，对非专业用户更好用也更稳。
- **版式即内容、走版本流**：版式改动存进 `layout_options`，PUT 时进草稿、走审核生效（与现有约定一致）。

#### 架构杠杆（北极星）：预览从 PDF 换 SVG + 叠加层

Typst 支持 `--format svg`。把编辑预览换成**内联 SVG**后，可在其上**叠一层 HTML 拖拽手柄**，配合 Typst `query`/metadata 拿元素包围盒坐标，手柄拖动 → 写回 `width/position/size` → 防抖重编译。这一个改动**同时解锁列宽、logo、页眉页脚**的所见即所得。工程量大，**放最后**；P1/P2 先用更省的 HTML 原生交互验证模式。

#### 分期方案

**P-Editor-1 · 表格列宽拖拽**（最常被要 / 最独立 / 不需要 SVG）
- 做法：在 `ReportResultTableCanvas.tsx` 把列边做成**可拖把手**（HTML 表格，浏览器原生拖列宽、拖时本地秒级回流）；松手写回 `column.width`（`fr` 或 `cm`）；渲染端把 width 拼进 `#table(columns: (…))` 列宽。
- 影响文件：`client/components/FieldEditor/MatrixEditor/ReportResultTableCanvas.tsx`、`shared/typst-generator.ts`（结果表 `#table` colspec）、`shared/types.ts`（`result_table.columns[].width` 已存在，确认语义=fr/cm）。
- 验收：拖动列边 → 预览列宽变化；保存重开仍在；不影响 binding。
- 工作量：小（1 个画布 + 1 处渲染）。风险：低。

**P-Editor-2 · 页眉页脚 + logo「槽位」编辑**（接已实现的版式开关往上长）
- 做法：页眉/页脚各分**左/中/右三槽**，把字段（公司名/报告编号/页码/logo）当卡片**拖进槽**；logo 是图片槽带尺寸手柄。映射到已写好的主题 `grid`（`record-theme/0.1.0/lib.typ` 的 `_render-header/_render-footer`）。logo 放页眉=grid 一格；要"自由摆"=Typst `place(anchor, dx, dy)`，UI 暴露成锚点 + 两偏移滑块 + 尺寸。
- 影响文件：`CoverEditor.tsx`（槽位 UI）、`record-theme/0.1.0/lib.typ`（按槽位/anchor 渲染）、`shared/typst-generator.ts`（透传布局）、`server/routes/reports.ts`（`buildHeaderFooterConfig` 扩展）、新增 logo 上传（复用 `routes/images.ts`）。
- 验收：拖卡片进槽 → 预览页眉页脚布局变化；logo 上传 + 定位 + 调尺寸生效。
- 工作量：中。风险：中（主题渲染分支变多）。

**P-Editor-3 · SVG 叠加画布**（北极星，验证 P1/P2 后再做）
- 做法：预览改 SVG（`typst-compiler` 加 `--format svg` 分支 + `TypstViewer` 渲染 SVG）；Typst `query` 输出带 `<label>` 元素坐标；前端按坐标叠手柄，拖动通用回写 width/position/size，防抖重编译。
- 影响文件：`services/typst-compiler.ts`、`components/TypstViewer/*`、生成器加可定位 `metadata`、新"叠加层"组件。
- 验收：在真实 PDF/SVG 预览上直接拖列边、拽 logo、拉图片大小。
- 工作量：大。风险：中高（坐标映射 + 重编译延迟）。

#### 配套（让它"顺手"）

- **防抖增量重编译 + 现有 LRU 缓存**（`typst-compiler` 已有缓存）→ 实时预览不卡。
- **吸附 / 对齐线 / 网格**；**一键回到预设**。
- 保留 `PreviewEditor`（直接改 Typst）当**高级逃生口**给极少数高手，普通用户不碰。

#### 非目标（明确不做）

- 不做自由文本框 / 绝对定位任意内容（破坏数据绑定与可复现）。
- 不替换 Typst 出片引擎。

#### 待决策（请评审后拍板）

1. 是否要做？若做，先做哪几期（建议先 P-Editor-1）。
2. logo 是"页眉槽位"够用，还是需要"页面自由定位"（决定要不要 `place` + 拖拽画布）。
3. P-Editor-3（SVG 叠加）是否纳入路线，还是长期保持"属性面板 + 拖把手 + PDF 预览确认"即可。

---

### 🟡 嵌套分区（分区里再放分区）

- **现状**：`FieldGroup` 是平铺数组，分区只能装字段。用户场景："结论部分要分别写两个实验的结论"。
- **当前替代**（已够用，2026-06）：「结论」分区预设可**重复添加**——加两次、分区名改"实验一结论 / 实验二结论"，字段编码自动防撞（`uniqueCode`）；或同一分区内复制两组"判定要求/结论"字段。
- **真嵌套的成本**：`FieldGroup.children` 递归化要同步改 5 处都假设平铺的子系统——typst 渲染（section 嵌套+样式层叠作用域）、FormRenderer 递归渲染、编辑器大纲/拖拽（跨层级）、报告 binding 路径、版本 diff/回放兼容。属于模型级改动。
- **建议**：除非出现"重复添加分区"覆盖不了的场景（如需要整块嵌套复用/折叠层级超过两层），不做真嵌套；若做，先只支持两层、且子分区不再有 section_role。
- **影响文件**：`shared/types.ts`、`typst-generator.ts`、`FormRenderer/`、`FieldEditor/`、`binding-integrity.ts`

### ✅ 报告 CellBinding 对原始记录字段缺引用完整性校验（已解决 — P-Tpl-1）

- **现状**：`CellBinding`（`shared/types.ts`）用 `field_code / matrix_code / param_code` 字符串指向原始记录模板的字段，渲染时取不到会静默落 `'—'`。
- **已实现**：`shared/binding-integrity.ts` 的 `validateReportBindings(reportGroups, recordGroups)` 在保存/审核期校验每个 binding 是否命中 `linked_record_template_id` 当前版本字段集；接入 `server/routes/report-templates.ts`（`GET /:id/binding-check` + PUT/approve 响应 `binding_warnings`）与 `client/pages/ReportTemplate/ProjectEditor.tsx`（实时标红 Alert）。默认只告警不阻断保存。
- **仍待做（P-Tpl-2）**：原始记录模板改/删字段 code 时的**反向影响提醒**"有 N 个报告模板绑定将失效"（见 `待实现内容.md` 8.4 第 2 点），可顺带支撑下一条"审核员盲签"。

### ✅ 草稿"单槽位"+ 无并发控制 → 静默覆盖（已解决 — migration 022）

- **已实现**：①`pending` 禁止被 PUT 覆盖（409，需先 `POST /:id/versions/:vid/withdraw` 撤回）；②`rejected` 冻结为不可变历史，再编辑自动开新版本号行（退回内容+审核备注永久保留）；③draft 保存带 `draft_updated_at` 乐观锁（`*_template_versions.updated_at`），不一致 409，三个模板编辑器弹「保存冲突」提示刷新。
- 同步引入"未定稿"新语义：版本号最大的 draft/pending/rejected 且 **版本号 > 当前生效版本**（旧 rejected 是纯历史）。见 README 第六节。

### ✅ 版本 diff 粒度太粗、无法识别重命名（已解决 — shared/template-diff.ts）

- **已实现**：diff 引擎下沉 `shared/template-diff.ts`（前后端共用）：分组按 `group.id`、字段按 `field.id` 配对（改名/改 code 识别为"修改"而非"删+加"），字段内部逐属性输出 from→to（含跨分区移动 `__group__`）。审核 Drawer 新增 `GET /:id/versions/:vid/diff` 实时预览；`diff_from_prev` 定版仍在 approve 时落库；历史 Drawer 兼容渲染 migration 014 旧格式 `{key,kind}`。

### 🟡 审批缺"影响面分析"

- **现状**：`reviewVersion` approve 时只翻 `current_version_id` 指针，不提示影响面。审核体验已升级（审核 Drawer 含修改说明 + 属性级 diff + 新旧 PDF 对比，"盲签"问题大幅缓解），但**量化影响面**仍缺。
- **问题**：审核员不知道这次改动影响了多少在用 `record_data`、多少报告模板 binding 引用了被改/被删字段。
- **建议**：审核 Drawer 再加"本次影响 X 条在用记录、Y 个报告模板绑定"。依赖 binding 完整性能力（P-Tpl-1 已有）。
- **影响文件**：`server/services/template-versions.ts`、`server/routes/{record,report}-templates.ts`、`client/components/TemplateVersionPanel.tsx`（ReviewDrawer）

### 🟡 fork 是纯值拷贝，规模化后重复膨胀 + 各自漂移（漂移问题已部分解决 — migration 022 同步机制）

- **已实现（解决"漂移"）**：fork 时写母子字段映射 `field_mapping`；母模板审核通过后可经同步向导（dry-run 预览 → 选子模板）把映射字段的修改/删除/新增应用到子模板，各生成 pending 版本走正常审核；子模板自建字段不受影响。见 README 第六节「母子字段映射与同步」。
- **仍待做（解决"重复膨胀"）**：存储层仍是整套 `field_definitions` 拷贝。长期方案是"字段/分区库"或模板继承——标准字段（环境温湿度、设备编号等）做成可被多模板引用的共享定义，模板只存引用 + 局部覆盖。改动最大但最治本。
- **影响文件**：`shared/types.ts`（新增引用型字段/分区）、`FieldEditor/`、`typst-generator.ts`、版本表结构（可能需新 migration）

### 🟡 `typst_source` 双事实来源

- **现状**：版本表每行存了一份 `typst_source`，但渲染时 `generateTypst` 从 `field_definitions` 现算。
- **问题**：双事实来源，有 staleness 风险。
- **建议**：确认是否仍被读取，能去则去（统一现算）。
- **影响文件**：`server/services/template-versions.ts`、`shared/typst-generator.ts`、`server/routes/reports.ts`

### 🟡 删报告模板需手动清 v1 外键 `report_template_mappings`

- **现状**：`report_templates` 被 v1 旧表 `report_template_mappings` 外键引用，DELETE 路由必须先手动 `DELETE FROM report_template_mappings`（README 第六节已记）。
- **问题**：易漏的隐式约束，属可收敛技术债。
- **建议**：评估 v1 mappings 是否还需保留，可考虑外键 `ON DELETE CASCADE` 或彻底下线该表。
- **影响文件**：`server/routes/report-templates.ts`、`db/migrations/`（新 migration）

### 🟡 缺版本流端到端 smoke 测试（防回归）

- **现状**：模板版本全链路（建→改→提交→审核→fork→lineage）无自动化冒烟，本次 fork 写已删列的 bug 就是 schema 与代码不同步、靠人记约定才被发现。
- **建议**：加一个最小冒烟脚本/测试跑通版本全链路，CI 或本地一键执行，挡住这类 schema/代码漂移。
- **影响文件**：`scripts/`（新增）

---

### 🟠 报告结果表"按索引绑定"对动态样品失效（详见 `报告映射方案.md`）

- **现状**：报告 `report_result_table` 逐格用 `record_cell{matrix_code, sample_idx, param_code}` 按索引绑定，在报告模板设计期写死；而原始记录 `data_matrix` 允许录入期增删样品。
- **问题**：录入新增样品不进报告、减少样品出空行、顺序变化全错位。映射的"粒度"错了（应矩阵级而非单元格级）。
- **方案**：结果表加"矩阵驱动动态模式"——绑定到矩阵、选参数列、渲染时按实际样品展开。三层职责：结构映射(模板期/工程师) + 实例微调(报告期/文员，已由 P2/P3 支持) + 数据纠错(录入期/审核退回)。**完整方案见 `报告映射方案.md`**。
- **影响文件**：`shared/types.ts`、`shared/typst-generator.ts`、`ReportResultTableCanvas.tsx`、`server/routes/reports.ts`

### 🟠 退回/返工 + 全链路溯源（详见 `待实现内容.md` 第 7 节）

- **现状**：仅数据审核的 reject 退回（场景 2）已实现；报告生成发现记录错(场景 1)、外部反馈要求修改(场景 3) 的退回路径与统一溯源尚无。
- **方案**：统一 `rework_tickets` 工单（退到哪/为什么/被谁处理）+ 复用现有 `record_audit_log`/`report_audit_log`（改了什么）+ 全订单时间线。外部退回采用**分级处理**（文员先收、可升级到主检，工程师共享可见）。数据改动让旧报告标 `stale`。**完整方案见 `待实现内容.md` 第 7 节**。
- **影响文件**：新 migration、`routes/rework.ts`、`services/external-report-feedback.ts`、`GET /api/orders/:order_no/timeline`、Report/Lab 前端。

### 🟡 报告生成 P3 剩余项（编辑能力打磨）

报告生成的批次/拆分(P1)、结构化编辑+实例文档(P2)、编辑留痕+偏离告警(P3 核心)已落地。以下 P3 次要项尚未做：

- **结论汇总表 / 设备表 / 图片表的结构化编辑**：当前在 `InstanceEditor` 里显示为"自动生成"只读（数据来自冻结 ctx 数组）。要支持编辑需把这些 ctx 数组也纳入可编辑面（改 `content_doc` 的 ctx）。
- **结果表的列结构编辑**：当前支持单元格改值 + 增删行；增删列、改表头留待后续。
- **批次合并 PDF/DOCX**：一个批次多份报告，目前各自单独下载；可加 `POST /api/reports/batch/:id/pdf` 合并。
- **报告编号方案**：当前 `report_no` 由前端按模式生成（`order_no` + 后缀），可集中到后端按规则统一编号。
- **影响 `report_template_mappings.report_template_id` 等**：与 binding 完整性校验（见上）配合，做"模板改 code → 报告 binding 失效"提示。
- **文件**：`client/pages/Report/InstanceEditor.tsx`、`server/routes/reports.ts`、`shared/typst-generator.ts`

---

## 已完成

### ✅ 2026-06-28 — 前端 `pnpm build`（tsc -b）恢复绿色（🟠 部署阻断 → 已解决）

历史 backlog 记录 `pnpm build`（`tsc -b && vite build`）因 `noUnusedLocals`/`erasableSyntaxOnly`/Antd6 `Divider orientation` TS2322/Formula 类型不一致等一批存量错误而失败，导致 `client/dist` 停在旧构建、部署拿到过期前端。核对部署文件时**实测**：`tsc -b` 独立退出码 0（三项严格开关全开）、`pnpm build` 完整产出 dist；`<Divider orientation=` 用法已全部移除。问题已不存在，部署脚本 `install-ubuntu.sh` 第 204 行 `pnpm build` 可正常出前端。

### ✅ 2026-06-28 — 清理无关文件 + 修复运行时垃圾产生点（⚪ 清理）

- **Excel 导入临时文件泄漏**：`/tmp/excel-imports/` 上传文件之前永不清理。改为：parse/extract 流程按时效清理（启动时 + 每次 parse 删超 `EXCEL_TEMP_TTL_HOURS` 默认 6h 的旧文件）；attachments 拷贝进 `uploads/` 后立即删原临时文件。`routes/excel-import.ts`。验证：8h 旧文件被清、新文件保留。
- **typst 临时目录泄漏（边缘）**：spawn 失败（如 typst 未装）时 `close` 不触发 → 临时目录残留。两个 spawn 点的 `error` 回调补清理。`services/typst-compiler.ts`。
- **`.gitignore` 加固**：补 `*.tar.gz`/`*.tgz`/`*.zip`/`*.patch`/`*.orig`/`*.rej`/`*.log`/`nohup.out`/`*.pid` 等，防归档/补丁/日志再堆积（当初 `demo_v1-*.tar.gz` 就是这么积的）。
- **删除 cloudflare/公网分享脚本**：`scripts/share-public.sh`、`scripts/share-5173.sh`（cloudflared/ngrok 临时开公网）——内网生产系统不需要、且增加攻击面。同步清掉 RUNNING.md「演示模式/公网」整节 + README 结构树/表/约定里的引用 + vite.config 注释。全仓零残留引用。

### ✅ 2026-06-26 — 报告 PDF 编译产物磁盘持久化（🟠 规模化·真瓶颈）

报告 PDF 之前在**每次查看/下载/回传**时都用 `final_typst` 现编译，只有进程内 LRU（100 条）兜底——重启即失、超 100 条被挤掉、cluster 多进程各编各的。200 人反复看报告时这是 CPU 大头。`typst-compiler.ts` 改为**三级缓存**：进程内 LRU → 磁盘缓存（按 source sha256 落盘，`TYPST_CACHE_DIR`）→ 编译。每份报告内容只编译一次，重启/跨进程仍命中；源码变即换哈希自动失效（typst 确定性渲染，无脏缓存）；超 `TYPST_CACHE_MAX_FILES`（默认 2000）按 mtime 淘汰。缓存命中不占并发闸门槽位。验证：跨进程重启后同一 source 命中读盘（duration=0、不 spawn）、不同 source 仍编译。约定见 README §6。

### ✅ 2026-06-26 — 文档归档：根目录 md 收进 docs/（⚪ 清理）

把 8 个**纯归档类**早期文档收进 `docs/`（分 `背景/规范/计划` 子目录 + `docs/README.md` 索引），根目录从 ~18 个 md 降到 10 个。**留根目录的是活跃引用/操作类文档**：README、RUNNING、OPTIMIZATION、项目背景、待实现内容（被 8 个源码文件引用）、部署说明-Ubuntu（RUNNING + 安装脚本引用）、编辑器改进方案/报告映射方案/外部OA登录对接（特批例外）、外部系统报告跳转对接（SSO 对接 + 记忆引用）。移动后同步更新 README 结构树/文档索引、项目背景.md 文档表的路径。AUDIT：✅ 无 Markdown 链接断链  ✅ 根目录已无被移文件  ✅ docs 下 9 个 md。

### ✅ 2026-06-26 — 运维稳健性：统一错误处理 + 结构化日志（🟡 维护性）

加 `server/src/logger.ts`（零依赖结构化日志）+ `middleware.ts`（请求日志 / `/api` 统一 JSON 404 / 兜底 errorHandler）。errorHandler 注册在最后，捕获路由未处理异常（含 Express 5 async reject），避免请求悬挂/进程异常，统一返回 JSON。现有 console.* 可逐步迁移到 logger，不强求一次性替换。验证：health 不刷屏、正常请求记结构化单行、未知 /api 返回 JSON 404、SPA 回退正常。挂载顺序见 `index.ts`。

### ✅ 2026-06-26 — 前后端解耦部署方案（Nginx，可选）（⚪ 部署）

提供 Nginx 托管 `client/dist` + 反代 `/api` 的可选部署形态：并发更高、静态更快/更省 Node。**应用代码零改动**（前端相对路径 `/api`、所有接口在 `/api/*` 下、同源无 CORS）。产物 `deploy/nginx/cdr-demo.conf`（含 `/api` 反代、SPA 回退、`client_max_body_size 12m` 配 10MB 上传、`proxy_read_timeout 120s` 配报告生成耗时）；Node 端改绑 `HOST=127.0.0.1`。文档见 `部署说明-Ubuntu.md §四点五` + README §3。单进程部署仍是默认。

### ✅ 2026-06-26 — 14 个散落连接池 → 共享单例池（🟡 规模化）

每个路由各 `new Pool(...)`（14 处），等于 14 套连接池、配置重复，高并发下可能打满 PostgreSQL 连接上限。已统一为 `server/src/db.ts` 单例池，13 路由 + `index.ts` 改 `import { pool }`；池大小 `DB_POOL_MAX`（默认 20）+ idle error 兜底。约定见 README §6。

### ✅ 2026-06-26 — typst 编译加并发闸门（🟡 规模化）

每次报告编译 `spawn` 一个 typst 子进程且无并发上限；高并发（如 200 人同时生成）会 fork 打爆机器。已加信号量 `TYPST_MAX_CONCURRENCY`（默认 4），超出排队，缓存命中不占槽位。`services/typst-compiler.ts`，约定见 README §6。验证：10 并行编译在上限=2 下全部成功、排队不崩。

### ✅ 2026-06-01 — `forkTemplate` 向已删 base 列写数据（🔴）

migration 017 已 `DROP COLUMN field_definitions/typst_source/layout_options`，但 `forkTemplate` 仍向两张 base 表 INSERT 这三列 → 任何 fork 都抛 `column does not exist`。已改为 base 表只 INSERT 元数据，内容只写进 v1 版本行。`server/services/template-versions.ts`。

### ✅ 2026-06-01 — 报告模板列表查询读已删列 `t.layout_options`（🔴）

`GET /api/report-templates` 列表 SQL 读 `t.layout_options`（017 已从 base 删除）→ 整个报告模板列表页报错。已改为读当前版本的 `cv.layout_options`（查询已 LEFT JOIN cv），响应结构不变。`server/routes/report-templates.ts:33`。
