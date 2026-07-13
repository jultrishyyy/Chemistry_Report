---
name: modify-system
description: |
  Use this skill BEFORE making any code change in the demo_v1 project (the chemistry lab
  report generation system). It enforces a structured workflow: orient via README → scope
  the change → modify code → sync docs → self-audit. Triggers when the user asks to add,
  fix, refactor, change, modify, update, remove, implement anything in this codebase.
  Without this skill, edits to the system tend to drift: types desync between shared/ and
  routes, raw_data gets polluted by computed/auto fields, README/RUNNING fall behind code,
  matrix flatten ordering breaks between FormRenderer and typst-generator. This skill
  prevents that.
---

# 在 demo_v1 系统中安全地修改代码

> 化学部检测报告系统当前已有 1.5 万+ 行代码、15 个 migration、50+ API、3 套审核流（数据 / 模板 / 报告版本）。一次性"把整个系统读懂再改"已经不现实。这份 skill 的目标是：让你**只读必要部分、改对地方、不破坏既有约定、保持文档同步**。

## 触发条件

用户提到这些词时优先用这个 skill：
**修改 / 添加 / 实现 / 修复 / 重构 / 调整 / 更新 / 删除 / 改造 / 接入 / 优化** + 项目内的任何具体目标（字段、模板、报告、审核、API、表 等）。

只读类问题（"系统是怎么工作的""数据流是什么"）不需要触发这个 skill — 直接读 README 回答即可。

---

## 五阶段工作流

每次代码修改都按以下五个阶段进行。**不要跳过任何一阶段**。如果某阶段确认不适用，明确说"本次改动不涉及 X，跳过 X 阶段"。

### 阶段 1 — ORIENT（定位）

**目标**：在动手前确认这次改动落在系统的哪个位置。

**强制动作**：
1. 先读 `README.md` 的 **三、代码结构总图** 和 **五、改 X 去哪儿改：速查表**（读这两节就够，不要全文扫读 README）
2. 找到与用户需求最匹配的速查表行；如果都不匹配，找最接近的，并准备在阶段 4 把这条新场景补进速查表
3. 用一句话向用户回报你判断的改动落点。例如：
   > "这次改动落在『五、改 X 去哪儿改 → 渲染相关 → 改报告 PDF 渲染』。主要文件：`shared/typst-generator.ts` + `server/routes/reports.ts`。"

**禁止**：在 ORIENT 完成前先用 Grep 全局搜代码 / 读多个无关文件 / 直接动 Edit。

---

### 阶段 2 — SCOPE（划定范围）

**目标**：列出这次改动**必读**和**必改**的文件，确认所有跨模块影响。

按改动类型走对应清单（参考 README 第五节的分类）：

#### A. 改字段类型 / 字段属性

- 必读：`shared/types.ts`（FieldDefinition / FieldType / FieldSemanticRole / CellBinding 等）
- 必改：`shared/types.ts` + `client/components/FieldEditor/field-types.ts` + `client/components/FieldEditor/FieldPropsPanel.tsx` + `client/components/FormRenderer/index.tsx` + `shared/typst-generator.ts`
- 配套查：`shared/mock-data.ts`（mock 值生成）+ `shared/base-templates.ts`（基础模板有没有用到）

#### B. 改渲染（PDF）

- 必读：`shared/typst-generator.ts` 入口 `generateTypst` / `generateTypstWithData` / `injectReportFieldsIntoTypst`
- 报告渲染入口在 `server/src/routes/reports.ts` 的 `buildReportTypst`
- Typst 主题在 `typst-packages/local/record-theme/0.1.0/`

#### C. 改录入流程

- 必读：`client/src/pages/Lab/{TaskList,Record}.tsx` + `client/src/components/FormRenderer/index.tsx` + `server/src/routes/record-data.ts`
- 录入与报告必须算出**相同**的派生值——查 `FormRenderer` 中 `computeDerivedMerged` 与 `shared/typst-generator.ts` 中 `flattenDataForDisplay`，**两侧顺序必须一致**

#### D. 改报告生成

- 必读：`server/src/routes/reports.ts` 的 `buildReportTypst` + `client/src/pages/Report/{OrderList,Workbench,PreviewEditor}.tsx`
- POST /generate-by-order 入库 + POST /preview 实时预览**共用** `buildReportTypst`，改一处必影响两处

#### E. 改审核流 / 版本管理

- 录入数据审核：`server/src/routes/record-data.ts`（POST/PUT/review）+ `client/pages/Lab/TaskList.tsx`
- 模板版本流（record + report 共用）：`server/src/services/template-versions.ts` + `client/src/components/TemplateVersionPanel.tsx`
- 修改版本流时三种状态机检查：`draft → pending → approved/rejected → 重新 draft`，不能漏掉 reject 后回 draft 的路径

#### F. 改委托单 / 关联模板

- 必读：`server/src/services/seed-work-orders.ts`（mock 数据形状对齐 `example.json`）+ `server/src/routes/work-orders.ts` + `client/src/pages/Lab/TaskList.tsx`
- payload JSONB 结构：`{samples: [{id, name, test_infos: [{name, standard, linked_template_id?, linked_record_id?}]}]}`

#### G. 加 / 改数据库表

- 加新 migration `db/migrations/NNN_xxx.sql`，**绝不**改已存在的 migration
- 跑 `pnpm migrate`
- 同步 `shared/types.ts`
- 文档同步：`README.md` 第八节 migration 表

#### H. 加新 API

- 加 `server/src/routes/xxx.ts`
- 在 `server/src/index.ts` 注册
- 文档同步：`README.md` 第七节 API 一览
- 涉及身份的写操作走 `services/template-versions.ts` 中的 `readActor()`

#### I. 改启动 / 配置 / 依赖

- 文档同步：`RUNNING.md`

**输出**：列出所有「必改文件」+ 配套要看的文件，向用户确认范围后再进入阶段 3。

---

### 阶段 3 — CHANGE（修改代码）

**目标**：按 SCOPE 列出的清单修改，最小化改动面。

**硬规则**：

1. **`shared/` 是单一事实来源**。改 `shared/types.ts` 必须前后端同步跑通，否则不算改完
2. **不要破坏既有约定**（详见阶段 5 自审清单）
3. **复用 helper**：身份用 `readActor()`、版本流用 `services/template-versions.ts`、HTTP 头用户名走 `encodeURIComponent`
4. **保留 v2 兼容路径**：如果遇到 `report_blocks.ts` / 旧 `mappings` 路由 / `variant_list` 兜底，**只读不动**——新功能加在 v3 一侧
5. **不要新建 markdown 文档**：业务变更直接改 README，不要新开决策 / 分析 / TODO 类 markdown
6. **TaskCreate 跟踪进度**：超过 3 个步骤的改动用 TaskCreate 拆开，做完一个 mark 一个

---

### 阶段 4 — SYNC（同步文档）

**目标**：让 README 和 RUNNING 反映改动后的现实。文档脱节是这种系统最容易死的方式。

按改动类型对照下表，**逐项确认**是否需要更新：

| 改动类型 | 同步的文档位置 |
|---|---|
| 加 / 改 API 端点 | `README.md` 第七节"API 一览" |
| 加 / 改 DB 表或列 | `README.md` 第八节"数据库 + Migration 一览" |
| 改演示流程 / 端到端故事 | `README.md` 第二节"演示循环" |
| 改占位 / 接真实接口 | `README.md` 第四节 4.1 / 4.2 / 4.3 |
| 改启动命令 / 依赖 / 配置 | `RUNNING.md` |
| 加非显然约定 / 隐形规则 | `README.md` 第六节"关键约定 / 容易踩坑" |
| 加新模块或新文件 | `README.md` 第三节"代码结构总图" |
| 加新场景 / 改 X 去哪儿改 | `README.md` 第五节速查表 |

**执行方式**：每改一个代码文件，立刻问自己"这改动应该出现在 README/RUNNING 的哪一节"，**当场更新**。不要等所有代码改完再统一改文档（容易漏）。

如果用户说"我只是改个 bug 不用动文档"——确认改动是否仅限于实现细节而**不影响**任何已记录的 API 行为 / DB 结构 / 流程 / 约定。如果是，跳过 SYNC 并明确告知用户。

---

### 阶段 5 — AUDIT（代码自审）

**目标**：检查改动是否破坏既有约定。**这一步比"它能跑"更重要**——很多 bug 是约定违反，编译能过、单元测试能过，但生产会出问题。

按以下清单逐项核对，**每项明确回答 ✅ 不涉及 / ✅ 已遵守 / ❌ 违反需修复**：

#### A. 类型一致性

- [ ] 改了 `shared/types.ts` 的字段，前后端所有引用点都跟改了？
- [ ] 客户端 / 服务端 typecheck 通过？(`pnpm exec tsc --noEmit`)

#### B. 数据流一致性

- [ ] 改了矩阵 / 公式逻辑：`FormRenderer/computeDerivedMerged` 和 `typst-generator/flattenDataForDisplay` 计算顺序仍然一致？（矩阵单元展平 → 单元格/列级公式 → 汇总行公式 → 汇总列公式 → computed_field 拓扑）
- [ ] 矩阵展平键格式仍然遵循：`{matrixCode}__{sampleId}__{paramCode}` / `__summary__` / `__sumcol__`
- [ ] `stripMatrixFlatKeys` 仍然在保存前清理掉所有矩阵虚拟键，**不**让它们污染 `raw_data`

#### C. 字段值写入边界

- [ ] 带 `semantic_role` 的字段（主检 / 审核 / 检测日期 / 审核日期）**不写入 raw_data**——它们的权威值在 `record_data` 表的五列里
- [ ] `computed` 字段进 `derived_data`，不进 `raw_data`
- [ ] HTTP 头里的中文走了 `encodeURIComponent` / `decodeURIComponent`

#### D. 数据完整性

- [ ] upsert 唯一键仍然是 `(template_id, order_no, sample_external_id, test_item_name)`
- [ ] 删除有外键引用的行时（如删模板）按链清理：`record_data` → `report_template_mappings` → `current_version_id` 自指 FK 解除 → 删 base
- [ ] 删模板时处理了子模板：`UPDATE ... SET parent_template_id = NULL WHERE parent_template_id = $1`

#### E. 审核流状态机

- [ ] 数据审核：四种动作（submit / update / approve / reject）都写了 `record_audit_log` + 完整快照 + `version_no`
- [ ] 数据 reject 必须带 note；同一版本不能重复审核
- [ ] 主检改数据后 `audit_status` 重置为 `pending`，`reject_note` 清空
- [ ] 模板审核：作者本人不能审、空 note 不能 reject、approve 后旧 approved → superseded、`current_version_id` 翻指针、base 表的 `field_definitions` / `typst_source` / `layout_options` 同步刷新

#### F. 安全 / 注入

- [ ] 没有引入 SQL 拼接（用参数化查询 `$1, $2`）
- [ ] 没有用 `eval()` 或 `new Function()` 跑用户表达式（公式必须走 `expr-eval` 沙箱）
- [ ] 文件上传路径在 `server/uploads/` 下，没有路径穿越
- [ ] 不暴露 `.env` / `*.local.json` 给前端或日志

#### G. 兼容性

- [ ] 报告 v2 (`blocks[]`) 路径未被破坏（如果改了 v3 一侧）
- [ ] `variant_list` 兜底渲染未被删除（旧数据可能还存在）
- [ ] 旧 record_data（无 `order_no` 等三列）的查询不报错——`POST /` 的 hasContext 分支兜底

#### H. 文档同步性

- [ ] 阶段 4 的清单逐项确认过？
- [ ] README 第三节代码结构总图里所有提到的文件**都还存在**？
- [ ] README 第七节 API 与 `server/src/routes/` 实际端点一致？

#### I. 验证

- [ ] 至少跑一次端到端 smoke：启动 server + 用 python/curl 调相关 API
- [ ] 涉及 UI：让用户确认能否跑一遍演示循环
- [ ] **不要在自审里宣称"功能正常"——只能宣称"已检查 X / Y / Z 三项"**。模型不会真的在浏览器里点

---

## 关键参考文档（按需读，不要一次全读）

| 你要做什么 | 读 |
|---|---|
| 第一次接手这个项目 | `README.md` 一 + 二节 + 三节代码结构（≈ 5 分钟） |
| 改某个具体功能 | `README.md` 第五节速查表 → 找到对应行 → 只读它指向的文件 |
| 加 DB 表 / 加 API | `README.md` 第七 + 八节 |
| 改启动 / 配置 | `RUNNING.md` |
| 不知道为什么这样设计 | `README.md` 第六节关键约定 |

---

## 反模式（绝对不要做）

1. ❌ 直接 Grep / Glob 全项目搜代码而**不先**读 README 第三 / 五节
2. ❌ 改 `shared/types.ts` 但只改一边（前端或后端），不跑通另一边
3. ❌ 把计算字段值塞进 `raw_data`
4. ❌ 在 audit 流里跳过 `record_audit_log` 直接改 `record_data`
5. ❌ 改了已存在的 migration 文件
6. ❌ 改完代码不更新 README / RUNNING
7. ❌ 新开 markdown 文档记决策 / TODO（直接改 README）
8. ❌ 在自审里宣称"测试通过"——只能列出**实际检查过的项**
9. ❌ 自审跳过——这一步比代码本身重要

---

## 五阶段最小输出格式（供模型每次改动结尾汇报）

```
ORIENT: 改动落在『五·渲染相关·改报告 PDF 渲染』
SCOPE:  改 shared/typst-generator.ts + server/routes/reports.ts
        必读：buildReportTypst, resolveBinding, ReportRenderCtx
CHANGE: [diff 摘要]
SYNC:   README 第七节 API 增加新端点；RUNNING 不需要改
AUDIT:  ✅ 类型一致 / ✅ 不污染 raw_data / ✅ 兼容 v2 blocks /
        ✅ typecheck 通过 / ✅ 端到端 curl 验证
```

每次代码改动都以这个格式收尾，让用户一眼看出工作流是否完整执行。

---

## 这份 skill 自身的演化

当系统继续增长，**这份 skill 也要跟着改**——比如：
- 加了第 4 套审核流？补到阶段 5 自审 E 节
- 加了新的"改 X"分类？补到阶段 2 SCOPE 清单
- 出现新的反模式？补到反模式列表

把 skill 当成项目知识的"门户索引"持续维护，而不是一次性写完的静态文档。
