# 化学部检测报告系统 v3 — Demo

> **运行说明已独立到 [`RUNNING.md`](./RUNNING.md)**。本文件是系统总览，目的是让没接触过这个项目的人读完后**知道改什么去哪儿改**。
>
> 🤖 **给 Claude 的提示**：改任何代码前先按 `.claude/skills/modify-system/SKILL.md` 里的 5 阶段工作流（ORIENT → SCOPE → CHANGE → SYNC → AUDIT）走。它强制只读必要文件、不破坏既有约定、保持文档同步、做代码自审。

---

## 一句话定位

把化学部"手填 Excel + 手抄 Word 报告"的纸质流程，变成一条数字化流水线：**录入数据 → 自动按映射规则注入报告模板 → Typst 渲染印刷级 PDF**。每一步可追溯、可版本化、可审核。

---

## 架构与运维要点（并发 / 性能 / 部署）

**技术栈**：前端 React 19 + Vite + Antd 6（`client/`）｜ 后端 Express 5 + PostgreSQL（`server/`）｜ 前后端共享类型与 Typst 生成器（`shared/`）。前端用相对路径 `/api`，前后端**已分离**，生产默认单进程部署（Express 同时托管 `client/dist` + `/api`）。

**面向多人并发（如内网 200 人）已做的加固**（细节见 §六、环境变量见 `RUNNING.md`）：

| 维度 | 做法 | 关键位置 / 开关 |
|---|---|---|
| 数据库连接 | 全进程**一个共享连接池**（非每路由一个） | `server/src/db.ts`，`DB_POOL_MAX`（默认 20） |
| Typst 编译并发 | 信号量**限流**，防高并发 fork 打爆机器 | `services/typst-compiler.ts`，`TYPST_MAX_CONCURRENCY`（默认 4） |
| 报告 PDF 性能 | 编译产物**磁盘持久化**，每份内容只编译一次、重启/跨进程仍命中 | `TYPST_CACHE_DIR` / `TYPST_CACHE_MAX_FILES` |
| 运维稳健性 | 统一错误兜底 + 结构化请求日志 + `/api` JSON 404 | `server/src/{logger,middleware}.ts` |
| 部署 | 默认单进程；可选 Nginx 托管静态 + 反代 `/api`（应用代码不变） | `deploy/nginx/cdr-demo.conf`，`部署说明-Ubuntu.md §四点五` |

已知优化项与取舍记录都在 `OPTIMIZATION.md`。

---

## 目录速查

1. [系统在做什么](#一系统在做什么)
2. [演示循环（端到端故事）](#二演示循环端到端故事)
3. [代码结构总图](#三代码结构总图)
4. [已实现 vs 留给接口的占位](#四已实现-vs-留给接口的占位)
5. [改 X 去哪儿改：速查表](#五改-x-去哪儿改速查表)
6. [关键约定 / 容易踩坑](#六关键约定--容易踩坑)
7. [API 一览](#七api-一览)
8. [数据库 + Migration 一览](#八数据库--migration-一览)
9. [DOCX 导出技术路径](#九docx-导出技术路径)

---

## 一、系统在做什么

化学部承接第三方检测业务（汽车主机厂、电子电器厂等）。一份业务的真实生命周期：

```
客户委托 → 样品送检 → 实验室分项检测 → 填写原始记录 →
审核原始记录 → 生成检测报告 → 报告审批 → 交付客户
```

每份业务对应**两份核心文档**：

| 文档 | 用途 |
|---|---|
| 原始记录 | 实验过程的全量数据存档（环境条件 / 设备编号 / 操作员 / 误差）|
| 检测报告 | 给客户的最终结论文档 |

两者通过**字段映射 + 公式计算**联系起来。系统的核心任务就是把"模板设计 / 数据录入 / 字段映射 / 报告生成 / 审核溯源"这条链路完全数字化。

### 三类核心资源

```
┌─────────────────────────────────────────┐
│ 原始记录模板 (record_templates)         │
│   工程师定义实验员要填什么字段、什么单位、 │
│   什么公式。FieldGroup[] → Field[]       │
└─────────────────────────────────────────┘
              ▼
┌─────────────────────────────────────────┐
│ 报告模板 (report_templates)              │
│   分 cover（首页）/ project（项目）两类  │
│   复用同一套 FieldGroup 结构 + 4 种      │
│   报告专属字段类型（结论汇总表/检测结果表/│
│   设备表/图片表）+ CellBinding 取值绑定  │
└─────────────────────────────────────────┘
              ▼
┌─────────────────────────────────────────┐
│ 委托单 (work_orders) — 接入演示          │
│   一张单 → 多个样品 → 每个样品多个测试   │
│   项目 → 工程师为每个测试项目"关联"原始   │
│   记录模板。结构对齐 example.json        │
└─────────────────────────────────────────┘
```

### 四类角色

| 角色 | 演示用户 | 能做什么 |
|---|---|---|
| 主检 (tester) | 张工 / 李工 | 关联模板、录入数据、修改数据 |
| 审核员 (reviewer) | 王主管 / 赵主管 | 审核 record_data，审核模板版本 |
| 模板编辑者 | 任意 tester | 编辑模板（保存为 draft） |
| 模板审核员 | 任意 reviewer | 审核模板的 draft → approved |

> **登录 + 本地 RBAC**：登录走 `POST /api/auth/login`（后端调外部认证接口 5.1，未配 `COMMON_LOGIN_URL` 时 mock，任意密码即登录）；认证系统只给身份，**角色/权限在本地管理**（`users` 表 + `shared/rbac.ts` 矩阵 + 用户管理页）。**五个角色（migration 033 重构）**：`admin`(管理员)/`test_engineer`(测试工程师=选记录/录入数据·主检)/`test_supervisor`(测试主管=编辑原始记录模板+审核数据)/`report_clerk`(报告文员=生成+编辑报告)/`report_reviewer`(报告审核=编辑报告模板+审核报告)。演示账号：`admin`/`zhang_eng`+`li_eng`(测试工程师)/`wang_sup`+`zhao_sup`+`sun_sup`(测试主管)/`clerk`(报告文员)/`tpl_rev`(报告审核)。**鉴权按权限并集**（`rolesHavePermission`/`actorHasPermission`，前端发 `X-Demo-Roles` 全角色头），支持自助申请叠加角色。详见第七节「登录 + 本地角色权限」。

---

## 二、演示循环（端到端故事）

> 演示阶段所有数据都是 mock；进真实接口时**只需替换数据源**，前端 / API / 业务逻辑完全不动。详见第四节。

```
0. 启动后端 → seed 默认模板（按 name 幂等，已存在跳过、不覆盖用户改动）。内容＝运行系统里这几个
   真实模板【当前版本的完整配置快照】（逐字段一致，含间距/图片/绑定）：
   ├─ 原始记录：基础原始记录模板 + 密度和相对密度试验原始记录 + 透光率雾度试验原始记录 + 塑料弯曲测试报告
   │            （shared/seed-record-templates.data.ts，经 shared/base-templates.ts seed=true 入库）
   └─ 报告：标准检测报告首页(cover) + 密度试验项目报告 + 透光率试验项目报告 + 弯曲强度&弯曲模量(project)
            （shared/seed-report-templates.data.ts，经 shared/report-base-templates.ts；项目按 name 关联回原始记录）
   ⇒ 迁移到全新空库的服务器，默认即带这套模板。改了默认模板＝在系统里改好后重跑
   `pnpm tsx scripts/dump-seed-templates.ts` 重新导出快照（见第三节）。
   委托单数据源（services/external-orders.ts）现返回空，不再注入伪造单；
   演示期在 /lab 用「新建订单」手动建单（source=manual，与接口单同构）

1. 工程师（张工）在 /record-templates 编辑模板
   ├─ 拖拽分区 / 字段 / 矩阵 / 图片
   ├─ "保存为草稿"（不立即生效）
   └─ 提交审核 → 状态 pending

2. 模板审核员（王主管）在列表里点「审核」按钮
   ├─ 审核通过 → base.current_version_id 翻指针，新版本生效
   └─ 退回 + 备注 → 张工看到红 banner，改完重提

3. 实验室录入（/lab → 订单列表 → 进入详情 /lab/order/:no）
   ├─ /lab 看委托单列表（进度概览）；没有单就「新建订单」手动建
   ├─ 进详情页看 样品 × 测试项目；为每个项目"搜索关联"对应的原始记录模板
   ├─ 主检点「录入」 → FormRenderer 表单（含矩阵 / 公式 / 图片[选图+拍照] / Excel 导入）
   ├─ 图片也可不开录入页单独上传：详情页「上传图片」Modal，或手机/Pad 开 /m/upload 拍照
   ├─ 主检 / 检测日期由系统自动填（semantic_role 字段，只读）
   ├─ 「保存草稿」(draft，不进审核队列) 或「提交审核」(pending)；未保存离开有守卫提示
   └─ 详情页可「提交审核」草稿 / 「撤回」待审记录，写版本快照

4. 数据审核（订单详情页同页）
   ├─ 审核员（不能是主检本人）点「审核」
   ├─ 通过 → audit_status=reviewed
   └─ 退回 + 备注 → 主检看到红 banner，改完重提（自动 +1 版本）

5. 生成报告（/report）
   ├─ 选委托单 → 工作台（左编辑 + 右实时 PDF 预览）
   ├─ 看到本单录入进度；每个项目可「查看原始记录」（只读，按锁定版本渲染，不可编辑）
   ├─ 选首页模板 + 各项目模板（按关联自动推荐）
   ├─ 选出报告方式：整单一份 / 按样品 / 按项目 / 自由（一单可出多份，共享首页各自首页）
   ├─ 系统按字段映射自动注入实验数据 + 主检/审核签字
   └─ 编译 Typst → 多份报告入库为一个批次（report_batches + reports 表）

6. 任意时刻溯源
   ├─ 单号「审核记录」Drawer：完整版本流（每条带数据快照 + diff）
   ├─ 模板「版本历史」：完整改动流水
   └─ 模板「派生关系」：母子模板树
```

---

## 三、代码结构总图

```
demo_v1/
├── README.md                  # 本文件 — 系统总览
├── RUNNING.md                 # 怎么跑起来
├── 项目背景.md                 # 业务背景（背景参考，不必更新）
├── docs/                       # 归档文档：早期方案/规范/计划，分 背景/规范/计划 子目录，见 docs/README.md
│
├── client/                    # React 19 + Vite + Antd 6  (:5173)
│   └── src/
│       ├── auth.tsx           # AuthProvider：真实登录(POST /api/auth/login)+ 存用户/角色/权限 + 拦截器加 X-User-Job/X-Demo-User/X-Demo-Role/Bearer；useAuth().has(perm) 门控 + useAuth().refresh()(重拉 /me)。pages/Login.tsx 登录页、pages/Admin/Users.tsx 用户管理(含「待审角色申请」审核面板)、pages/Account/MyRoles.tsx 我的角色/自助申请(顶部用户名下拉进入)
│       ├── hooks/useUnsavedGuard.tsx  # 未保存改动守卫（beforeunload + 返回三选一确认）
│       ├── theme.ts           # 全局 UI 主题（Antd ConfigProvider token：专业蓝/圆角/密度/表格·卡片样式）—— 改风格只改这里
│       ├── App.tsx            # 路由 + ConfigProvider(theme + zhCN locale) + 列表页浅灰底
│       ├── pages/
│       │   ├── Playground.tsx
│       │   ├── RecordTemplate/{List, Editor}.tsx
│       │   │                  # 原始记录模板：列表 / 编辑器（左编辑右 PDF 预览）
│       │   ├── Lab/{TaskList, OrderDetail, Record}.tsx + order-shared.ts
│       │   │                  # 录入工作台：TaskList=订单列表（进度概览+新建/删除单）→ OrderDetail=单详情（样品×项目表+关联/录入/审核/编辑订单/上传图片）→ Record=录入页；order-shared.ts 为两页共用类型+纯函数
│       │   ├── Mobile/ImageUpload.tsx   # 移动端拍照上传页（/m/upload，无导航全幅，选单→样品×项目→拍照/选图）
│       │   ├── ReportTemplate/{List, CoverEditor, ProjectEditor, Editor}.tsx
│       │   │                  # 报告模板（cover / project 拆分）+ 早期 v2 编辑器（保留）
│       │   ├── Report/
│       │   │   ├── OrderList.tsx       # /report：委托单列表
│       │   │   ├── Workbench.tsx       # /report/order/:no：报告详情页（取号驱动，单列）。订单信息+录入进度+「编辑首页」(→cover-draft InstanceEditor)+取号报告补齐。拆分由外部取号决定，本系统不选
│       │   │   ├── PreviewEditor.tsx   # /report/preview?id=：原始 Typst 二次编辑（高级）
│       │   │   ├── InstanceEditor.tsx  # /report/edit?id=：结构化编辑实例文档（改值/增删字段/结果表行，重渲染，不回写 record_data）。**顶栏「退回原始记录」**（非首页草稿、有 order_no 才显示）：列本报告引用的原始记录（scope-candidates included）→ 选一条用 `ReadonlyRecordViewer`(传 reportId) 只读查看并退回给主检（POST `/api/rework` scope=record/data_entry）→ 记录回 rejected、主检在 /lab 重录重审、本报告被阻断送审，重审通过后按新数据重生成；退回后回本单详情页。**首页草稿(is_cover_draft)只编辑/预览首页**（projects 仅留作结论表 ctx，不渲项目明细页；meta.coverOnly 控制 sections 与 renderDoc）；**「返回」回本单详情页** `/report/order/:no`（缺 order_no 才退列表）；顶栏 sticky+页面 `height:100%`（在 AppNav 下方 flex 容器内、下滑不消失）；已去掉顶部两条提示 banner；字段工具条改浅蓝小卡片(`#eef4ff`+边框)与字段区分。右侧预览＝`TypstViewer mode="view" height="100%"` + `enableSync`（左侧字段聚焦→`viewerRef.scrollToMarker(code,groupId)` 滚到对应位置，重编译保滚动位置不回顶部）；预览 Card 已去掉「实时预览」标题栏。**左侧编辑区视觉对齐模板编辑器**（2026-06：分区＝圆角标题胶囊；每个分组＝白底 `.fe-group-card`(头部灰底分区名+字段数+格式按钮)；字段行复用模板编辑器 `.fe-row`(hover/选中高亮)+`.fe-drag` 拖拽手柄）；**保留行内直接改值**（简单字段值在行内 Input 直接改＝设 `binding={source:'literal'}`，不必进属性面板）——与模板编辑器(FieldEditor)的差异：值编辑是行内而非属性面板（文员场景多为改值，故不照搬 FieldEditor 的属性面板值编辑）。字段类型分派器(FieldRow)给每种类型配编辑器：`report_*` 各自专属编辑器 + **`image`→`ImageFieldEditor`（文员上传/排序/删照片，写 `field.image_photos`；「详细编辑」按钮弹 Drawer **复用 `FieldPropsPanel`**(editorMode=report-cover，改标题/显示标题/备注/布局/尺寸/标题样式，onChange→Object.assign 进字段)）**——首页 image 不经 record_data，照片随 content_doc 挂字段上，由 `generateImageGroupContent` 直接读 `image_photos` 渲染（空＝「（无图片）」占位框）
│       │   │   └── Detail.tsx          # /report/legacy：v1 旧详情页保留
│       │   └── Equipment/Library.tsx   # 设备库 import + 检索
│       └── components/
│           ├── AppNav.tsx              # 顶部导航（品牌块 + 菜单 + UserSwitcher）
│           ├── PageHeader.tsx          # 统一页面头（标题 + 副标题 + 右侧操作区），各列表页复用
│           ├── FlowSteps.tsx           # 紧凑流程进度（关联→录入→审核），替代"标签汤"
│           ├── UserSwitcher.tsx        # 顶部当前用户（姓名 + 角色标签 + 下拉登出）
│           ├── TemplateVersionPanel.tsx
│           │                # 模板版本管理面板（compact / actionsOnly 两种渲染模式）
│           │                # 状态条 + 提交审核 + 审核 Modal + 历史 Drawer + Lineage 树 + Fork
│           ├── FieldEditor/            # 模板编辑器（原始记录 + 报告共用）
│           │   ├── index.tsx
│           │   ├── FieldPropsPanel.tsx # 字段属性面板（report binding / 字段级格式；semantic_role 不再手选，由「溯源信息」预设固化、此处只读显示）。**非图片表格（data_matrix / report_result/equipment/sample/conclusion_table，见 `LABEL_NOTE_TAB_TYPES`）的表格【标题】拆成独立「标签」Tab、下方【备注】拆成独立「备注」Tab；「基础」Tab 精简为 类别+必填；「版式」Tab 放整表文字（字体/字号/表头·内容加粗）+ 对齐间距——样品信息表/检测结论表还多一个「内容对齐」(写 `table_style.cell_align`，渲染端 renderSampleTable/ConclusionTable 生效)。检测结论表「类型配置」的列改为逐列 开关+改列名(column_labels)+列宽，与样品信息表同款 UI**
│           │   ├── TitleStylePanel.tsx # PDF 大标题/副标题：文字 + 字体/加粗/居中/颜色（复用 FormatPanel，record 模式）
│           │   ├── DocumentStylePanel.tsx
│           │   ├── FormatPanel.tsx       # Word 式格式面板（字体/字号/加粗/斜体/对齐/行距）→ StyleOverride，区块/字段级共用
│           │   ├── section-presets.ts  # 分区预设：基本信息/试验结果/图片记录/结论/溯源信息(已固化 semantic_role)+ 签字栏(报告)。预设带可选 mode('report'/'record'),「添加分区」下拉按 editorMode 过滤。签字栏=编制/审核/批准签名行+签发日期(右对齐·绑 report_meta.issue_date)+报告/资质备注(6pt·绑接口)+钉底,间距按参考样张实测(5em/3em)
│           │   ├── field-types.ts
│           │   └── MatrixEditor/       # 画布化矩阵编辑器
│           │       ├── index.tsx
│           │       ├── MatrixCanvas.tsx
│           │       ├── InlineEditor.tsx
│           │       ├── HeaderConfigCard.tsx
│           │       ├── FormulaPanels.tsx
│           │       └── ReportResultTableCanvas.tsx  # 报告·检测结果表（含汇总列跨行单格）
│           ├── FormRenderer/index.tsx   # 录入表单渲染（含矩阵 / 公式 / 图片[选图+拍照] / Excel 导入）
│           ├── ImageUploadPanel.tsx     # 独立图片上传面板（选图/拍照→写回 record_data 图片字段，详情页 Modal + 移动页共用）
│           ├── OrderSearchBar.tsx       # 委托单高级搜索（关键字 + 状态/接收日期/主检/审核，纯前端 filterOrders）
│           ├── SymbolPicker.tsx         # 全局「单位/符号」选择器（右下角浮动 fx；插入到最近聚焦的文本输入框光标处；App.tsx 根级挂载，全站可用）。**完全受控**：只由 fx 按钮/Esc 开关、点输入框/外部不收起（固定）；按钮与面板 `onMouseDown preventDefault` 保住目标输入框焦点（不抢焦点→不误触发 tags 备注提交、符号插到光标处）
│           ├── ReadonlyRecordViewer.tsx # 原始记录只读查看器（报告端用，按锁定版本渲染，不可编辑）
│           ├── TypstViewer/             # 左编辑右预览，5+ 处复用。预览区右上角内置「⬇ 下载 PDF」（用 compile 的 blob URL + `downloadName` prop），所有用它的地方都能随时下载渲染后的 PDF（原始记录/记录详情/各模板/报告）。⚠️ `mode="view"` 外层容器吃 `height` prop——传 `height="100%"` 时父级必须有定高（flex 链 `flex:1/minHeight:0`），否则 PdfPreview 百分比高度解析失败、预览塌缩成 0（表现为"打开却不渲染、不能滚动"）；其余调用方传 `calc(100vh - …)` 定高。`PdfPreview` 重编译用双缓冲 + `keepScroll` 保滚动位置，`enableSync` 时编译后查 `<__fepos__>` 标记供 `scrollToMarker` 正向跳转
│           ├── PdfDownloadButton.tsx    # 列表行「下载 PDF」按钮（loading+错误提示）。配 `utils/pdfDownload.ts`（下载原始记录模板[mock]/填好的录入记录[锁定版本]/报告模板[mock]/生成报告[GET /reports/:id/pdf]）——原始记录模板列表/报告模板列表/订单详情记录行/已生成报告列表各行操作栏都有
│           ├── FormulaEditor/           # 12 个预设公式 UI
│           ├── FieldMappingEditor/      # 旧版映射 UI（v1 兼容）
│           └── ReportEditor/            # 报告 v2 block 编辑器（保留兼容，新功能加在 v3）
│
├── server/                    # Express + TypeScript  (:3001)
│   └── src/
│       ├── index.ts                    # 路由注册 + 启动 seed
│       ├── db.ts                       # 共享数据库连接池（单一事实来源）：全进程一个 Pool，所有路由 import { pool }。池大小 DB_POOL_MAX（默认 20）。⚠️ 长生命周期单例，请求里不要 pool.end()
│       ├── logger.ts                   # 极简结构化日志（零依赖）：log.info/warn/error → 单行「时间戳 级别 msg k=v…」，便于 journalctl/grep。现有 console.* 可逐步迁移
│       ├── middleware.ts               # 通用中间件：requestLogger(请求日志,健康检查除外) + apiNotFound(未匹配 /api → JSON 404 `{ok:false,error,path}`) + errorHandler(兜底捕获未处理异常,含 Express5 async reject,记日志+**统一 JSON `{ok:false,error}`**；请求体 JSON 解析失败→400「请求体 JSON 解析失败」、其余→500「Internal Server Error」不泄露内部细节)。挂载顺序见 index.ts
│       ├── routes/
│       │   ├── record-templates.ts     # 原始记录模板 CRUD + 版本流（draft/submit/review/fork）
│       │   ├── record-data.ts          # 录入数据 + 审核流（review approve/reject）+ 审核日志
│       │   ├── report-templates.ts     # 报告模板（同样支持版本流）
│       │   ├── reports.ts              # 报告生成（按单号）+ PDF / DOCX 导出
│       │   ├── work-orders.ts          # 委托单（GET 列表 / 详情 / PUT link 关联模板）
│       │   ├── audit-log.ts            # 审核事件流（按 order_no / record_id 查）
│       │   ├── rework.ts               # 退回/返工工单（场景1）+ 全订单时间线（rework+录入审计+报告审计合并）
│       │   ├── external.ts             # 外部推送接收：/orders（1.1委托单）/ /reports（1.2报告取号）/ /report-modify（1.3改号+退回 data_entry/report_edit）/ /requisitions(·/generate·-counts) 取号驱动生成 / /report-feedback（外部回执）
│       │   ├── auth.ts                  # 登录(5.1 接缝→本地建档)+ RBAC：/login /me /meta /users + 角色申请 /role-requests(提交/我的/撤回/列表/审核)；requirePermission(perm) 中间件（按 X-User-Job 查 users→角色→权限）
│       │   ├── excel-import.ts         # Excel 导入填充矩阵 + record_data attachments
│       │   ├── images.ts               # 图片上传 + 服务
│       │   ├── equipment.ts            # 设备库（含 Excel upsert import）
│       │   ├── typst.ts                # Typst 编译 API（playground 用）
│       │   ├── mappings.ts             # v1 字段映射（保留）
│       │   └── proposals.ts            # 临时字段提议（占位，未启用）
│       └── services/
│           ├── typst-compiler.ts       # spawn typst CLI + 三级缓存(进程内 LRU → 磁盘缓存 → 编译) + 并发闸门。磁盘缓存按 source sha256 落盘(TYPST_CACHE_DIR,默认 <tmpdir>/cdr-typst-pdf-cache)→ 报告 PDF「每次查看都重编」改为编译一次后读盘,重启/跨进程仍命中,源码变即自动失效。并发闸门:信号量限制同时在跑的 typst 进程数(TYPST_MAX_CONCURRENCY,默认 4),防高并发 fork 打爆机器
│           ├── seed-base-templates.ts  # 启动 seed 基础原始记录模板（shared/base-templates.ts seed=true 条目）
│           ├── seed-report-templates.ts # 启动 seed 报告模板（首页+3 项目，shared/report-base-templates.ts）；
│           │                            # 须在 seedBaseTemplates 之后跑（project 按原始记录 name 反查关联 id）
│           ├── external-orders.ts      # 外部订单接口 1.1（解析器+接缝）：parseOrderInfos 全字段解析 + fetchExternalOrders 拉取占位 + EXAMPLE_PUSH_ORDER，详见 待实现内容.md 第1节
│           ├── external-report-meta.ts # 报告页眉页脚元数据接口（mock 接缝）：fetchReportMeta(order_no)→检验码/报告编号/公司信息（接口1.2就绪后由每报告 meta 取代）
│           ├── external-report-info.ts # 接口1.2解析+匹配引擎：parseReportInfos / buildReportMetaFromReq / matchRequisitionScope（按样品名+项目名回查 record_data/关联报告模板）
│           ├── external-report-delivery.ts # 接口1.4出站 SOAP 客户端：submitReportToDiGui(sysNumber, pdfBase64, jobNo) 按业务系统 WSDL 方法 PushReportFile(sysNumber, file, jobNo) 构 SOAP 1.1/1.2 信封回传报告 PDF（方法名/三个参数名/namespace/action/endpoint 全可配 config/report-delivery.json 或 DELIVERY_*，空 endpoint=mock=不真发）。⚠️ 少 jobNo(委托单业务员工号) 对方拒收；规范文档写的 AcceptReportFromDiGui 在真实 WSDL 不存在，实为 PushReportFile
│           ├── external-report-feedback.ts # 外部报告回执解析（P-Flow-2 场景3）：parseReportFeedback → approved/needs_revision
│           ├── external-auth.ts        # 接口5.1 登录接缝+解析：loginViaCommonLogin(配 common_login_url 走真实 GET {url}/commonLogin/login，前缀靠字符串拼接保留，pwd 经 encodePwd SHA-1 大写加密后发，超时/404/网络错误处理，否则 mock) + parseLoginResponse + encodePwd + isMockLogin()。认证系统只给身份不给角色。详见根目录《外部OA登录对接.md》
│           ├── rework-ops.ts           # 退回/返工写原语（事务内）：rejectRecordForRework / returnReportForEdit / returnReportToDataEntry / markReportApproved。rework.ts(场景1) + external.ts(1.3 / report-feedback) 共用，单一事实来源
│           ├── seed-work-orders.ts     # 启动同步：调 external-orders 把单 upsert 到 work_orders
│           ├── seed-mock-by-sample.ts  # 演示用：把"整单出一份"的 MOCK-EXT-001 复制成"按样品出"的 MOCK-EXT-002（委托单/原始记录/样品完全一样，但每个样品一份取号报告 status=pending，可单独生成/编辑/送审）。幂等：DST 已存在/源单缺失则跳过
│           └── template-versions.ts    # 模板版本流通用 helper
│                                       # （record / report 共用：listVersions / createDraft /
│                                       #  submitForReview / withdrawVersion / reviewVersion /
│                                       #  forkTemplate / getLineage / syncToChildren /
│                                       #  logTemplateAudit / listAuditLog / readActor）
│
├── shared/                    # 前后端共用（改这里影响双方）
│   ├── types.ts               # 所有核心类型 — 单一事实来源
│   │                          # FieldDefinition / DataMatrixConfig / CellBinding /
│   │                          # ReportTemplate / EquipmentRecord / FieldSemanticRole 等
│   ├── typst-generator.ts     # 原始记录 + 报告 → Typst 源码生成
│   │                          # generateTypst / generateTypstWithData /
│   │                          # injectReportFieldsIntoTypst / resolveBinding /
│   │                          # flattenDataForDisplay / 4 个 report_* 渲染函数
│   ├── matrix-flatten.ts      # 矩阵展平 + 单元格/列/汇总公式应用
│   ├── formula-engine.ts      # 12 公式 + 拓扑排序 + 循环检测
│   ├── expr-eval.ts           # 自定义算术表达式沙箱（仅四则 + 比较，无 eval）
│   ├── group-tree.ts          # 嵌套分区分桶（parent_group_id → 顶级+子分区树，三端共用）
│   ├── template-diff.ts       # 模板字段定义 diff（按 group.id / field.id 配对 + 属性级明细；
│   │                          # 审核预览与 diff_from_prev 定版都用它，前后端共用）
│   ├── report-blocks.ts       # 报告 v2 block 渲染器（保留兼容）
│   ├── binding-integrity.ts   # 报告映射引用完整性校验（报告 binding vs 关联原始记录字段集）
│   ├── rbac.ts                # 本地角色权限单一事实来源（前后端共用）：Role/Permission + 角色→权限矩阵 ROLE_PERMISSIONS + permissionsForRoles + AppUser
│   ├── mock-data.ts           # 模板编辑器预览用 mock 生成（generateMockData=展平显示数据；generateMockRawData=嵌套原始 raw_data，可单独取用）
│   ├── base-templates.ts      # 启动 seed 原始记录模板的【入口】：读 seed-record-templates.data.ts 快照（按 name）；
│   │                          # 客户端「新建模板」也用（目前仅 'blank' 入口；DB 模板作骨架走 clone_id）
│   ├── report-base-templates.ts # 启动 seed 报告模板的【入口】：读 seed-report-templates.data.ts 快照；
│   │                          # project 经 linked_record_name 关联回原始记录模板
│   ├── seed-record-templates.data.ts  # ⚠️自动生成：原始记录真身快照（基础+密度+透光率+弯曲，verbatim 完整配置）
│   └── seed-report-templates.data.ts  # ⚠️自动生成：报告真身快照（首页 cover + 3 项目 project）
│                              # 二者由 scripts/dump-seed-templates.ts 从运行系统 DB 导出，勿手改；改模板→重跑导出
│
├── db/
│   ├── migrate.ts             # migration runner
│   └── migrations/
│       └── 000_baseline.sql ... 022_template_audit_and_sync.sql
│                              # 见第八节完整列表
│
├── config/                    # API Key / Model / DB / Typst
│   ├── *.json                 # 提交版本库（公开配置）
│   ├── header-footer.json     # 报告页眉页脚【默认】版式(settings)+取号前示例数据(sample_meta)+应用范围(apply_to)。随代码部署→新服务器也有正确页眉页脚默认(含分割线 header_rule 开关)。改它=改所有报告默认；报告模板自配仍优先
│   └── *.local.json           # 不提交（密钥），覆盖前者
│
├── deploy/                    # 部署用产物（非应用代码）
│   └── nginx/cdr-demo.conf    # 前后端解耦部署示例（Nginx 托管 client/dist + 反代 /api，可选，详见 部署说明-Ubuntu.md §四点五）
│
├── mock-external/             # 模拟「递归智能」外部系统推送（联调/演示用，不改服务端）
│   └── push.ts                # 推委托单(1.1，固定结构 样品A=密度+弯曲/样品B=透光率)+预关联原始记录模板+完成取号(1.2，--mode=whole|per-sample|per-sample-project)；**不灌数据**(由你手动录入)；见 mock-external/README.md
├── samples/                   # 原始 / 转换后 Excel + 手写 typst 测试
├── scripts/
│   ├── convert-xls.sh
│   ├── install-ubuntu.sh         # 首次部署（一次性）：装环境+建库+构建+systemd。⚠️ 别反复跑：每次会覆盖 config/database.local.json 并重置库密码
│   ├── run.sh                    # 日常运维（轻量）：start/stop/restart/status/logs/serve/build/update。不动数据库数据/配置/字体。改代码后 `bash scripts/run.sh update`
│   ├── install-typst-packages.sh
│   ├── dump-seed-templates.ts     # 把运行系统里 8 个默认模板真身导出成 shared/seed-*.data.ts 快照（改默认模板后重跑）
│   ├── audit-report-mappings.ts   # 报告映射体检：核对每个报告模板 binding vs 关联原始记录的真实 code/参数/汇总行/试样数，列出绑空/绑错类型
│   ├── seed-base-template.ts
│   ├── seed-report-templates.ts # ⚠️已废弃（停留在 017 前、会报错）：报告模板默认 seed 改由启动自动完成（services/seed-report-templates.ts）
│   ├── remap-cover-bindings.ts  # 非破坏性：把现网已有首页模板当前版本的字段绑定改为接口源（按 code 重绑，不删数据）
│   ├── add-cover-spacers.ts     # 非破坏性：给现有首页模板注入可编辑 spacer（空行）（已被 fix-cover-layout 取代）
│   ├── fix-cover-layout.ts      # 非破坏性：修正首页模板版式——空行放对位置（单位地址/供应商/检测周期/要求/结果 之后各 1em）+ 签发日期改真右对齐（align:right，去掉 margin.left 硬撑）
│   ├── clear-cover-field-styles.ts # 非破坏性：清空首页模板所有字段级样式（残留 space_before 等致行距不均）→ 行距统一、空白只由 spacer 产生；仅保留 签发日期 align:right
│   └── fix-signature-spacing.ts # 非破坏性：按参考样张「3.1 报告首页」实测间距，签字栏加空行（编制↔签发 5em、签发↔备注 3em）+ 报告备注/资质备注设 6pt + 签发日期右对齐
└── typst-packages/local/
    └── record-theme/0.1.0/    # 公司级排版主题（思源宋体 / 页眉页脚 / 表线）
```

---

## 四、已实现 vs 留给接口的占位

### 4.1 已经端到端跑通的能力

| 能力 | 关键文件 | 已实测 |
|---|---|---|
| 模板编辑器（左编辑右 PDF 预览） | `FieldEditor/` + `TypstViewer/` | ✅ 7 种字段类型 + 矩阵 + 报告专属字段 |
| 模板版本管理（draft / pending / approved / rejected / superseded） | `services/template-versions.ts` | ✅ 全流程含退回 + 重提 + diff |
| 母子模板（fork + lineage 树） | `services/template-versions.ts` 中 `forkTemplate` / `getLineage` | ✅ 递归 CTE，节点可点击跳转 |
| 实验员录入（结构化字段 + 实时公式 + Excel 导入 + 图片上传） | `FormRenderer/` + `routes/record-data.ts` | ✅ |
| 主检 / 审核签字字段（semantic_role 自动填充，只读） | `FormRenderer/` + `shared/typst-generator.ts` | ✅ 启动 seed 的原始记录模板均含溯源信息分区 |
| 录入数据审核（approve / reject + 备注 + 版本快照） | `routes/record-data.ts` | ✅ 完整状态机 + 防自审 |
| 委托单 → 样品 → 测试项目嵌套结构 + 关联模板 | `routes/work-orders.ts` | ✅ payload JSONB |
| 报告生成（按单号自动汇集 + 字段映射 + 设备表 + 图片表 + 结论汇总） | `routes/reports.ts` + `shared/typst-generator.ts` | ✅ |
| 报告中绑定主检 / 审核 / 检测日期 | CellBinding `record_meta` source | ✅ |
| PDF / DOCX 导出 | `routes/reports.ts` 中 `convertPdfToDocx`（LibreOffice headless） | ✅ |
| 完整审核日志（提交 / 更新 / 通过 / 退回 4 类事件 + 数据快照 + diff） | `routes/audit-log.ts` + `record_audit_log` 表 | ✅ |
| 原始记录**历史版本查看**（含旧版/退回前）：录入详情页每条记录「历史版本」抽屉 → 逐版按快照渲染 | `Lab/OrderDetail.tsx`（`GET /audit-log?record_id=`）+ `ReadonlyRecordViewer` 的 `snapshotData` 快照模式 | ✅ |
| 设备库（5995 行 Excel 一键 upsert + 自动汇集到报告） | `routes/equipment.ts` | ✅ 报告设备表列＝名称/型号/编号/**溯源日期/到期日期**（后两列从设备库 `trace_date`/`expire_date` 直接取，`reports.ts` 建 `equipment_rows`）。原合并的「校准有效期」(`calibration`)**已移除**；渲染端会过滤掉存量模板里残留的 `calibration` 列（不出空列）。**原始记录内联「测试设备」(`device_ref`) 字段显示「设备名称：管理编号」，多台设备各占一行**（2026-07）：录入端只存管理编号数组，展平期（`shared/typst-generator.ts` 的 `flattenDataForDisplay`）按 `opts.deviceMap`〔管理编号→名称〕拼「名称：编号」、`\n` 连接（主题 `multiline()` 渲成 `linebreak`）；`deviceMap` 由 `client/src/utils/deviceMap.ts`（`useDeviceMap`/`fetchDeviceMap`/`collectDeviceCodes`，走 `GET /api/equipment/lookup`）在录入预览(`Lab/Record`)、试录(`RecordTemplate/Editor`)、只读查看(`ReadonlyRecordViewer`)、下载(`utils/pdfDownload`)四处提供；mock 预览(`shared/mock-data`)的 device_ref 直接返回带 name 的对象、无需查库；查不到名称退回只显编号 |
| 模板编辑器示例数据预览 | `shared/mock-data.ts` | ✅ |

### 4.2 留给"真实接口"的占位（按重要性排序）

| 占位 | 现在的实现 | 真实接入要改什么 | 影响范围 |
|---|---|---|---|
| **委托单数据源（接口 1.1 PushOrderInfos）** | **接收端点已实现**：`POST /api/external/orders`（`routes/external.ts`）收外部推送 → `services/external-orders.ts` `parseOrderInfos`（全字段：订单 meta + 样品 BarCode 作 id + 材料分单全字段）→ upsert `work_orders`。`fetchExternalOrders()` 拉取接缝仍返回空数组（占位）。演示期可 POST `EXAMPLE_PUSH_ORDER` 或界面「新建订单」 | 外部按 1.1 契约 POST 到 `/api/external/orders` 即可（推送模型，无需改我方）；若为拉取模型则换 `fetchExternalOrders()` 函数体 | **零前端改动**。字段映射详见 `待实现内容.md` 第 1 节 |
| **报告页眉页脚元数据** | `services/external-report-meta.ts` 的 `fetchReportMeta(order_no)` 返回 mock 检验码/报告编号/公司信息/**客户名称·地址(customer_name/customer_address)**；`buildReportTypst` 注入首页主题并快照进 `content_doc`，主题已渲染页眉页脚 | 只替换 `fetchReportMeta()` 函数体为真实 HTTP（请求 order_no → ReportMeta） | 渲染/快照/编辑链路全部不动；详见 `待实现内容.md` 第 6 节。⚠️ **两处 report_meta mock 必须列同一组键**：首页编辑器预览用 `CoverEditor.tsx` 的 `MOCK_CTX.report_meta`，出报告用 `fetchReportMeta`——若某键只在预览 mock 里有（曾经的 `customer_name`/`customer_address`），会"首页绑定→预览有值→出报告为 —"。加/改 report_meta 键时**两处同步**（`REPORT_META_KEYS`/`BindingPickerModal` 也要有该键才能绑）。⚠️ **接口取号(report_meta)按【字段】回退 config**：`buildReportTypst` 以 `fetchReportMeta`(config `header-footer.json`) 为底，接口 1.2 推送的**非空**字段逐个覆盖——机构常量（公司名称/地址/电话/资质/报告备注）接口没推就回退配置默认，接口推的真实报告号/校验码/客户名覆盖之。**不是** `report_meta || mock`（那样接口给个缺字段的对象就整体丢默认，导致"单位名称/地址已配映射但出报告拉不到"） |
| **身份系统 (SSO)** | `client/src/auth.tsx` 4 个 mock 用户 + axios 拦截器加 `X-Demo-User` 头 | 1) `auth.tsx` 改为从 SSO 拿 token + userInfo<br>2) 拦截器换 `Authorization: Bearer`<br>3) 后端 `services/template-versions.ts` 中 `readActor()` 替换为 session/JWT 解析 | 共 3 处。所有路由的身份读取已统一走 `readActor()` |
| **化学部审批系统对接** | 报告生成 PDF + DOCX 后**只入库不外发** | 加个 `routes/external-approval.ts` 调对方接口 + 接收回调更新状态 | 新增独立模块，不动现有 |
| **客户报告查询门户** | 不在范围 | — | 完全独立 |
| **仪器自动采集** | 实验员手动录入或 Excel 导入 | 加适配层把仪器输出映射到 record_data | 不动主链路 |
| **测试项目名 → 模板自动匹配** | 工程师在 /lab 手动「搜索关联」 | 维护项目名词典 + 启动时预填 `linked_template_id` | 一次性脚本，可选 |
| **临时字段提议审核流** | `routes/proposals.ts` + `ad_hoc_field_proposals` 表已建但未接 UI | 录入页加"提议新字段"按钮 + 模板编辑器加"待审"角标 | 已有 API 骨架 |

### 4.3 演示阶段硬编码（剩余 TODO）

| 项 | 位置 | 说明 |
|---|---|---|
| ~~mock 委托单数据~~（已移除） | `services/external-orders.ts` 现返回 `[]` | 伪造单已删除；演示期用界面「新建订单」手动建单。清旧 mock 数据：`pnpm tsx scripts/reset-orders.ts` |
| `t.name.startsWith('基础')` 兜底 | `Lab/TaskList.tsx` 关联 Modal | 仅用于过滤掉 seed 的"基础原始记录模板（代码兜底）"，避免被误关联 |
| same-template 单条录入约束 | `record-data.ts` POST upsert | 同 `(template_id, order_no, sample, test)` 全局只一条 |


---

## 五、改 X 去哪儿改：速查表

按你想改什么找。**改任何 `shared/` 里的类型时同步前后端会一起跑通**。

### 模板字段相关

| 想做的事 | 主要文件 | 配套要看 |
|---|---|---|
| 新增一种原始记录字段类型（如 `signature`） | `shared/types.ts` 的 `FieldType` 联合 → `client/components/FieldEditor/field-types.ts` 注册类别 → `FieldPropsPanel.tsx` 加属性面板 → `FormRenderer/index.tsx` 加录入渲染 → `shared/typst-generator.ts` 加 Typst 渲染 | `shared/mock-data.ts` 加预览 mock 值 |
| 新增一种报告专属字段类型（按编辑器可见） | `shared/types.ts` 加 `report_*` 类型 → `field-types.ts` 给该类别配 **`editors: EditorMode[]` 白名单**（「什么编辑器显示什么字段」：矩阵/设备仅 `record`、结论汇总仅 `report-cover`、结果表/设备表/图片表仅 `report-project`；缺省 = 三处都显示）→ `categoriesForEditor(editorMode)` 统一过滤（`FieldEditor/index.tsx` 添加字段下拉 + `FieldPropsPanel` 类别下拉同口径）→ `FieldPropsPanel.tsx` 加 report 配置面板 → `shared/typst-generator.ts` 中 `injectReportFieldsIntoTypst()` 加渲染分支 | `server/routes/reports.ts` 看 `buildReportTypst()`；**分区预设同样按 `SectionPreset.editors` 白名单分流**（`section-presets.ts`，旧 `mode:'record'\|'report'` 已废，曾因 `'report'===‘report-cover’` 不相等导致签字栏预设在首页消失） |
| 加 / 改**嵌套分区（子分区）** | `shared/types.ts` 的 `FieldGroup.parent_group_id`（限一层；存储平铺，顺序=顶级按数组序、同父子分区按数组序，归属与数组位置无关）→ `shared/group-tree.ts` `buildGroupTree`（三端唯一分桶实现）→ `FieldEditor/index.tsx`（树渲染+同层↑↓+**转顶级**，子分区禁拖拽）→ `FormRenderer`（inner Card 嵌套）→ `typst-generator.ts` 主循环（子分区嵌父 `#section` 体内，子标题=生成器直发 `#text(weight:700,size:1.05em)`，不动主题包） | ⚠️ **子分区「创建」入口已按需求移除**（2026-07：删了「子分区」新建按钮 + 「移入分区…」下拉；`addSubgroup`/`topGroupOptions` 已删）——**仅保留存量子分区的渲染与「转顶级分区」展平入口**（`onSetParent(undefined)`），不再能新建/移入。**分区「排版」选择器（竖排/多列/表格）也一并移除**：`FieldEditor` 不再提供 layout 切换（`LAYOUTS`/`displayLayout`/`TableHeaderConfig` 已删），纯字段分区一律竖排；存量 `layout='grid'/'table'` 分区仍按存储值正常渲染（渲染路径保留）。⚠️ 三个隐形联动仍在：`dedupeTemplateIdentity`（matrix-flatten）分区 id 防撞改名时同步改子分区 parent 引用；母子同步 `computeSyncedFieldDefinitions` 追加新分组时把 parent_group_id 按分组映射翻译；删父分区连删其子分区（FieldEditor.removeGroup）。悬空 parent 引用按顶级渲染（防御） |
| 改矩阵编辑器（行 / 列 / 公式 UI） | `client/components/FieldEditor/MatrixEditor/` 五个文件 | `shared/types.ts` 中 `DataMatrixConfig`。**统一表头模型**：四类表头（参数列/样品行/汇总行/汇总列）同一交互——**双击或右键弹 `HeaderConfigCard`**（标题在卡片内编辑，不再单独的双击内联改标题）；卡片**完全受控**（`HeaderConfigCard` 的 Popover `trigger={[]}` + 无 onOpenChange），只由确定/取消/底部操作/Esc/切换到别的表头关闭，**不随点击外部（如右下角公式/符号选择面板）自动关闭**（卡片内容含标题 + 分组表头(仅参数列) + **备注**(括号显示，可固定如单位、可配「录入时可选」选项如 客户要求/标准要求) + **默认值**(参数列=整列初始值；录入型汇总行) + 插入/删除/公式操作区）。存储：参数列用 `unit/unit_options/unit_allow_custom`、汇总行用 `note/note_options/note_allow_custom/default_value`、汇总列用 `unit/unit_options/unit_allow_custom`、样品行用 `DataMatrixConfig.sample_notes[]`；**汇总列＝录入型**（与汇总行一致：「添加汇总列」下拉=文本/数字/选择框，`MatrixSummaryColDef.source_type=input_text/number/choice`，input_choice 选项在列头配置）——每个样品行一格由实验员填，值存 `DataMatrixValue.sumcol_inputs`（key=`colId__sampleId`），`flattenMatrixValuesToFlatData` 展平为 `code__sumcol__colId__sampleId`（解析 input_choice 的 `{custom}`）供 PDF；存量聚合列 `per_row_aggregate`(avg/sum/max/min) 仍按公式渲染（向后兼容，UI 不再新建）；**统计列(per_row)·数字＝逐格公式**（2026-06-30，回应"统计列数字格无法配公式 / 点格整列都选中"）＝`MatrixSummaryColDef.cell_formulas`（key=样品 id→`Formula`，**与试样格/统计行 cell_formulas 完全同款**，经 `PerCellFormulaPanel` 配置；`applyMatrixSummaryFormulas` 逐格 `execute` 写 `code__sumcol__colId__sid`、`FormRenderer` 该格只读显示算值）——**点一个格只选该格**（修复上一版列级 `sumcol_formula` 致整列高亮）；**汇总列(per_row===false 跨行单值)·数字＝整列公式**＝置 `source_type='formula'`+`MatrixSummaryColDef.formula`（与汇总行 `summary_formula` 同款 `SummaryFormulaPanel`，写 `code__sumcol__colId` 单键）。编辑器 `FormulaTarget` 加 `other_col_cell{colId,sampleIdx}`（统计列逐格）+ `sumcol_span_formula{colId}`（汇总列整列）。**转置布局(试样为列)同样支持，并修了一个既有 bug（2026-06-30）**：旧 `embedDataMatrixColAxisTypst` 把汇总列/行原位摆放且取键【对调】（统计列按 `paramCode`、统计行按 `sid`），而录入端(`FormRenderer` 从不转置)存的是 canonical 键（统计列按 `sid`、统计行按 `paramCode`）——导致**转置布局的汇总/统计单元格读不到值、恒空**。现已**真正转置**：统计行/汇总行→右侧列（按参数，读 `summary__rowId__paramCode` / 跨参数单值 `summary__rowId`）、统计列/汇总列→底部行（按试样，读 `sumcol__colId__sid` / 跨试样单值 `sumcol__colId`），canvas/PDF 与默认布局**同一套 canonical 键**，故录入/公式/绑定/报告全部一致；统计行/列逐格 + 汇总行/列单值公式在两种布局都能点格配置；**工具栏「行/列」＝视觉方向（行=水平条/底部、列=竖列/右侧），与试样轴无关（`addSummaryVisual` 按 `sample_axis` 选内部 summary_row/summary_col 使视觉与命名一致——修了转置时"点统计行却加了列/列名叫汇总行"的错乱）；`addSummaryRow` 默认标签按 per_column 区分统计行/汇总行（原恒为"汇总行"的 bug 已修）；转置画布的配置卡标题也按视觉称行/列**；**`MatrixCanvas` 底部加行＝三类（2026-06 定稿）**：**「+ 样品行」**（`addRow`，仅样品原始数据，算平均值/被报告样品带展开）｜**「+ 其他行」**（`addSummaryRow(input_*, true)` 即 per_column 行：每列一格、和样品格一样手填或点格配公式，但**不算样品、报告样品带不拉它**——内部是 summary_row 故存 summary 键而非样品 cell，band 的 `deriveMatrixSampleIds` 只收样品 cell，天然排除）｜**「+ 汇总行」**（跨列整行一个值 + 「📊每列统计」`addAggregateRow`→per_column_aggregate 平均/求和）。**两个下拉的数据类型项＝纯「文本/数字/选择」**（2026-06-20：去掉括号说明文字），「📊每列统计」在分隔线下保留。逐列手填已从「汇总行」移到「其他行」。跨列数字行点「ƒ 配置公式」→`formula`（整行算一个值，`configureSummaryFormula`）。**逐列手填**＝`MatrixSummaryRowDef.per_column:true` + `input_text/number/choice`，值存 `DataMatrixValue.summary_row_inputs`（key=`${rowId}__${paramCode}`），`flattenMatrixValuesToFlatData`/`flattenDataForDisplay` 都展平到与 per_column_aggregate **同一键** `${code}__summary__${rowId}__${param}`（故出片 `summaryRowsToTypst` 逐列分支、record_summary 绑定都一致；`collectMatrixSummaryDataKeys` 对 per_column 手填行也收每列键）；录入端 `FormRenderer` 逐列各一个输入框（`updateSummaryRowInput`）。**其他行的格子＝和样品格一样（蓝色"录入"行）**：`MatrixSummaryRowDef.cell_formulas`（key=参数列 code → **`Formula`，与样品格 `config.cell_formulas` 完全同款**，经样品格那个 `PerCellFormulaPanel` 配置、数据源可选任意单元格/字段；2026-06-20 起由原"引用本行其他列的算术表达式/`evalArithmetic`"升级为 Formula），`applyMatrixSummaryFormulas` 对 per_column 行 `execute(Formula)` 逐格算（写同一 `matrixSummaryColumnFlatKey`）；设了公式的列录入端只读显示算值。**公式配置直接复用样品格面板（不再另做组件）**：FormulaTarget 的 `other_cell{rowIdx,paramIdx}`，画布点其他行的格 → `onSelectFormulaTarget` → `index.tsx` 复用 **`PerCellFormulaPanel`**（样品格同一个，传 `existing`/`selfCode=null`/`title`，写 `summaries[rowIdx].cell_formulas[param]`）；其他行的格＝**和样品格一样白底**、显示「录入」/`ƒ`（文本型其他行格灰底「文本」），录入端与样品格一致。**符号列引用（解决"录入期样品数变化"，2026-06-20）**：公式数据源里点**列头**＝整列选中，存符号 token `col:{matrixCode}:{paramCode}`（`makeMatrixColumnSource`，列头标「·整列」、该列【样品格】浅蓝底=已选、单独点的样品格实心 ✓）。**`SourceGridPicker` 网格＝样品行 + 非样品行（其他行/每列统计，灰底标「非样品」）**：整列只勾**样品格**，非样品格（`matrixSummaryColumnFlatKey` 键＝`code__summary__rowId__param`）要手动逐格/点行头选，`describeCode` 认这类键，算时由 `expandColumnSources` 用 `deriveMatrixSampleIdsFromFlat` 展开成**当前实际样品**单元格键（去重）→ "整列平均/求和"随录入期增删样品**自动跟随**；点**单个格**＝选某个具体样品（字面键，固定）。`expandColumnSources` 包在 `applyPerCellFormulas`/`applyMatrixSummaryFormulas` 的每个用户公式 `execute` 前（样品格/其他行/汇总行公式/汇总列公式四处），录入+报告+渲染三端共用。⚠️ **custom 自定义表达式（v1/v2…按位置）不发 token**：`SourceGridPicker` 收到 `sourcesOrder`（custom 模式）时列头退回选字面格子（否则一个 token 展开成 N 个会打乱位置变量）；聚合类（avg/sum/max/min）才用符号列。token 只存在 `Formula.sources`（模板字段定义里），绝不写入 flat/raw_data。`flattenDataForDisplay` 对配了公式的列跳过手填值（不覆盖算值）。**本质＝样品行**（同样的格 UI/公式配置），只是不算样品、报告样品带不拉它。⚠️ 旧"汇总行只能跨列、无法逐列一格"＝菜单缺逐列项，已补；**逐列数字格"无法绑定公式"＝原 ƒ 只给整列统计、现加了每格公式**；**默认值已迁出列头卡** → 数据格右键「配置默认值」（`DataMatrixConfig.cell_defaults`，key 与 cell_formulas 同空间 `s{idx}__{paramCode}`，`createEmptyMatrixValue` 优先取格级、回退列级存量 `default_value`；录入期新增行只回退列级）；录入端 `FormRenderer` 的 `UnitCell`/`HeaderNoteCell`，所选值存 `DataMatrixValue.{parameter_unit_overrides, summary_note_overrides, sumcol_unit_overrides, sample_note_overrides}`；PDF 端 `embedDataMatrixTypst`/`summaryRowsToTypst` 同步显示；默认值在 `createEmptyMatrixValue` 应用。**数据表字段属性也有顶层「版式」Tab（2026-06-23，与项目报告结果表一致）**：`FieldPropsPanel` 把 `data_matrix` 也纳入 figure-layout。**2026-07 起（`LABEL_NOTE_TAB_TYPES`）非图片表格（含 data_matrix / 报告结果·设备·样品信息·检测结论表）把表格【标题】拆成独立「标签」Tab、下方【备注】拆成独立「备注」Tab**，故 data_matrix 顶层 Tab＝基础/类型配置/版式/**标签**/**备注**；「基础」只留 类别+必填；版式 Tab（`figureLayoutTab`）此时只剩「对齐与间距」（标题/备注已移出）；**标题显示语义**：数据表 `hide_label` 缺省=显示(`!hide_label`)、报告自动表缺省=隐藏(`===false`)，`titleShown` 据 `field.type` 分流；标题样式/距离、备注距离从「类型配置/基础」移到「版式」(避免重复)；整表文字(table_style)仅报告表(渲染端 matrix 不吃 table_style)。`MatrixEditor` 自身**不再有子 tab**，扁平：数据语义 + 「表格版式」(对齐/留白/**空值符**·新增 `empty_cell_display` UI/跨页同页/重复表头) + 录入权限 + 表头复用/Excel(与报告结果表「表格版式」留在画布侧同口径)。**HeaderConfigCard 改 `closeOnOutsideClick`**（点空白即关，不必点确定；符号选择器是 antd Popover 已在忽略名单、公式面板由 cell 触发不与卡共存，故安全）+ **卡片内 `extra` 直接调列宽(fr,参数列)/行高(cm,试样行)**（行模式；列宽/行高拖拽把手保留）。**列宽/行高拖拽**：画布列头右缘拖（`MatrixParameterDef.width`，fr，60px≈1fr）、左上角格右缘拖试样列宽（`axis_col_width`）、行头下缘拖**最小行高**（`sample_row_heights[]`，cm，渲染为行首格零宽 `#box(height:…)`——行至少这么高、内容多仍自动撑开），全部双击复位；增删行同步 splice heights。**手填数字小数位**：整表统一 `DataMatrixConfig.decimals`（矩阵工具栏，仅数字矩阵），列级 `MatrixParameterDef.decimals` 保留为存量覆盖（优先于表级，UI 已不再提供入口）——显示期格式化（`formatMatrixDecimalsForDisplay`，在全部公式计算**之后**补零/四舍五入，公式输入不受影响）。**左上角表头**：`axis_header` undefined=默认"试样"、`''`=显式留空（双击可清空）。⚠️ **兜底文案三端必须一致**：行名/角头未存值时，画布（`MatrixCanvas.rowLabel`）、录入端（`FormRenderer`）、PDF（`createEmptyMatrixValue`/`embedDataMatrixTypst`）的兜底都是 `${row_header_prefix||'试样'} ${i+1}` 与 `'试样'`——改任何一端兜底要三端同改，否则配置画布与渲染显示不一致（曾经画布显示"1/2/3"、PDF 显示"试样 1"）。**Excel 导入（数据块模式·数据表区统一入口）**：导入按钮在 `FormRenderer` **第一张数据表之前**（`UnifiedExcelImport`，2026-06-22 从表单最顶部下移到数据表区；**不再每表一个按钮**）——**一份 Excel 一次导入、自动按每张数据表配置的 Sheet 搜寻并填充多表**（遍历 `f.matrix.excel_import.enabled` 的表逐个 `/extract` + 纯函数 `fillMatrixFromGrid`，结果合并进一次 `onChange` 并重算 derived）。只导入从 (起始行, 起始列) 开始的矩形数据块，**行名/列头不读 Excel、由模板配置**——配置仅 3 项（Sheet 名 / 第几行 / 哪列起，UI 带"导入示意"网格），服务端 `excel-import.ts` 的 `/extract` 传 `dataStartCol` 走 grid 分支；行列不一致处理在 `fillMatrixFromGrid`——行多：允许增删行→自动补行（行名默认可改）、锁定→截断；行少：只覆盖前 N 行其余保留原值（可自行删行）；列多：允许增删列→自动补列（列头需自行改名）、否则忽略；列少：保留原值；**公式格（列级 cell_formula / 单元格 cell_formulas）跳过导入**；**小数位：导入即按列级 `decimals`（优先）否则表级 `DataMatrixConfig.decimals` 四舍五入并补零、直接成为录入值落库**（`fillMatrixFromGrid`，不再保留 Excel 原样精度——回应"已设小数位但导入仍渲染原样"；公式格/非数值跳过）。**原 Excel 留存可下载**：导入后原文件经 `onExcelImported`→`Record.tsx` 上传到 `record_data.attachments`（已存草稿即时传、未存则暂存 `pendingExcelsRef` 待保存时补传），录入页顶部「已留存 Excel」列下载链接（`GET /api/excel-import/:id/attachments/:fileId`）。旧 `row_label_column`/`column_mapping` 字段已弃用（类型保留兼容存量配置）。**复制/粘贴表头**（表头一样免重建）：矩阵工具栏「复制表头」把整张表结构存 localStorage(`demo_matrixHeaderClipboard`)、「粘贴表头」覆盖到另一张表（`onChange`，重生成参数列 `id`、**保留 code/公式/默认值/汇总行列 id**，不动已录数据；跨字段/跨模板）。**标题与表格同页 + 尽量整表同页**：`embedDataMatrixTypst` 字段标题渲染为 `#block(sticky:true)`（不被分页孤立在页底、与表格首部同页，Typst ≥0.12）；外层 `#block(breakable: !keep_together)`**不设 above/below**——**表格之间的间距由「分区样式·字段间距」统一控制**：分区头「格式」Popover 的「字段间距」写 `FieldGroup.style.block_spacing`，`styleSetRules` 注入 `#set block(spacing:)` 进 `#section[...]` 作用域，级联到分区内所有块（含试验数据表格）；缺省＝Typst 默认块间距。表内另置 `#set block(spacing: 0.55em)` 让**标题紧贴其表格**（不随分区字段间距放大被推远，像题注）。⚠️ 因矩阵走 `embedDataMatrixTypst` 自己的 block、不经字段级 `applyBlockStyle`，所以表的间距**只认分区级 `block_spacing`**（不是逐表调）。`DataMatrixConfig.keep_together`（缺省 true）= 整表尽量不跨页，放不下整体移到下一页（超过一整页的超长表 Typst 仍自动跨页、不丢数据；实测 breakable:false 不裁剪）；设 false = 就近跨页。`DataMatrixConfig.repeat_header_on_break`（缺省 true）→ `table.header(repeat: …)` 控制跨页续页是否重复表头（仅跨页时生效）。两个开关在矩阵工具栏。**表格行与行的疏密**＝`DataMatrixConfig.cell_inset_y`（矩阵工具栏「行内留白」，pt）→ `#table(inset: (y: …))`，缺省＝Typst 默认 5pt。⚠️ **三种"间距"别混**：① 分区「格式·行距」=`#set par(leading)` 段内多行文字行间距（对单行表格无感）② 分区「格式·字段间距」=`#set block(spacing)` 字段/表格**之间**的间距 ③ 矩阵「行内留白」=`inset(y)` 表格**行与行**的疏密 |
| 改自由表格 / 统一网格（`free_grid`，F0） | 编辑器 `client/components/FieldEditor/MatrixEditor/FreeGridCanvas.tsx`（加行列 / Shift 框选合并·拆分 / 标表头·录入格 / 填固定文字）+ `FieldPropsPanel.tsx` 分发 + `field-types.ts` 注册（「自由表格」，`editors:['record']`，**两处 switch** `createFieldForCategory`/`rebuildFieldForCategoryInner`）+ `FormRenderer/index.tsx` 录入分支（录入格填值存 `raw_data[code]` 的 `${rowId}::${colId}`）。渲染 `shared/typst-generator.ts` `renderFreeGridTypst`（纯网格·无强制表头行·`header_cells` 加粗·`spans` 自由合并·`dataOverride` 填录入值）；`generateFieldBlock` 发 `__FREE_GRID__` 锚点 → `generateTypstWithData` 按锚点替换成带录入值版本（与 `data_matrix` 同机制）；`flattenDataForDisplay` 把 free_grid 剔出 `#let data`。数据模型 `shared/types.ts`：`FieldType 'free_grid'` + `free_table.{cells,spans,header_cells,input_cells,cell_bindings}`。**F1（报告侧，已实现）**：`editors` 加 `report-project`；每格 `cell_bindings` 绑原始记录（`renderFreeGridTypst` 加 `ctx` 按 `resolveBinding` 取值，优先级 绑定>录入值>固定文字；`injectReportFieldsIntoTypst` 按 `__FREE_GRID__` 锚点分发；`FreeGridCanvas` 传 `linkedRecord` 时出「绑定原始记录」按钮 + `BindingPickerModal`）。**F2（报告侧样品带，已实现）**：`free_table.sample_band{axis,matrix_code,ref}` + `expandFreeGridBand`（渲染前按记录矩阵实际样品数展开带内行/列，`record_cell_sample`/`record_sample_label`/`record_sample_index` 逐样品落地，镜像 `expandResultTableBand`）；编辑器「样品来源矩阵 + 设为样品带·行/列」。设计见 `编辑器改进方案.md §20.5` / `报告映射方案.md §10.7`。⏳ F3：每格公式(A1 式)；记录侧录入端样品带 |
| 改数据矩阵**多级表头**（参数列分组 / **样品行分组**） | 列：`MatrixParameterDef.group`（相邻同名列合并到上层超级表头）；行：`DataMatrixConfig.sample_groups[]`（按行号索引的平行数组，与 sample_notes 同生命周期——增删行同步 splice）→ `HeaderConfigCard.tsx`「分组表头」输入（右键列头/行头均有）+ `MatrixCanvas.tsx` 行列头 ▭ Tag 标注 → `shared/typst-generator.ts` 中 `embedDataMatrixTypst`（列分组：表头排两行、连续同组 `table.cell(colspan)`；行分组：最左加一列、相邻同组 `table.cell(rowspan)` 竖向合并，表头/汇总行行首补空格；两者可并存） | **纯表头展示**：不改 param.code / 录入网格 / 公式 / 报告绑定 / 版本回放；空 group = 不分组；录入期新增行按未分组（画布/录入端只显示 ▭ Tag，真正合并在 PDF——与列分组同口径） |
| **改报告·检测结果表的「样品带」**（P-Map-10：逐格底座上把某行/列标记为重复区、按实际样品数展开，行/列两朝向） | 渲染：`shared/types.ts` 的 `result_table.band{axis:'row'\|'col', matrix_code, ref_id}`（标哪一行/列是样板带）+ 带内单元格绑定用 `CellBinding` 的 **`record_cell_sample`{matrix_code,param_code}**（当前样品某参数）/ **`record_sample_label`{matrix_code}**（当前样品名）→ `shared/typst-generator.ts` 的 **`expandResultTableBand(cfg, ctx)`**：进入现有静态渲染器**之前**把带子按 `deriveMatrixSampleIds` 得到的实际样品数 N 复制成 N 行/列（带内"当前样品"绑定按各 sid 读 `${matrix}__${sid}__${param}` 落成字面量、带外格子只渲一次），**返回一张普通静态表**——合并格/汇总行列/行高等渲染逻辑完全不动。**画布 UI（P-Map-11c 已落地）**：`ReportResultTableCanvas` 顶部有「试样带」面板（Radio 关/按试样出行/按试样出列；镜像矩阵自动取关联记录首张），设后该行/列在画布里绿色高亮标「样品带·当前样品」；带内格子点击→统一弹窗出「样品带·当前样品」tab（`BandCellPicker`：样品名 record_sample_label / 参数列 record_cell_sample），由 `targetInBand` 判定切到 `BAND_CELL_SOURCES`+`bandMatrixCode`。**`BandCellPicker`（2026-06-20 改为可视化）**：直接渲染原始记录矩阵骨架——点【列头】＝每个样品取该参数列（record_cell_sample）、点最左「试样」列头＝取样品名（record_sample_label），并文案说明"样品在矩阵里是行、报告按行/列展开与原始记录无关"。**统计数据表不出试样带**：`DataMatrixConfig.kind:'sample'|'stats'`（矩阵编辑器顶部「表格用途」开关，缺省 `sample`；存储不变、仅 UI 试样语义+报告是否提供试样带）——`kind==='stats'` 的矩阵不进 `ReportResultTableCanvas` 的试样带矩阵列表（`matrixFields` 过滤掉 stats）、矩阵编辑器隐藏「试样为行/列」轴开关，其数据在绑定弹窗「数据表格」tab **逐格绑 record_cell/record_summary**（按行索引取格，不随试样展开）。回应"统计表被建成试样表克隆 / 试样带抓不到统计数据"。（合并单元格功能已于 2026-06-22 移除——前端不再产生 colspan/rowspan）| `shared/binding-integrity.ts`（record_cell_sample/record_sample_label 校验）；axis='col' 时样品名自动成为列头（newCols.label=样品名，除非该列另配 label_binding） |
| 改报告·检测结果表的画布（每格 binding + 汇总列单格 + 列宽/行高拖拽） | `MatrixEditor/ReportResultTableCanvas.tsx`（数据列头右缘拖把手写 `column.width`(fr)、**汇总列头右缘拖把手写 `summary_cols[].width`(fr)**（2026-06 补：原先汇总列无法调宽、渲染写死 1fr）、**行头下缘拖把手写 `row.height`(cm)**，均双击恢复自动；数据**行表头**双击/点 ✎ 行内改名（`EditOutlined`）；**汇总行表头 / 汇总列表头**（2026-06-20 起）与数据列头一样**双击/右键弹 `HeaderConfigCard`**（标题 · 备注 · 「表头取值绑定」label_binding/note_binding · 删除）——所有表头同款编辑、同样可绑定数据，不再有区别（`summary_rows[]/summary_cols[].{label,note}_binding`，`sumRowCard`/`sumColCard` 状态）。**交互重排（2026-06-20·第二轮，回应"绑定不要在右键卡片、应在表格下方且可选名称/备注"）**：表头交互拆成两件——**左键点表头＝选中→表格下方出现绑定面板**（`Target` 加 `col_h/sumrow_h/sumcol_h`；面板两行「名称」「备注/单位」各可绑/改/清，走统一 `BindingPickerModal` 写 `label_binding`/`note_binding`，二者皆可绑）；**右键表头＝弹卡片只改固定文字/分组/删除**（卡片去掉绑定段，`allowBinding` 不再从结果表传入）。选中表头蓝色描边。**左侧管理列已彻底移除**：编辑器第一个真实列头＝报告表格左上角（与渲染一致）；行操作（行号/上下移/删除/行高拖拽）移到**最右「操作」列**（仅编辑器、不进报告）；汇总行 label 改 col0、body colSpan-1、尾补操作占位，rowspan 自动把操作列推到最右（thead/数据行/汇总行/footer 列数已重算）。**样品带面板**：`Radio.Group buttonStyle="solid"`（选中蓝块）+ 方向箭头「关/按样品出行↓/按样品出列→」+ Tooltip 说明 + 镜像矩阵标签（**去掉"样板行/列"下拉**，固定第一条数据行/列、`expandResultTableBand` 与画布 isBandRow/Col 在 ref_id 失效时回退第一条）。**`record_sample_index`（样品序号 1,2,3…）**：`BandCellPicker` 加「样品序号（自动）」按钮，`expandResultTableBand` 落 `String(i+1)`（解决"试样编号全是1"）。**出列模式结构（2026-06-20 修订）**：按样品出列＝**最左列＝参数名（行标签 r.label，格子留空不绑→渲染时 col0 显示行 label）＋第二列＝样品带（向右展开）**，样品带**列头**绑「样品序号」`record_sample_index`→列表头出 1,2,3… 试样编号；平均值等用汇总列。实现：① `expandResultTableBand` 列分支对带列 `label_binding`/`note_binding` 按当前样品 concretize（原先只 concretize 格子）；② 画布切到「按样品出列」时**带默认落在第二列**（最左列保留作参数名列），不自动改列头绑定（避免覆盖参数列名）；③ 带列列头额外允许绑 `record_sample_index`/`record_sample_label`（见 HEADER_SOURCES 例外）；④ **画布列头现在显示其 `label_binding`（`BindingSummary`）**，不再只显示静态文字——否则绑了「样品序号」仍显示旧参数名、误以为"列头是参数"。出行模式不变（序号在样品带行 col0 格子）。汇总不受影响。⚠️ 切换样品带方向**不会转置已有表**：若表是出行形状（参数当成一【列】、试样编号当成最左列），需按上面结构改成"最左列=参数名(行)、第二列=样品带(列头绑试样编号)"。**平均值不被当样品**：`deriveMatrixSampleIds` 跳过 `__summary__`/`__sumcol__`，样品带只展开真样品行（平均值在原始记录用"汇总行"、报告里用"汇总行"+record_summary 取）。**表头绑定来源收窄**：`HEADER_SOURCES=['literal','record_field','record_header']`（去掉矩阵单元格/汇总行）；**例外**：样品带「列头」(`col_h` 且 `isBandCol`) 额外允许 `record_sample_index`/`record_sample_label`（出列模式列头放样品序号/样品名）。**`record_sample_index` round-trip 修复**：补进 `BAND_CELL_SOURCES` + 弹窗 initialTab/reset/isVisible（之前漏了→「样品序号」tab 偶发不出现/不回显）。**按列汇总行**：`summary_rows[].per_column`+`cells[]`——「+ 汇总行（按列分别填）」缺省 label「平均值」，渲染首列标签 + 每数据列一格（cells[].binding），画布每格是 `sum_row_cell` 目标（点格→下方单格绑定），`collectReportBindings` 收 cells；用于"各列平均值"（绑矩阵逐列平均 `record_summary` 带 param_code）。原"整行一个值"为「+ 汇总行（整行一个值）」。**第一轮交互修复（同日早）**：① 开卡 handler（onClick+onContextMenu）从内层 div **上移到 `<th>/<td>` 整格**，点击/右键表头**任意处**都能开卡（原先只在不填满单元格的内层 div 上、点边距无效）；② `HeaderConfigCard` 加 `closeOnOutsideClick`——结果表所有卡片**点卡片以外即关**（document mousedown，忽略卡内容 `[data-headercard]` 与嵌套 antd 浮层；数据矩阵编辑器不开此项、保持受控避免公式/符号浮层误关）；③ 列宽/汇总列宽拖拽把手加 `stopPropagation` 防开卡；④ 左上角「行 \ 列」管理栏表头改为窄灰「#」栏，使第一个真实列头成为视觉左上角、与渲染一致（管理栏仅编辑器显示、不进报告）；**合并单元格功能已移除（2026-06-22：前端 Shift 框选始终不可用——删按钮「合并选区/取消合并」+ 说明 + 选区/covered 渲染逻辑；`cells[].colspan/rowspan` 类型与 `shared/typst-generator.ts` 的渲染保留以兼容存量，但前端不再产生 span）**）+ `shared/typst-generator.ts` 中 `colWidthSpec`/`renderReportResultTableTypst`（数据列 + **汇总列**的 width→`#table(columns:…)`，汇总列缺省仍 1fr；**行高＝本行第一个出格单元格内放零宽 `#box(width:0pt,height:…)`**，行至少这么高、内容多仍自动撑开，与数据矩阵 `sample_row_heights` 同口径；**合并：按行列序号算出被盖格集合跳过，主格 emit `table.cell(colspan,rowspan)`，跨度钳制在数据网格内不溢出汇总行/列**） | `shared/types.ts` 中 `result_table.rows[].height?`（cm）/ `cells[]` 的可选 `colspan?/rowspan?`（被盖格不单独存，按序号推算）；`summary_cols`（单 binding 不是字典；新增可选 `width?`）；列宽单位 fr/cm，缺省 1fr |
| 改报告·检测结果表/设备表的**列头备注·分组表头·表格版式**（对齐数据表格显示能力，见编辑器改进方案.md §18） | **列头备注/单位**：静态列 `result_table.columns[].note` → 列头括号显示 `标签（备注）`；**分组表头**：列 `.group`，相邻同组合并成上层超级表头（两行表头），由 `shared/typst-generator.ts` 的 **`groupedHeaderCells()`** 生成（结果表 + 与数据矩阵列分组同口径）。**表格版式**：`result_table` / `equipment_table` 上的 `keep_together`（尽量同页）/`repeat_header_on_break`（跨页重复表头，→`table.header(repeat:)`）/`cell_inset_y`（行内留白）/`cell_align`（左中右）/`empty_cell_display`（空值符，缺省 —），由 **`resultTableLayout()`** 统一解析，两个 `render*Typst`（result `renderReportResultTableTypst`、设备 `renderReportEquipmentTableTypst`）共用 | UI：结果表在 `ReportResultTableCanvas.tsx`——**列头双击/右键弹「列配置」卡（复用原始记录数据表格的 `HeaderConfigCard`，新增 `noteFixedOnly`（报告无录入→备注仅固定文字、隐藏"录入时可选"档）开关），配 标题·备注·单位·分组表头·左右移·删除**；表级的「表格版式」（跨页/行距/对齐/空值）放顶部工具栏。设备表在 `FieldPropsPanel.tsx` 的 equipment 配置「表格版式」Form.Item。⚠️ 报告表是**展示型**（值来自绑定、无录入），故只补展示/版式类能力，不补数据矩阵的录入项（`note_options`/默认值/单元格公式/Excel 导入）。全部字段可选、缺省走旧行为、出片向后兼容 |
| 改矩阵展平 / 公式计算 | `shared/matrix-flatten.ts` + `shared/formula-engine.ts` | `FormRenderer/index.tsx` 中 `computeDerivedMerged`（两侧顺序必须一致） |
| 改字段属性面板 | `FieldPropsPanel.tsx` | binding / category 在这里。**面板按 Tabs 分页**（P14·14.4 对象化重组）：**简单值类型**（text/number/date/choice）顶层四个 Tab（按字段物理构成分区，无迷你预览——右侧 PDF 实时预览已可见）：**基础**=类别下拉 + 必填（+单位/行数）+ 字段说明｜**字段名**=显示开关（`hide_label`）+ 文字 + 样式（`label_style`，`FormatPanel variant="text"`：字体/字号/加粗/斜体/颜色）｜**字段值**=报告模式「来源 手填/抓取」（`ReportValueSource`，手填=binding literal 文本框、抓取=`CellBindingButton`；按 field.id key 化重置 intent）/记录模式「默认值」控件 + 样式（`value_style`）｜**版式**=`field.style` 对齐/段前段后（`FormatPanel variant="layout"`）+「行距/字段间距去分区·文档级」指针。choice 另加「类型配置」Tab。**复杂类型**（矩阵/图片/报告自动表/间隔）保留旧式：字段 Tab 给标签/类别/必填/说明 + 独立「类型配置」「格式（字段级 StyleOverride + 旧 label_bold 三档）」「取值绑定」Tab（`formatAllowed`/`bindingAllowed` 已 `&& !isSimpleValue` 收口，避免与折叠段重复）；**三种报告自动表**（result/equipment/image_gallery，`FIGURE_LAYOUT_TYPES`）：「**基础**」Tab 在标签输入下方有**「显示为标题」开关**(`hide_label`，2026-06 从版式 Tab 移来——标题文字就是标签)；**`image`（如首页「样品图片/样品照片」）2026-06-23 起与报告自动表/数据表同口径**：「显示图片标题」开关在「基础」Tab 标签下方（缺省显示、关掉才隐藏，`hide_label` 缺省 undefined＝显示），「基础」Tab 填**备注**(`caption`)，「版式」Tab 调**标题样式/标题距离(`label_gap`)/备注位置·距离·样式/对齐间距**（`figure-layout` Tab 已纳入 `image`）。⚠️ **图片分区共三层文字（2026-06-24 定稿；2026-06-29 改①）**：① **分区标题**＝分区 `group.label`，**统一由 `renderGroupEntry` 处理**：`!hide_title` → `#section`(顶级)/子分区标题；**`hide_title` → 不显示任何标题**（2026-06-29 修：原先 `generateImageGroupContent` 会在 hide_title 时另补一个左上角 1em 标题，导致"关掉分区标题后仍显示分区名"，已移除——`generateImageGroupContent` 不再出任何分区标题）；② **每张图的表内标题**＝该 image 字段 `field.label`，渲染为 `#table` 表头行（框内、跟随文档字号，`renderImageSlotsTypst` 内出，多图/画廊同口径）；③ **分区底部备注**＝image 字段 `field.caption`，表下方 9pt 小字题注（单图＝分区底部）。三者各自可改：分区标题在 `InstanceEditor` 分区头的输入框（section_role=images 才显示，改 `group.label`+置 `hide_title`）、表内标题在图片块「表内标题」输入框（`field.label`）、备注在「详细编辑」（`field.caption`）。**图片作为分区、每行一个 image 字段**（section_role=images 可放多个 image 字段，各自表内标题+1张或多张照片+样式）；`InstanceEditor` 的「在末尾插入内容」有「图片」项，可往首页图片分区加多行图片。**图片分区里也可混放普通字段**（说明文本/检测周期等非 image 字段）：`generateGroupContent` 把它们按常规 `#field` 渲染在图片块的【前/后】（落在 `__IMAGE_GROUP__` 锚点之外、数据期替换不吞掉；2026-06-29 修，原先 `section_role=images` 分区只渲染 image 字段、其它字段不显示）。曾短暂改成"标题浮在表格上方的独立块（label_gap 调距离）"，但与多图的框内表头不一致、且渲染不像参考样张，已回退；故图片字段在「版式」Tab **不显示**「标题与图距离(label_gap)」「备注位置(caption_position)」（对框内标题无意义，已 `field.type!=='image'` 隐藏），只保留标题样式(`label_style`)/备注距离·样式/对齐(`field.style`)。**首页图片只走占位路径**（`generateTypst`+`injectReportFieldsIntoTypst` 不替换 `__IMAGE_GROUP__`）——故 `generateImageGroupContent` 改为**按真实图位渲染**（空照片＝「（无图片）」框 + 框内标题，照片来自 `field.image_photos`），让首页编辑器所见即所得（原先占位是无标题灰框）。另有「**版式**」Tab＝标题样式(`label_style`)+标题与图表距离(`label_gap`)+题注位置(`caption_position`)+对齐/段前后(`field.style`)，标题关闭时显示指向「基础」的提示，渲染走 `wrapFigure`；matrix/image 的标题样式(`label_style`)在其「类型配置」Tab 的 hide_label 开关旁；类别选择是带图标的**下拉选框**（按 editorMode 过滤报告类别）；**默认值控件按字段类型适配**（数字=InputNumber、日期=DatePicker、单选=从选项选、多选=多选下拉存数组；仅 text/number/date/choice 显示；切换类别清默认值），新建记录时 `Lab/Record.tsx` 的 `buildFieldDefaults` 把默认值填进初始 data；**编码 (code) 由系统自动生成且不暴露 UI**（生成点统一走 `shared/matrix-flatten.ts` 的 `uniqueCode()` 防撞：加字段/分区预设/矩阵加列/录入加列）；选项列表支持**拖拽排序 + 批量粘贴**（一行一个，整体替换）。**semantic_role（自动填充来源）不再手选**——由「溯源信息」分区预设（`section-presets.ts`）固化进主检/检测日期/审核/审核日期字段，面板只读显示。属性/公式编辑用 `FieldEditor/index.tsx` 的 **Drawer 弹窗**（`placement="left"` + `mask={false}`）：从左侧弹出、不遮右侧 PDF 实时预览，面板开着可点其他字段行/大纲直接切换；**宽度可拖拽调整**（`PanelResizeHandle` 贴右缘，默认 640，持久化 `localStorage.fieldPanelWidth`，钳 380–1100）；右下角「保存并返回」关闭（改动经 onChange 即时生效，顶部「保存」才落库） |
| 改编辑器左右分栏宽度（拖拽分隔条） | `client/src/components/EditorSplit.tsx`——三个模板编辑器页共用：左=结构编辑、右=PDF 预览，中间分隔条拖拽调宽（钳 25%–75%，双击复位 45%，持久化 `localStorage.editorSplitPct` 三页共享） | 替代原先各页写死的 45% 分栏 |
| 改模板「试录」预览（编辑时实测录入体验） | `RecordTemplate/Editor.tsx`——工具栏「试录测试」按钮弹出**大 Modal（88vw）**：左=**真实录入组件 `FormRenderer`**（与录入页同一套，公式/加减行/可选单位/必填全部真实生效），右=PDF 按试录数据实时渲染（`generateTypstWithData(template, tryData)`，仅弹窗打开时计算，`destroyOnHidden`）；初始化走 `shared/matrix-flatten.ts` 的 `buildFieldDefaults`（与真实录入同口径，已从 Lab/Record 抽到 shared 共用）；底部「清空重填」 | 试录数据纯本地 state、关闭即弃；图片字段上传会真实传文件（孤儿文件,演示可接受）；仅原始记录编辑器有（报告模板无录入概念） |
| 改未保存改动守卫（编辑器退出询问） | `client/src/hooks/useUnsavedGuard.tsx`（beforeunload + confirmLeave 三选一：保存并离开/不保存离开/留在本页）；三个模板编辑器页（Record/Cover/Project Editor）持 `savedSnapRef` 快照、`handleSave` 返回成功标志、「← 返回」走 confirmLeave | 取舍=询问式而非自动保存：草稿有版本流业务含义，自动保存会写放大；浏览器后退不拦（BrowserRouter 无 useBlocker，已知边界） |
| 改模板编辑器整体交互（大纲 / 拖拽 / 分组卡 / 字段行） | `FieldEditor/index.tsx`（根组件包 `DndProvider`；左侧**大纲导航**可折叠、点击定位/选中，持久化 `localStorage.feOutlineOpen`；分组与字段用 react-dnd **真拖拽重排**（字段可跨分区拖），↑↓ 按钮保留为后备；**点字段行整行即选中并打开属性面板**（选中/拖拽用 field.id 定位，重排后不指错）；分组卡可折叠、统一白底中性配色，操作按钮 hover 浮现） | 视觉类名在 `client/src/index.css` 的 `.fe-*` 段；新增字段 id 由 `genId()` 扫描现有 id 防撞；**存量重复 id/code 在编辑器加载时自愈**（`shared/matrix-flatten.ts` 的 `dedupeTemplateIdentity`，旧 id 生成器每次刷新从 f100 盲数的遗留——重复会导致点 A 字段打开 B 的编辑、PDF 反向跳转找错字段），三个模板编辑器加载即修 + 提示保存固化 |
| 改样式/格式（字体/字号/加粗/斜体/对齐/行距/**字距**，按区块或字段） | `FieldEditor/FormatPanel.tsx`（UI，`variant: text/layout/full`——text=字体/字号/**加粗(三态)**/斜体/颜色、layout=对齐/段前后、full=全部含行距字距+块级；默认 full）。**加粗是三态 Radio：跟随(undefined,继承上层)/加粗(bold)/正常(regular)**——`正常` 必须存在，否则当文档默认就是加粗（如 `label_weight:"bold"`）时，关掉只是"继承"仍加粗、无法取消（曾经 2 态 Switch 的 bug）。`正常` 对字段名走 `#field(label_bold:false)`、对值/区块走 `#set text(weight:"regular")` → `shared/types.ts` 中 `StyleOverride` + `FieldGroup.style`/`FieldDefinition.style` → `shared/typst-generator.ts` 中 `styleSetRules`/`applyBlockStyle`（区块 set 规则级联 / 字段 #field 行内） | 区块头「格式」Popover 写 group.style（区块**内容**）；字段属性面板「版式」段写 field.style；层叠：文档默认→区块→字段。**分区标题独立样式**：`FieldGroup.title_style`（与 `style` 分离，`style` 管内容、`title_style` 管标题）——区块头「格式」Popover 左栏「分区标题」段（`FormatPanel variant="text"`）写它；渲染：顶级分区生成器算 `titleTextArgs()` 传主题 `#section(title_args:…)`，子分区生成器直发 `#text(…)`，缺省＝主题默认标题（加粗，faux-bold 感知）。**分区标题↔内容间距**：`FieldGroup.title_gap`（pt）——区块头「格式」Popover 左栏「标题与内容间距」输入；渲染：主题 `#section(title_gap: …)` 替换原写死的 `#v(0.4em)`（缺省回退 0.4em），子分区走标题块 `below`。⚠️ 这是"分区标题（如检测结果）和其下表格/字段之间的距离"，**与图/表字段自己的 `label_gap`（wrapFigure/matrix 标题↔表）是两件事**：报告表用分区预设时显示的是分区标题，调它的距离用 `title_gap`；打开图/表字段自身标题时调 `label_gap`。**`label_gap`/`caption_gap` 未单独设时＝跟随文档「字段间距」(`line_gap`)**（`typst-generator.ts` 的模块级 `_figureGap`，由 `generateTypst`/`injectReportFieldsIntoTypst` 入口按本模板 `lineGapTypst` 设；`wrapFigure` 的 `labelGap`、`captionTypst` 的 `g` 都以它兜底）——回应"调字段间距时检测结论表/样品图片等紧贴自己的小标题不动、表格像被冻住"；**显式设过 `label_gap` 的仍以显式值为准**（如首页样品信息表预设写死 `12pt`，要它跟随字段间距需在「版式」清空 `label_gap`） |
| 改**字段名 / 字段值各自的文字样式**（P14·14.2，名与值分开配） | `shared/types.ts` 中 `FieldDefinition.label_style`/`value_style`（各一份 `StyleOverride`，仅 font/size/weight/italic/color 生效）→ `shared/typst-generator.ts` 中 `fieldPartTextDict()` 序列化为主题 `#field` 的 `label_args`/`value_args`（splat 进 `text()`）→ 主题 `record-theme/0.1.0/lib.typ` 的 `#field`（缺省空 dict ⇒ 不包，向后兼容）。**two-col/grid 分区**走 `cellFieldInner`/`renderMultiCol`，同样吃 label_style/value_style；**对齐(中/右)会让该字段从网格里"拎出来"成整行独立块 `#align()`、跨整页对齐**（`renderMultiCol`：普通字段流入等宽 1fr 列，中/右对齐字段 break out 成整行；字段级对齐优先、否则继承分区级 `group.style.align`）。`label` 一侧 weight 走 `label_bold` 通道（复用 faux-bold）；`hide_label` 段值套 value_style | `FieldPropsPanel` 的「字段名」「字段值」段（`FormatPanel variant="text"`）。`label_bold` 已 @deprecated（label_style.weight 优先，未设回退它，存量零改）；字段整体版式（对齐/段前后/缩进）仍由 `field.style` 承担；**对齐跨整页**——单列分区 align 直接跨页，多列分区中/右对齐字段 break out 成整行跨页（左对齐＝留在列内） |
| 改封面排版（标题整页居中 / 分区间留白 / 字距拉开） | `StyleOverride.vertical_align`（区块级，页流层 `#v(1fr)`，仅顶级分区）+ `spacer` 字段（间隔块，`#v(高度)`）+ `tracking`（字距）；都在 `typst-generator.ts`（`generateTypst` 的 group 循环 / `generateFieldBlockInner` / `styleSetRules`）+ `FormatPanel`(传 `block`)/`field-types`/`FieldPropsPanel` | 整页居中＝区块头「格式 → 垂直」选「居中」；留白＝插入「间隔（空白）」字段或段前段后间距；spacer 纯版式无数据 |

### 渲染相关

| 想做的事 | 主要文件 | 配套要看 |
|---|---|---|
| 改原始记录 PDF 渲染 | `shared/typst-generator.ts` — `generateTypst()` / `generateTypstWithData()` / `embedDataMatrixTypst()` / `flattenDataForDisplay()` | Typst 主题：`typst-packages/local/record-theme/0.1.0/` |
| 改 PDF 预览 / 编辑器⇄PDF 双向跳转 | 预览=`TypstViewer/PdfPreview.tsx`（pdfjs 画布渲染，**重编译保持滚动位置**，双缓冲换页）；跳转=`typst-generator` 的 `posMarker()`（分区+字段级 `<__fepos__>` 零尺寸 metadata）→ `server/routes/typst.ts` `POST /query`（typst query 取 page+y[pt]）→ `TypstViewer` `scrollToMarker`/`onMarkerClick`（Ctrl/⌘+点击 → 上方最近标记）→ 三个模板编辑器页接线（`onFieldFocus`/`selectRequest`） | 字段级标记覆盖 vertical 布局、矩阵（`generateFieldBlock` 路径）与**图片字段**（`renderImageGroupTypst` 数据期注入），inline/grid 字段回退到分区标记；标记实测零排版影响 |
| 改**分区排版方式**（竖排 / 多列 / 表格）| `FieldEditor/index.tsx`：`LAYOUTS` 收窄为 **竖排(vertical) / 多列(grid) / 表格(table)** 三档（存量 `inline`/`two-col` 渲染路径保留、UI 归一到"多列"显示，`displayLayout()`）。**排版下拉只对"纯字段分区"显示**（`sectionLayoutInfo()`：数据矩阵/图片/签名分区内容已定型→显示"📊 排版自动"灰字，不给选项）。`grid` 配 **列数**（`FieldGroup.grid_columns` 2-4，`generateGrid` 用之，缺省按字段数自适应；**列宽用 `(1fr × N)` 等宽**——整数 `columns: N` 会被 Typst 当 auto 宽度导致各列起点参差，故用 1fr 保证列对齐）。**多列(grid/two-col)布局忽略 spacer**（版式留白是为竖排设计的；多列里 spacer 会把字段流切成单字段块、看似竖排，故跳过它让字段连续流入列）；data_matrix 仍永远独占整行。**分区「格式·字段间距」(`group.style.block_spacing`) 统一驱动三种布局的字段间距**：① 竖排＝把 block_spacing 作为 `gap` 传给主题 `#field(…, gap:)`（覆盖该字段 block 的 above/below；缺省回退文档 `line_gap`）② 多列(grid/two-col)＝grid 的 `row-gutter` ③ 矩阵/图/报告表等独立块＝分区作用域里 `#set block(spacing)` 级联。⚠️ **此前竖排普通字段的 `#field` 写死 `above/below=line_gap`、会覆盖 `#set block(spacing)`，导致"调分区字段间距只有图/表动、普通字段不动"——现已用 `gap` 参数打通**（同一个 `block_spacing` 旋钮，竖排/多列/图表口径统一）。`table` 配 **表头**（`TableHeaderConfig` Popover：`table_header='none'`无表头[缺省] / `'custom'`用 `columns` 两列标题）→ `shared/typst-generator.ts` 的 `generateTable` 直出 `#table`（不再走主题 `result-table` 的写死"项目\|值"表头；表格单元格也吃 label_style/value_style/multiline） | `shared/types.ts` 中 `FieldGroup.grid_columns?`/`table_header?`/`columns?`（全可选，存量零改）。⚠️ `table` 布局缺省从"项目\|值"表头改成**无表头**——种子模板未用该布局，影响仅限手建的 table 分区（去掉的是通用噪声表头，符合预期）|
| 改图片字段布局（宽松 / 紧凑·占比 / **每行张数 / 无缝整表**） | `shared/types.ts`（`image_layout:'loose'\|'compact'` + `image_row_ratio` + **`image_cols`**(多张照片每行张数) + **`image_seamless`**(组级·取第一个 image 字段)）→ `FieldPropsPanel.tsx`（布局 Radio + 占比 + 每行张数 + 整组无缝开关）→ `shared/typst-generator.ts` 的**统一图片渲染** `renderImageSlotsTypst`（把图位按 loose 独占行/compact 占比并排打包成行；`seamless=false`→逐行独立 `#block+#table`；`seamless=true`→**整组一张连续表格**：loose 行 `table.cell(colspan:N)` 占满、compact 行分列，边框共享无空隙、`breakable:true` 可跨页）。⚠️ **标题与图同页（2026-06 修）**：无缝表原先把每个图位的标题与图拆成**两行 table row**，`breakable:true` 的表会在两行之间断页 → 标题留上页、图到下页。现每个图位的**标题+图合成一个 `#block(breakable:false)` 放进同一单元格**（原子不拆），整表仍 `breakable:true` 但跨页只发生在**图位之间**（图位内标题永不与图分离）。`imageFieldToSlot` 把 image 字段转图位，照片按 `cols` 铺成 `#grid`（修了紧凑只显第一张的 bug）；**空标题（label 空或 hide_label）只显示图片、不出标题行** | **一字段=一图位、可多张照片**（`FormRenderer` 数组，含上传/删除/**‹›排序**）。`renderImageGroupTypst`（原始记录组）与 `renderReportImageGalleryTypst`（报告图片表）共用 `renderImageSlotsTypst`。拍摄阶段 `image_phase` 已从 UI 移除（类型保留）|
| 改报告·图片表（项目模板拥有排版 + 绑定原始记录照片） | `shared/types.ts` 的 `image_gallery.{seamless,cols,source_field_codes,items[]}`（items＝手动图位：`{id,source_field_code(绑定原始记录 image 字段),label,hide_label,layout,row_ratio,cols,width_cm,height_cm}`）→ `FieldPropsPanel.tsx` 的 report_image_gallery 配置（**自动/手动模式**：自动＝按 source_field_codes 继承原始记录；手动＝逐图位绑定+排版，「转手动」时从关联记录预填）→ `shared/typst-generator.ts` 的 `renderReportImageGalleryTypst`（手动＝按 items 逐图位从 `record_raw_data[source_field_code]` 取照片+本模板排版；自动＝从关联记录 image 字段继承）。⚠️ **图片独占分区能渲染（2026-06 修）**：`proj_images` 预设把 `report_image_gallery` 放进 `section_role='images'` 分区，而 `generateGroupContent` 原先对 `section_role==='images'` 一律走 `generateImageGroupContent`（只认原始记录 `image` 字段）→ 对 gallery 返回空串 → 空 `#section[]`、整个图片分区不渲染。现该路由加 `&& group.fields.some(f=>f.type==='image')` 判断，gallery 落常规路径出 `__REPORT_IMAGES__` 锚点、由 `injectReportFieldsIntoTypst` 替换为 `renderReportImageGalleryTypst`。**文员实例编辑**：`Report/InstanceEditor.tsx` 的 `ImageGalleryEditor` 可改无缝/每行张数/手动图位（绑定+标题+布局+排序），**并能直接增删/上传/排序本份报告的照片**（`PhotoStrip` 经新增的 `GroupEditor.onMutateCtx` 写 `ctx.record_raw_data` 快照，照片上传走 `/api/images/upload` 返回 `server_path`），全部只落 content_doc、不回写 record_data。**粘连/独立修复 + 项目模板版式控件补全（2026-06-30）**：① 根因＝`wrapFigure` 的 `#set block(spacing:0pt)`（本为隔离标题↔图距离）把图库各行块间距也清零 → **恒粘连、切换独立无效、模板与报告不一致**；现 `renderGalleryGrid`/`renderSharedPhotoGrid`/`renderImageSlotsTypst`(仅报告路径，传了 `seamless` 时) **显式**设块间距（粘连=0pt / 独立=0.8em）覆盖之。② `FieldPropsPanel` 的 report_image_gallery 补齐与报告编辑器同款控件（**标题模式·共用标题 / 尺寸 / 单数独占 / 粘连·独立**），写同一份 `image_gallery` 配置 → 模板设好即带到报告。③ 自动模式渲染也吃 `seamless/solo`（原忽略）。原始记录图片分区路径不传 `seamless`、`renderImageSlotsTypst` 保持 `blocks.join('\\n\\n')` 零回退。**统一第二步（2026-06-30）**：抽出共享组件 **`client/components/FieldEditor/ImageLayoutControls.tsx`**（标题模式/每行/尺寸/单数独占/粘连·独立/跨页表头），**项目模板编辑器(FieldPropsPanel) + 生成报告编辑器(InstanceEditor 的 PhotoLayoutEditor·gallery/photo_table/image_field 三类) 共用同一份控件**→ 两/三处版式 UI 与可调项彻底一致、不再各写一套漂移（漂移正是 seamless 那类 bug 的根源）；title_mode 切换走各自 `onTitleModeChange`（报告侧 `switchMode` 保照片、模板侧直接 `setGal`）。**统一第三步·原始记录图片分区「分区级版式」（2026-06-30）**：新增 **`FieldGroup.image_layout`**（section_role='images' 分区级：title_mode/cols/width_cm/height_cm/solo/seamless/header_follow）。`renderImageGroupTypst` 据其分流——**设了即走分区级**（每个 image 字段=一个图位；`renderImageSlotsTypst` 新增 `cols` 模式＝每行 cols 个图位、`chunkWithSolo` 分行、等分 1fr、吃 seamless/solo；共用标题=用**分区标题**作唯一标题、所有图位照片铺一张网格 `renderSharedPhotoGrid`），**未设＝逐字段旧行为字节级零回退**（`cols`/`seamless` 均 undefined 时 `renderImageSlotsTypst` 仍 `blocks.join('\\n\\n')`、不进 cols 分支）。编辑器：**记录模板编辑器 `FieldEditor/index.tsx` 图片分区标题栏加「图片版式」Popover**（复用 `ImageLayoutControls`，写 `group.image_layout`）；`FieldPropsPanel` 的 image 字段**去掉逐字段「宽松/紧凑」**（`image_layout`/`image_row_ratio` 类型保留兼容存量回退渲染、UI 不再提供），整体版式改分区级。`FormRenderer` 录入端不依赖图片版式（只上传），无需改。无存量迁移（回退保证）。三路径（per/独立·多图、shared/粘连、回退）均 `typst compile` 通过。**第三步·补强（2026-06-30）**：① 分区级版式扩为含 **`shared_title`（表内共用标题）/ `label_style`（表内标题样式·加粗字体字号）/ `label_gap`（标题↔图距离）/ `caption`+`caption_style`+`caption_gap`（整分区一条备注）**——`renderImageGroupTypst` 分区路径据此渲染（共用标题用 `shared_title` 作 `renderSharedPhotoGrid` 表头；每张标题逐图位 `labelStyle`/`labelGap` 用分区级、逐字段备注不再出、分区备注 `captionTypst` 追加在图组下方）。② **图片字段不再单独编辑**：`FieldPropsPanel` 对 `field.type==='image'` 提前返回一句提示（不出任何 tab）；图片名称（每张标题模式作表内标题）在左侧字段行行内改；版式/标题/备注/尺寸全收进**记录模板编辑器图片分区标题栏的「图片版式」Popover**（独立组件 `ImageSectionPanel`＝`ImageLayoutControls`+共用标题+标题样式/距离+备注/样式/距离）。③ **弹出卡片不被屏幕遮住**：图片版式 + 区块格式 Popover 加 `overlayInnerStyle={{maxHeight:'78vh',overflowY:'auto'}}`、添加字段 Dropdown 菜单加 `maxHeight/overflowY`，配合 antd 默认 `autoAdjustOverflow`（向上/向下自适应翻转）→ 太靠下时翻转、过高时内部滚动。**第三步·再理清「四类文字」（2026-07-01，消除"表内标题样式↔分区标题样式"重复困惑）**：图片分区共四类文字，分两个 Popover 无重叠：**「格式(A)」**＝① **大标题**（左侧＝分区 `#section` 标题 `group.label`/`title_style`，不变）+ 右侧对图片分区换成 ② **图表上方标签**（左上角说明 `image_layout.top_label`+`top_label_style`+`top_label_gap`）与 ③ **图表下方备注**（`caption`+`caption_style`+`caption_gap`）——组件 `ImageSectionNotes`；**「图片版式」**＝④ **表内标题**（`title_mode` 共用/每张；共用填 `shared_title`、每张用字段名；`label_style` 表内标题样式）+ 排布（每行/尺寸/独立·粘连/单数独占/共用时跨页表头）——组件 `ImageSectionPanel`（已移除备注/上方标签）。渲染：`renderImageGroupTypst` 用 **hasLayout**（仅看 cols/title_mode/width/height/solo/seamless/shared_title/label_style 等布局键）决定走分区级布局还是回退——**`top_label`/`caption` 与布局解耦**（单设标签/备注不会把回退布局翻成分区级默认），上方标签渲染成 `#block(below:gap)` 左对齐文本置于图组上方、下方备注 `captionTypst` 置于下方。四路径（full-per / full-shared / 仅标签备注·回退布局 / 空回退）均 `typst compile` 通过。**统一第四步·项目模板图片分区完全对齐原始记录（2026-07-01）**：项目报告模板的图片分区**改用与原始记录同一套模型**——`section_role='images'` 分区 + **`image` 字段**（不再用 `report_image_gallery` 单字段；`proj_images` 预设改成建"检测前/中/后"三个 image 字段），分区级「图片版式」「格式(A)·大标题/上方标签/下方备注」全部**复用同一 GroupCard 弹窗**（`ProjectEditor` 用同一 `FieldEditor`，`editorMode='report-project'`）。差异只在**每个图片字段点开＝绑定映射来源**：新增 `FieldDefinition.image_source_code`（绑定一个原始记录 image 字段 code），`FieldPropsPanel` 对 image 字段在 report-project 模式出"绑定图片来源"下拉（选 `linkedRecord` 的 image 字段）、record 模式仍出提示。渲染：`renderImageGroupTypst` 重构为收 **`photosOf(field)`** 取图函数——原始记录＝`f=>record_data[f.code]`（数据期 `generateTypstWithData` 锚点替换），项目报告＝`f=>ctx.record_raw_data[f.image_source_code||f.code]`（报告期 `injectReportFieldsIntoTypst` 新增按 `group.id` 替换 `__IMAGE_GROUP__` 锚点）；布局/四类文字两处 100% 共用。`report_image_gallery` + `renderReportImageGalleryTypst` **保留**（存量/兼容，UI 不再新建）。**greenfield**（种子无 gallery，无迁移）；项目模板预览 `ProjectEditor` 走 `generateMockData(linkedRecord)`→`record_raw_data`，绑定字段即显示样图。端到端（generateTypst→inject→`typst compile`）per/shared/未绑定三路径通过，两个绑定字段各出图+各出表内标题。**统一第五步·去独立框 + 默认统一 + 生成报告 UI 对齐（2026-07-01）**：① **去掉「粘连/独立框」开关**——同一图片分区内图表【恒粘连】（需分隔就另加分区）；`ImageLayoutControls` 删除该 Radio，所有渲染 caller 恒传 `seamless: true`（`renderImageGroupTypst`/`renderReportImageGalleryTypst`/`renderImageFieldUnified`/`renderPhotoTableTypst`），`seamless` 类型字段保留但忽略。⚠️ **2026-07 又按需求恢复了「粘连/独立框」开关**（原始记录模板/报告首页/项目模板 + 生成报告编辑器四处都要能各自选）：`ImageLayoutControls` 重新加回「边框：粘连 / 独立框」Radio（写 `seamless`，缺省粘连）；渲染五处（`renderImageFieldUnified` 读 `f.image_seamless`、图片分区读 `image_layout.seamless`、`renderReportImageGalleryTypst` 手动/自动两处读 `image_gallery.seamless`、`renderPhotoTableTypst` 读 `photo_table.seamless`）改回 `xxx.seamless !== false`（缺省粘连、显式 false=独立框每行独立·块间留白），不再恒传 true。② **默认统一**：每行 2 张 / 图片 7×6 / 每张一个标题 / 单数第一张独占——`images`+`proj_images` 预设写 `group.image_layout={cols:2,title_mode:'per',solo:'first',width_cm:7,height_cm:6}`，`ImageLayoutControls` 与渲染默认 `cols??2`。③ **生成报告编辑器图表 UI 完全对齐模板**：`InstanceEditor` 新增 **`ImageSectionEditor`**（section_role='images' 图片分区）——分区右上角「图片版式」(`ImageSectionPanel`) +「格式」(左=大标题·可隐藏勾选+样式 / 右=`ImageSectionNotes` 上方标签·下方备注) 两个 Popover；body＝逐图位行（每张标题模式左侧出表内标题输入、共用模式不出；右侧缩略图+**+上传/删除**），底部永远「**添加图片**」（空、可上传、加的是 image 字段）。**不显示「来源」**（来源在项目模板里绑，实例侧照片写 `ctx.record_raw_data[image_source_code‖code]`、绑定先带出、文员可直接改）。`GroupEditor` 对图片分区渲染 `ImageSectionEditor` 并跳过逐字段 image 分派；大标题不再强制隐藏(去掉 `hide_title=true`)。**⑤ 图片分区里非图片字段的上下位置与渲染一致（2026-07-01 修）**：`ImageSectionEditor`（整组图位）渲在【第一个 image 字段】的位置（`firstImgIdx`）、其余 image 字段跳过——与渲染端 `generateGroupContent` 的 pre/post 切分（图前的非图片字段在图上方、图后的在图下方）对齐；此前把图片块渲在分区顶部，导致"样品信息排在图前却显示在图下方"的编辑↔渲染错位。**图片分区内加非图片字段**：直接加在分区内即可——非图片字段与图片块各自独立渲染，**不受「图片版式/格式」影响**（那两处只改 image 字段 + group.image_layout）；拖到图片块上方＝渲染在图上方、下方＝图下方。**⑥ 表内标题行高 + 图片左右/上下边距（2026-07-01）**：`ImageLayoutControls` 加 3 个旋钮——**标题行高**(`title_inset_y`，标题格上下内边距 pt，缺省=图上下边距+6)、**图片边距·左右**(`inset_x`)/**上下**(`inset_y`)(单元格 x/y 内边距 pt，缺省 6)。三个渲染函数(`renderImageSlotsTypst`/`renderSharedPhotoGrid`/`renderGalleryGrid`)与 `slotPhotoCell` 改用 `imgCellInset`/`imgTitleInset(insetX/insetY/titleInsetY)` helper 生成 `inset:(x,y)`；四个 caller(`renderImageGroupTypst`/`renderImageFieldUnified`/`renderReportImageGalleryTypst`/`renderPhotoTableTypst`)分别从 `image_layout` / 扁平 `image_inset_*` / `image_gallery` / `photo_table` 传入。类型同增(`FieldGroup.image_layout`、`image_gallery`、`photo_table` 加 `inset_x/inset_y/title_inset_y`；`FieldDefinition` 加 `image_inset_x/image_inset_y/image_title_inset_y`)。自定义值 `typst compile` 通过。**⑦ 统一表格默认行高（2026-07-01）**：新增常量 **`STD_TABLE_INSET_Y = 10`**(pt，单元格上下留白＝行高)。① 图片**表内标题行高**默认改为 `STD_TABLE_INSET_Y`（原 =图上下边距+6=12），与其它报告表格一致；② 报告表格默认行高从 **8→10pt**（`renderFreeTableTypst`/`renderConclusionTableTypst`/`resultTableLayout`〔结果表+设备表共用〕的 `cell_inset_y` 未设时的缺省，x 仍 8pt）——即"稍微大一些"。样品表(6pt)、数据矩阵(Typst 默认)未改。图片单元格左右/上下边距缺省仍 6pt（可用旋钮调）；三项旋钮设了值即覆盖。原样照片(photo_table) 每张模式的「添加行」改「**添加图片**」。上传统一走模块级 `uploadImageFile`。端到端（项目：恒粘连/默认 cols2/三绑定各出图/大标题+上方标签+下方备注）`typst compile` 通过。④ **存量 `report_image_gallery` 报告自动迁移到新 UI（2026-07-01）**：`InstanceEditor` 加载 content_doc 时 `normalizeContentDoc`→`migrateGalleryGroup` 就地把 gallery 图片分区转成 image 字段分区（items→image 字段，`image_source_code`=原 `source_field_code`、label 保留；`group.image_layout`=gallery 配置；gal.caption→下方备注），**照片键不变**（`ctx.record_raw_data[source_field_code]` 继续命中）→ 旧报告在生成报告编辑里也走 `ImageSectionEditor` 新 UI（无来源/添加图片/分区版式弹窗），保存后 content_doc 即为 image 字段模型、渲染走 `__IMAGE_GROUP__` inject 路径。迁移用稳定 code(item.id)不 churn；`report_image_gallery` 渲染仍保留兼容未迁移的旧内容。迁移逻辑抽成共享纯函数 **`client/components/FieldEditor/migrateImageGallery.ts`(`migrateGalleryGroup`/`migrateGalleryGroups`，幂等)**，**生成报告(InstanceEditor content_doc) 与 项目/首页模板(`useReportTemplateEditor` 加载 field_definitions，含历史版本视图) 都在加载处调用**——旧项目模板一打开即迁成 image 字段分区（FieldEditor 出「图片版式/格式」弹窗 + 每字段绑定卡），baseline 用迁移后版本避免误判"未保存"；对无 gallery 的分区（如首页 report_photo_table）是 no-op。 | 与"结果表绑定/检测结论声明"同一心智：项目模板定结构+绑定、原始记录供数据。**图位绑定失效已纳入 `binding-integrity`**：`RecordFieldIndex.imageCodes` + `validateReportBindings` 遍历 report_image_gallery 的 items（手动：source_field_code 须是关联记录 image 字段、未绑定也报）/ source_field_codes（自动），失效随 `binding_warnings` 在 ProjectEditor 标红 + 服务端 PUT/review 兜底 |
| 图/表的**标签显隐 + 标签样式 + 版式 + 备注信息** | **标签显隐**：所有图/表（data_matrix / image / report_result_table / report_equipment_table / report_image_gallery）均有 `hide_label` 开关（matrix/image 在「类型配置」，三种报告自动表 `FieldPropsPanel.FIGURE_LAYOUT_TYPES` 的「显示为标题」开关在「**基础**」Tab 标签下方，2026-06 从版式 Tab 移来）。**标签样式**：`label_style`（字体/字号/加粗/斜体/颜色）现对**全部图/表标题**生效——`typst-generator` 的 matrix 标题 / `looseImageBlock`+`compactRowBlock` 图名 / `wrapFigure` 表题都改用 `titleTextArgs(field.label_style, '1em')`（缺省加粗，存量零变）。**版式（仅报告自动表）**：`field.style`（对齐 + 段前/段后间距）+ `caption_position`（`'above'\|'below'`）经 `shared/typst-generator.ts` 的 **`wrapFigure(field, body)`** 统一包装（标题 → 题注按位置 → `applyBlockStyle` 套对齐/间距），三个 `render*Typst` 末尾由 `+ captionTypst()` 改为 `return wrapFigure(field, body)`——让项目报告里的表格能像首页文本字段一样逐个调标签/对齐/间距。⚠️ **报告自动表的标题缺省＝不显示**（`wrapFigure` 只在 `hide_label === false` 时出标题；报告表多半已在带标题的分区里，自动出标题会和分区标题重复——用户要求"不要自己显示标题"）；「基础」Tab 的开关 `checked={hide_label===false}`/`onChange v?false:undefined`。matrix/image 仍缺省**显示**标题（`hide_label` falsy=显示，存量零变）。**标题↔图/表的距离**：`FieldDefinition.label_gap`（pt）→ wrapFigure 与 matrix 的标题块 `below`（缺省 wrapFigure 0.4em / matrix 0.55em）；UI 在版式 Tab（报告表）/类型配置（matrix）的「标题与图/表的距离」。**备注信息**：`FieldDefinition.caption`（`shared/types.ts`）→ `FieldPropsPanel` 基础段给五类图/表一个「备注信息」输入 → `captionTypst(caption, caption_gap, side)`（9pt 小字、`escapeTypst`+`\n`→linebreak 防注入）；矩阵/图片仍固定下方，报告表/图位置由 `caption_position` 决定。**备注↔图/表的距离**：`FieldDefinition.caption_gap`（pt）→ `captionTypst` 的图/表一侧间距（`side='above'` 备注在下方→设 block `above`；`side='below'` 备注在上方→设 `below`；缺省 0.35em）；UI：**报告自动表在「版式」Tab「备注（题注）位置」下方**、matrix/image 在基础段备注框下方（无版式 Tab）。**整表文字样式（仅 report_result_table / report_equipment_table）**：`FieldDefinition.table_style={font,font_size,header_bold,body_bold}`——`font/font_size` 经 `tableStyleWrap()` 把整表包进 `#text(font,size)[…]`；`header_bold`（缺省 true）/`body_bold`（缺省 false）经 `tableCellBold()` 逐格加粗（faux-bold 感知，仿宋/楷体等加描边）；UI 在「版式」Tab「整表文字」。⚠️ 表头从旧 `[*label*]` markup 改为 `#text(weight:"bold")`：真粗体字体（宋体）逐像素一致，**无粗体字体（仿宋/楷体）表头现在真正加粗**（旧 `*` 在仿宋不显示粗，属修正）。**备注文字样式**：`FieldDefinition.caption_style`(StyleOverride)→ `captionTypst` 行内 text()（缺省 9pt 常规，可改字体/字号/加粗/斜体/颜色）；UI 在「版式」Tab「备注样式」（FormatPanel variant=text）。 → **报告生成后文员可在 `InstanceEditor` 改本份报告的备注** | caption/label_style/style/caption_position/label_gap/caption_gap/table_style/caption_style 都是字段上的字面量、随 content_doc 走（非 binding）；空＝不渲染 |
| 改报告 PDF 渲染 | `shared/typst-generator.ts` — `injectReportFieldsIntoTypst()` + `resolveBinding()` + 4 个 `render*Typst()` | `server/routes/reports.ts` 中 `buildReportTypst()` 是入口 |
| 改 CellBinding（取值绑定）/「选择数据来源」弹窗 | `shared/types.ts` 中 `CellBinding`（12 种 source，含 **`order_samples`**＝样品清单带编号/排版，P-Map-5；**`record_header`**＝原始记录矩阵表头**录入时所选的单位/备注**，P-Map-9）→ `shared/typst-generator.ts` 中 `resolveBinding()` + `ReportRenderCtx` → `client/components/ReportEditor/BindingPickerModal.tsx`（可视化选取器，标题"选择数据来源"；v2 旧路径 `BindingEditor.tsx` 只读不扩） | record_meta=绑主检/审核；**`record_header`（P-Map-9）**：`{matrix_code,param_code}` → `resolveBinding` 读 `ctx.record_raw_data[matrix_code].parameter_unit_overrides[param_code]`（录入时所选单位/备注，如「客户要求/标准要求」），无 override 回退矩阵参数列静态 unit，仍无 ⇒ 返回 `''`（表头据此省略括号备注）。用于让结果表**表头跟随录入选择**而非模板写死。**`record_cell_sample` / `record_sample_label`（P-Map-10·样品带）**：仅用于结果表"样品带"那一行/列里的单元格——前者＝当前样品的某参数列值、后者＝当前样品名；正常由 `expandResultTableBand` 在渲染前按各样品解析成字面量，裸调 `resolveBinding` 回退 `—`。**order/sample/test=绑委托单接口字段**（接口 1.1，从 `work_orders.payload` 拉取：order→`ctx.order_meta`、sample→`ctx.sample_info`、test→`ctx.test_info`，由 `buildReportTypst` 按 record_data 的 sample_external_id+test_item_name 回查注入）；**`order_samples`＝样品清单（报告范围带编号）**：`ctx.order_samples`（`buildReportTypst` 从 `payload.samples` 建 `{no:sort_no||序号, name}`）→ `resolveBinding` 拼 `1#：名称、2#：名称…`（`numbered` 缺省 true、单样品自动不显编号；`layout:'inline'` 顿号一行 / `'lines'` 每样品一行 \n→multiline 换行）；首页/封面可见，配置在弹窗「样品清单」tab。加新 source 记得同步 `shared/binding-integrity.ts` 校验分支（order_samples 无记录引用、无需校验）。**P-Map-4：来源按模板类型过滤**——`PROJECT_ONLY_KEYS=[sample,test,record_field,record_cell,record_summary]` 需 per-project 上下文，**只在项目报告（`linkedRecord` 非空）显示**；首页/封面（`linkedRecord=null`）只留 字面量/委托单/报告接口(1.2)/系统 4 个（`isVisible()` 过滤 + activeKey 钳到可见 tab）。**项目模板的绑定一律只暴露原始记录来源**（2026-06）——结果表早已 `allowedSources=RESULT_TABLE_SOURCES`；**本项目检测结论**（`ProjectEditor` 的 `editingConcl` 弹窗）与**项目字段映射**（`FieldPropsPanel.CellBindingButton`，仅 `linkedRecord` 非空＝项目侧）也都传 `['literal','record_field','record_cell','record_summary','record_header']`，去掉委托单/样品/测试/报告接口/系统等首页级冗余（首页/封面字段映射 `linkedRecord=null` 不限制、保留接口源）。**`record_field` 列表排除【溯源信息】字段**（`scalarFieldsByGroup` 过滤掉 `semantic_role` + `spacer`）——主检/审核/检测日期/审核日期是系统自动注入的审计字段，配项目映射时不需要。**P-Map-11：统一绑定 UI**——`BindingPickerModal` 加 `allowedSources?` 白名单 prop（叠加在 `isVisible` 上）+ `record_header` tab（`MatrixHeaderPicker`：选矩阵+参数列）+ `title?` 自定义标题；`BindingSummary` 补 `record_header`/`record_cell_sample`/`record_sample_label` 概要。**结果表画布 `ReportResultTableCanvas` 不再有自带的内嵌源卡（旧 `MatrixSourceGrid`/`ScalarPicker`/`LiteralPicker`/`OrderSystemPicker` 已删）**，点格→紧凑操作条→「选择/修改数据源」开同一个 `BindingPickerModal`，`allowedSources=RESULT_TABLE_SOURCES`（`literal`/`record_field`/`record_cell`/`record_summary`/`record_header`，**项目结果表只暴露原始记录来源**）。两套绑定 UI 至此统一。**P-Map-11b（表头绑定 UI）**：`HeaderConfigCard` 加 `allowBinding`/`linkedRecord`/`bindingSources` props + 「表头取值绑定」段——标题/单位/备注各一行「绑定/清」，开内嵌 `BindingPickerModal`（含 `record_header` tab）落 `label_binding/unit_binding/note_binding`（`HeaderCfgValue` 已扩），结果表静态列调用接上。**P-Map-11c（样品带 UI）**：见「样品带」行。`BindingPickerModal` 另加 `bandMatrixCode` prop + `record_band` tab（`BandCellPicker`）。 |
| 改报告映射引用完整性校验 | `shared/binding-integrity.ts`（`validateReportBindings`）→ `server/routes/report-templates.ts`（`/:id/binding-check` + PUT/review 带 `binding_warnings`）→ `client/pages/ReportTemplate/ProjectEditor.tsx`（实时标红 Alert） | 失效 = 原始记录改名/删了字段编码。校验 `record_field`/`record_cell`/`record_summary` 三类 CellBinding（抽 `checkRecordBinding` helper）+ **项目检测结论声明 `layout_options.conclusions[].binding`（6.7，第三参传入）** + **图片表 `image_gallery.items[].source_field_code` / `source_field_codes`（须是关联记录 image 字段，索引 `RecordFieldIndex.imageCodes`）**：结论绑定的 record_* 须在关联记录当前版本存在（索引 `RecordFieldIndex.matrices` 含 `params`/`summaryRows`/`summaryCols`）+ **`record_header`（P-Map-9）**：matrix_code 须存在、param_code 须是该矩阵参数列 + **`record_cell_sample`/`record_sample_label`（P-Map-10·样品带）**：前者校验 matrix+param、后者校验 matrix（样品带单元格经 `collectReportBindings` 遍历 result_table.cells 自动纳入）。**P-Map-12：结果表【表头槽位】绑定也已纳入** `collectReportBindings`——静态 `columns[].label_binding/note_binding`、**汇总行/汇总列表头 `summary_rows[]/summary_cols[].{label,note}_binding`** 都收集后过 `checkRecordBinding`（失效的 record_header/record_field 等表头绑定会实时标红，path 形如「… · 表头[速率 单位]」）。改这里加新来源/source 时记得同步校验分支 |
| 改报告"结论"判定逻辑 / **检测结论表抓取**（6.7：声明在项目模板、取值从原始记录） | **声明在项目报告模板**：`layout_options.project_name`（项目名）+ `layout_options.conclusions[]`（`ProjectConclusionDecl{id,sub_name?,binding}`，每条＝一个结论框；`binding` 用 `CellBinding` 的 record_* 指向关联原始记录的判定值）。`server/routes/reports.ts` 的 `buildReportTypst()`：每个 assignment（项目模板+原始记录数据）→ 读 `projTpl.layout_options.conclusions`，逐条 `resolveBinding(decl.binding, projCtx)` → `{name=projTpl.layout_options.project_name, sub_name, value}` → 收 `projectRecords` → 按样品号排序展平成 `projectSummary`（每子结论一行，带 `sample_no/sample_name/sub_name`）。渲染：`shared/typst-generator.ts` 的 `renderConclusionTableTypst` 按 样品/序号 `rowspan` 分组（`sample_col:'auto'` 单样品自动隐藏样品列；样品号 `1#` 转义 `\#`） | 声明 UI＝`ProjectEditor.tsx` 的「本项目检测结论」面板，**放在左侧编辑列·模板名称下方**（`EditorSplit` 的 left 内：模板名称 → 结论面板 → FieldEditor；模板名已从顶栏移到左列顶部，顶栏只留灰字「项目报告模板」，不遮挡右侧 PDF 预览）；标题旁有 `QuestionCircleOutlined` 悬停说明（项目名＝报告章节标题／子项目名＝结论表显示·单项目可空·多子项目必填／数据来源＝指原始记录判定值）；项目名 + 子项目结论列表（sub_name + `BindingPickerModal` 选来源 + 增删）。**必填校验**：`binding-integrity.validateProjectConclusions(project_name, conclusions)`（项目名必填 + 至少一条结论且各有数据来源 + 多子项目时每条须填子项目名）→ 面板内红字+`status=error` 标注；**未填禁止提交审核**——客户端经 `TemplateVersionPanel` 的 `submitGuard` 拦 + 服务端 `report-templates POST /:id/submit` 对 `template_kind='project'` 兜底校验（400）。另 `validateReportBindings(groups, recordGroups, conclusions)` 把每条 `conclusions[].binding` 纳入失效标红。⚠️ **原始记录不再有「作为检测结论」标签**（`conclusion_field` 已彻底移除）；存量标记由 `scripts/migrate-conclusions-to-project.ts` 迁到项目模板。结论表配置在 `report_conclusion_table` 的 `conclusion_table.{columns含'sample',sample_col}`（首页字段）；子项目↔结论框一对一（每条声明自带 sub_name+binding） |
| 改 PDF 大标题 / 副标题（文字 + 字体/加粗/居中/颜色） | `FieldEditor/TitleStylePanel.tsx`（record 模式，写 `layout_options.{document_title,title_style,subtitle,subtitle_style}`，样式复用 `FormatPanel`→`StyleOverride`）→ `shared/typst-generator.ts`（`styleOverrideToTextDict` 序列化为 `title_text_args/subtitle_text_args`+`*_align`；`org` 参数取 `layout_options.subtitle ?? "广电计量"`）→ 主题 `record-theme` 标题块（默认 args 字典合并用户 args + 独立对齐 + 副标题空串不渲染） | 副标题＝主题 `org` 参数；未设样式＝走默认（标题加粗居中、副标题小字灰）；存量模板零变化。**凡有页眉页脚（`header_footer` 启用）的报告/首页模板，正文一律不渲染自动大标题/副标题**（标题只在页眉 `header_footer.title`＝"检测报告"出，避免一页两个标题；`generateTypst` 在 `hasHeaderFooter` 时强制 `title:""`+`org:""`，2026-06；不再依赖各模板自设 `suppress_title`）——只有**普通原始记录**（无 header_footer）才在正文出标题/副标题。**项目报告不出正文大标题/副标题**："检测报告" 只属于封面/首页，项目段 `#show` 出报告时本就被 `renderContentDoc` 剥掉——`ProjectEditor.tsx` 预览相应注入 `suppress_title:true`+`subtitle:''`（`title!=""`/`org!=""` 才渲染，见主题 lib.typ）让预览与最终报告一致，"检测报告" 改由页眉每页重复。**项目段不出居中大标题，但出「N) 项目名」编号小标题**（2026-06 取消了 `#heading(level:1)[项目名]` 那种居中大标题；2026-06-19 按参考样张加回**编号小标题**）：`renderContentDoc` 在每个项目段前注入 `#block[#text(weight:700, size:1.05em)[N) 项目名]]`（左对齐加粗小标题，**非**大标题），序号 `N` 由 `buildReportTypst` 按**与结论汇总表相同的排序**赋号（`projects[oi].seq = runningIdx`，再 `projects = order.map(...)` 重排，保证明细段序号 == 结论表序号）。项目名取 `p.title || p.name`（即 `displayName`，优先 `项目模板.layout_options.project_name`）；空名不出标题。`ProjectEditor.tsx` 预览侧仍 `suppress_title:true`（单模板预览看不到跨项目序号，属预期）。项目之间靠 `#pagebreak()` 分页隔开（`p.page_break !== false`）。主题 `show heading.where(level:1)` 规则保留。**项目模板默认字体＝`FangSong_GB2312`（仿宋）**：新建项目模板时 `List.tsx` 写 `layout_options.theme_config.font='FangSong_GB2312'`（+ `ProjectEditor.EMPTY` 兜底）；存量模板不动 |
| 改公司 Typst 主题（字体 / 页眉 / 页脚） | `typst-packages/local/record-theme/0.1.0/` 内 `.typ` 文件 | 改完所有引用该主题的模板渲染会同步变 |
| 改「文档样式」面板（字体/字号/标题倍率/行距/段距/边框/页边距/**字段名对齐**/**字段标签加粗**） | `FieldEditor/DocumentStylePanel.tsx`（写 `layout_options.theme_config`，**倍率/间距均为自定义数字 InputNumber**）。**字段标签（label_weight）三态：默认/加粗/正常**——`setLabelWeight()`：**加粗/正常＝强制统一到全部字段**，同时清掉每个字段的 `label_bold` 与 `label_style.weight`（否则字段级覆盖会让文档级设置应用不到那些字段，首页模板字段就带着 `label_bold:false`，曾导致"文档设加粗但部分标签不变"）；默认＝主题默认(加粗) + 保留字段级各自设置（不强制统一）→ `shared/typst-generator.ts` 中 `themeConfigValueToTypst`（按键加 pt/em/cm 单位）→ 主题读 config。页边距：`margin`(cm 数字=四边统一 或 预设字符串) + `margin_v`(上下) / `margin_h`(左右) 可分别覆盖（面板拆成「上下页边距 / 左右页边距」两项），主题先算 base-margin 再用 margin_v/h 覆盖对应边。**「只渲染字段（自动标题/副标题）」开关按 `editorMode` 显隐**：`report-project` 不显示该开关（项目段本就不出大标题/副标题，由 `renderContentDoc` 剥离，开关无意义=画蛇添足）；record/report-cover 仍有 |
| **字段名对齐（值对齐到同一制表位）** | **文档级**：`theme_config.label_width`（em，缺省 undefined=值紧跟标签）→ 主题 `#field` 把「标签：」放进 `box(width: label_width)`，使**所有字段的值对齐到同一位置**、标签与值之间留出统一间距。UI：`DocumentStylePanel`「字段名对齐」开关 + 「标签列宽」em 输入（`themeConfigValueToTypst` 已把 `label_width` 列为 em 长度键）。**分区级覆盖（2026-06-29）**：`FieldGroup.label_width`（`undefined`=跟随文档 / `'none'`=紧贴无距离 / `'<len>'`=本区按该宽度对齐）→ `generateGroupContent` 把它透传给竖排 `#field` 的 `label_width` 参数（`auto`=跟随文档全局、`none`=紧贴、长度=覆盖）；**仅竖排有效**（多列/网格走 `cellFieldInner` 本就行内紧贴）。UI：`FieldEditor` 分区头「格式」Popover→「字段值对齐」三档 `跟随文档/紧贴/对齐(+em宽)`。⚠️ 调字段名与值的距离**用 label_width，绝不在值里敲空格**（空格宽度随字体变、对不齐） |
| 改报告页眉页脚（内容/版式/数据源） | 主题 `record-theme/0.1.0/lib.typ`（`_render-header`/`_render-footer`）+ `shared/typst-generator.ts`（`themeConfigToTypstDict` 透传 header_footer）+ `server/routes/reports.ts`（`buildHeaderFooterConfig` + `buildReportTypst` 注入）+ **`config/header-footer.json`（全局默认版式 settings + 取号前示例 sample_meta，随代码部署）** + `services/external-report-meta.ts`（取号前示例，读 sample_meta）+ `client/pages/ReportTemplate/CoverEditor.tsx`（版式开关 UI） | 仅 v3 groups 报告；值来自接口⑦、版式（enabled/页码）来自报告模板 layout_options.header_footer。**预览页眉页脚单一事实来源（2026-06）**：`ReportTemplate/preview-hf.ts` **直接 `import config/header-footer.json`** 派生 `STANDARD_HF_LAYOUT`(=`settings`，去 `_` 注释键) 与 `PREVIEW_HF_VALUES`(=`sample_meta` + 预览用报告号/校验码样例)——与真实报告（服务端读同文件 `settings`）**同源**，不再手工维护两份。CoverEditor 预览合并 `{ ...STANDARD_HF_LAYOUT, ...PREVIEW_HF_VALUES, ...本模板 header_footer, enabled:true }`，故**任何首页模板（含未配版式的）预览都出标准页眉**（24pt/字距/无分割线），模板显式键覆盖默认。改默认只改 `config/header-footer.json` 一处（前端构建时内置→改完 `pnpm build`；真实报告运行时读→重启生效。注：服务端还叠加 `header-footer.local.json`，前端只内置 base）。`tsconfig.app.json` 已开 `resolveJsonModule`。**项目报告编辑器（`ProjectEditor.tsx`）预览也注入页眉页脚**（「随首页」开关，缺省开）——因「报告级统一、项目继承」：最终报告里项目段 `#show` 被 `renderContentDoc` 剥掉、整篇共用首页那一个 `set page`，故项目模板**不**自存 header_footer，编辑器只在预览侧呈现项目页真实版面。⚠️ **精确跟随实际首页**：ProjectEditor 加载时拉 `GET /api/report-templates?kind=cover`（首页模板，列表带 `cv.layout_options`），取首个带 `header_footer` 的首页，其版式开关（`header_rule`/`title_size*`/`title_tracking`/几何微调/`enabled`）按 **与 CoverEditor 同序**合并（`{ ...PREVIEW_HF_VALUES, ...coverHF }` → 首页覆盖示例数据值）注入预览，使项目预览与首页编辑器预览**逐键一致**（含隐藏分割线）。拉不到首页时回退 `STANDARD_HF_LAYOUT`（`preview-hf.ts`，镜像 `scripts/front-template.ts` 的标准版式）。**页眉页脚字体固定为 `FangSong`（仿宋），不随「文档样式·字体」变**（`lib.typ` 的 `_render-header`/`_render-footer` 中 `hf-font` 缺省 `FangSong`，2026-06；原先缺省回退正文字体 `_cfg-get("font")`，导致改文档字体会连页眉页脚一起变——属 bug）。**新建首页模板（`CoverEditor.EMPTY`）已内置标准版式默认**（`suppress_title`+`subtitle:''`+标准 `theme_config`+`header_footer:{enabled,...STANDARD_HF_LAYOUT}`），新模板的页眉字号/字距/边距即与标准一致。⚠️ 字体名用打包 family 名 **`FangSong`**（非中文「仿宋」——`--ignore-system-fonts` 下中文别名不解析；`front-template.ts` 默认值已从 `'仿宋'` 改 `'FangSong'`）|
| 复刻外部 .doc 报告版面到首页模板 | `scripts/front-template.ts`（模板定义＝单一事实来源）→ `scripts/upsert-front-template.ts`（入库 DB `template_kind='cover'`）；版式能力：`suppress_title`/`signature_line`/`label_width`/`StyleOverride.margin`/页眉 `title_size*`/`conclusion_table.column_labels` | 用 `soffice --convert-to pdf` + `pdftoppm` 把 .doc 转 PNG 视觉对照；字体名存打包 family 名 **`FangSong`**（`--ignore-system-fonts` 下中文别名「仿宋」不解析，2026-06 起 `buildFrontTemplate` 默认值即 `FangSong`） |

### 录入与报告生成

| 想做的事 | 主要文件 | 配套要看 |
|---|---|---|
| 改录入工作台（订单列表 → 详情两层） | `client/pages/Lab/TaskList.tsx`（订单列表：单号/客户/来源/样品·项目数/关联·录入·审核进度 + 行点击/「进入详情」跳详情 + 「新建订单」抽屉 + 删除）→ `Lab/OrderDetail.tsx`（`/lab/order/:orderNo`：样品×项目表 + 关联/录入/审核/审核记录）→ `Lab/Record.tsx`（录入页，返回回详情）。两页共用 `Lab/order-shared.ts`（类型 + `buildOrderRows`/`findRecord`/`orderProgress`/`normalizeLinkedIds`/`computeDiff`）。**一对多关联**：一个测试项目可挂多个模板 → `buildOrderRows` 展开成多行（每行一个模板，`test_key` rowSpan 合并样品/项目列）；进度按「样品×项目」格统计。**被退回时（含外部 1.3 `data_entry` 退回到实验室）订单详情页顶部红色横幅汇总退回意见**（`rejectNotes` 去重），主检无需逐条打开即知如何修改 | 后端：`routes/work-orders.ts`（`PUT /:no/link` 的 op add/remove） |
| 新建/删除委托单（手动建单，与接口单同构） | 前端 `Lab/TaskList.tsx`「新建订单」抽屉（Form.List 动态增删样品/测试项目）；后端 `routes/work-orders.ts`（`POST /` 建 source=manual、`DELETE /:no` 连带清关联数据） | 清旧 mock：`scripts/reset-orders.ts`；接缝 `services/external-orders.ts`（现返空） |
| 改订单结构（改/增删 样品·测试项目，不审核但留痕+护栏） | 前端 `Lab/OrderDetail.tsx`「编辑订单」抽屉（隐藏 id/_orig_name 配对）+「变更记录」抽屉；后端 `routes/work-orders.ts` 的 `PUT /:no/structure`（后端 diff + 护栏 + 改名级联 record_data + 写 work_order_audit_log） | 删除有数据的样品/项目会被 409 拦截；改名同步唯一键列 `record_data.test_item_name` |
| 改图片上传（内联拍照 / 独立上传 / 移动端） | 内联：`FormRenderer` 的 `ImageField`（选图 + `capture="environment"` 拍照）；独立：`components/ImageUploadPanel.tsx`（详情页「上传图片」Modal + 移动页共用）→ 后端 `PUT /api/record-data/images`；移动页 `pages/Mobile/ImageUpload.tsx`（路由 `/m/upload`，支持深链 query 直达） | 图片仍是模板里的 image 字段、进 PDF；独立上传与内联写同一字段，保存即数据变更（重置待审核）。手机拍照=`<input capture>`，无需原生 App |
| 改委托单高级搜索 | `components/OrderSearchBar.tsx`（关键字常驻 + 来源/状态/接收日期/主检/审核可展开）+ `Lab/order-shared.ts` 的 `OrderSearchCriteria`/`filterOrders`/`isOrderSearchActive`（纯前端过滤）→ `Lab/TaskList.tsx` 接入 | 状态过滤按订单级派生（有未关联/有未录入/有待审核/有退回/整单已审核），用 `orderProgress`（已含 pending 计数） |
| 改报告生成工作台（**取号驱动**，OrderList → Workbench 两层） | `client/pages/Report/OrderList.tsx`（调 `/api/work-orders` 列表）+ `Workbench.tsx` | 后端：`routes/reports.ts` 中 `buildReportTypst()`（`POST /preview` 仅首页预览 + 取号生成共用）；入库走 `generateAndStoreReport`（取号生成调用） |
| **报告如何拆分＝外部取号决定，本系统不选**（重要） | `Workbench.tsx` **不再有**「出报告方式」(整单/按样品/按项目/自由)、手动项目槽、手动「生成入库」——这些拆分语义由接口 1.2 推送的每个报告编号（自带其样品×项目范围）决定。本系统只在每个报告编号内**补齐/确认**样品·项目·原始记录。⚠️ 后端 `POST /reports/generate-batch` 端点仍在但**前端已不调**（手动批量拆分入口已撤）；唯一生成路径＝取号 `POST /external/requisitions/generate` | 设计依据：用户明确"按样品出/整单出不该在本系统选，取号编号已含此信息" |
| **报告详情页（取号前看信息 + 编辑首页实例）** | OrderList「操作」→ `Workbench.tsx`（单列详情页）：① 「订单信息」面板（`Descriptions` 列接口 1.1 字段：客户/地址/送检日期/业务员/买家/状态/报告数量…来自 `work_orders.payload.meta`，只读）；② 录入进度 `RecordProgressPanel` + 只读原始记录 `ReadonlyRecordViewer`；③ **「编辑首页」按钮** → `POST /reports/cover-draft`（order 级首页草稿）→ 进 `InstanceEditor`（改样品信息/结论等**实例填入值**、字段增删改、表格样式——非模板）。⚠️ **取号前首页草稿的「样品信息表 / 检测结论表」出灰字占位**（2026-07：cover-draft 传 `blank_scope:true`→`buildReportTypst` 置 `coverCtx.blank_scope`→`renderSampleTableTypst`/`renderConclusionTableTypst` 出「取号后按报告编号自动生成」占位、并清空 `order_samples` 防整单样品泄漏；原先列整单全部样品的 `keep_all_order_samples` 已不用于草稿）——这两块范围由报告编号(接口 1.2 的 `SampleList`)决定，取号后各报告按自己范围生成，文员在草稿里只排版首页结构/图片/样式；④ **「报告」卡片**（取号后，2026-06 重做）：报告**由系统自动生成**（收到 1.2 即生成 / 本页载入兜底生成，文员无需手点生成），每份报告＝一条**可展开条目**（收起＝报告编号＋单一状态标签 `reqStatus`＋样品「；」拼接＋操作；展开＝样品×测试项目，只读）。操作精简为 **历史版本 / PDF / 编辑 / 送审**（`canSend` 控可见）。**送审状态机**：①未送审→可编辑+送审；②全部送审后→终态，所有「送审」+ 头部「全部送审」不可点击，**「报告首页」(编辑首页+模板选择)也一并锁定**（`coverLocked`＝有报告且无可送审项，除非有报告被退回）；③**报告退回**（`report_rework`，1.3 `report_edit`／外部回执 needs_revision）→**仅该报告**重新可编辑+送审（退回意见就近显示在该条目下方黄条，**不重生成**＝在原报告上改），「全部送审」此时只送被退回的；改完「送审」回传成功即关单回终态；④**数据退回**（`data_rework_open`，1.3 `data_entry`）→该报告锁定（红条），退回意见因不确定改哪条记录而统一显示在「数据录入进度」下方（`dataReworkNotes` 取被退回记录 `reject_note` 去重），待数据重审通过→自动按新数据重生成（`autoGenAttempted` 兜底，排除 `report_rework`）→需全部重新送审。头部仅「刷新」+「全部送审」。原底部「外部返工」面板已删（退回意见改为就近展示）。**送审＝回传**（`POST /external/requisitions/:id/deliver`）。**不再有常驻首页预览**（预览在 InstanceEditor 内）。**「调整样品/项目」弹窗（2026-07 改版）**：`InstanceEditor` 顶栏按钮 → `GET /reports/:id/scope-candidates` → **按样品分组的可展开列表**（勾样品=选中它下全部测试项目、也可只勾其中几项，Checkbox 半选 indeterminate；每样品可折叠 ▸/▾）+ **搜索框**（命中样品名→显示该样品全部项目，命中项目名→只显匹配项）；确认按钮文案＝**「确认」**（不再是「重算」）、直接调 `POST /reports/:id/rescope`（无二次弹窗），后端按新范围重生成首页样品信息表/检测结论表+各项目明细。状态：`scopeGroups`(useMemo 分组)/`scopeSel`(Set<record_data_id>)/`scopeSearch`/`scopeCollapsed`。**编辑器 UX 一批（2026-07）**：① **左侧可收起大纲**（`outlineOpen` 持久化 `localStorage.instOutlineOpen`，首页/项目→分区点击跳转：滚左侧锚点 `sec-${key}`/`grp-${key}-${gi}` + 右侧预览 `scrollToMarker`）；② **字段→PDF 跳转按段精确**——`renderContentDoc` 用 `prefixPosMarkers(src,'cover'|'front'|`proj${i}`)` 给每段 posMarker 的 code 前缀，编辑器 `scrollToMarker(`${sectionKey}::${code}`)`，修「项目字段点了跳到首页」（跨段 code 撞车）；③ **分区标题可行内编辑**（非图片段也用 Input 改 `group.label`，填了自动 `hide_title=undefined` 显示，去掉死板「无标题分区」）；④ **视觉对比增强**（分区色块 `#e7eef8` 头/灰底身 `#f5f8fc` 让白字段行凸显、首页↔项目分割线用实色胶囊+渐变线）；⑤ **顶部浮动操作栏**：底色加深(`#d3e0f7`)、加**强制分页**(切 `FieldDefinition.page_break_before`→`generateFieldBlock` 前置 `#pagebreak()`)与**添加内容**下拉(选中字段下方插内容，`makeContentField`/`INSERT_MENU_ITEMS` 共用)，删各分区「在末尾插入内容」；⑥ **daterange(检测周期)可编辑**（落 `binding=literal`，`formatDateRange` 遇 literal binding 优先返回）；⑦ **表格「标签/备注」编辑卡**（`LabelCaptionCard` 两列＝上方标签 `field.label`+下方备注 `field.caption`，含样式/距离/显示开关，覆盖 `LABELCAP_TYPES` 结果/设备/样品/结论/照片/图库表；图片 `ImageSectionNotes` 改两列并去掉重复「大标题」）；⑧ 去掉左侧「报告内容…」卡片标题。「测试设备」内联显示见第四节设备库行。**再一批（2026-07）**：⑨ **工具栏「版式」弹窗与工具栏按钮去重**——`FormatPanel` 新增 `variant='block-extra'`（只给 字体/行间距/字距/段前后，不含 字号/加粗/斜体/颜色/对齐＝工具栏已有），报告编辑器「版式」用它；⑩ **大纲显式「收起」按钮**（大纲头 `DoubleLeftOutlined` + 顶栏 `UnorderedListOutlined` 切换，`localStorage.instOutlineOpen`）；⑪ **只读查看模式** `?readonly=1`——Workbench 报告卡片：已送审/终态报告出「查看」(只读)、可送审出「编辑」，历史/PDF 收敛成图标按钮；`InstanceEditor` readOnly＝隐藏 保存/工具栏/文档样式/调整/退回、结构区 `pointerEvents:none`、`mutate` 空转、顶栏出「只读查看」Tag + PDF 下载 | 「编辑首页」是**实例级**（content_doc.cover），不是改 `CoverEditor` 模板。`InstanceEditor`（首页/报告编辑）**已移除「Typst 源码」按钮 + 「编辑历史」留痕 Drawer**（界面更干净；服务端审计仍写、只是不在编辑器展示） |
| **首页草稿 carry 到取号报告** | 取号生成时 `routes/external.ts` `/requisitions/generate` 载入本订单首页草稿 `content_doc.cover.groups` → 作 `cover_groups_override` 传 `generateAndStoreReport`→`buildReportTypst`：用草稿的**结构/样式/手改字面量**当首页，binding 与结论汇总表仍按各报告 scope 现算（ctx 每报告重建）| `buildReportTypst` 里 `if (cover_groups_override) coverTpl.field_definitions = override`，下游 `content_doc.cover.groups` 即用之 |
| 改报告取号驱动生成（接口 1.2，**收到即自动生成**） | **本系统不做取号/逐格补齐**：收到 1.2 即按已审核数据自动生成（后端 `external.ts autoGenerateRequisition`；数据后录入则 `Workbench.tsx` 载入兜底 `POST /requisitions/generate`）。`Workbench.tsx` 报告区为**只读可展开条目**（编号/单一状态/样品「；」/操作；展开看样品×项目），头部仅「刷新」+「全部送审」。**状态机**：待送审（可编辑·送审）→ 送审后**终态**（仅 PDF/历史版本，不可再编辑/送审）→ 仅退回（data_entry 锁/external 退回）才重新可编辑送审。**无手动「生成/重新生成」按钮**：未生成有数据即自动生成；stale（改号/数据退回重审后/外部退回）且未锁时**自动按最新数据重生成**（旧版入历史、delivery 重置为未送审）。**增删样品/改测试项目在编辑器做（下一步）**。`OrderList.tsx`（UI 对齐录入侧 TaskList：**KPI 统计卡可点筛选 + 共用 `OrderSearchBar` 多条件搜索[关键字/状态/接收日期/主检/审核] + 「状态」列**[退回修改/审核通过/已送审/已生成/待生成/未取号，`deriveReportStatus`]；已去掉左侧展开「进度」列）。`OrderSearchBar` 加 `statusOptions`/`keywordPlaceholder` props，状态下拉按页面传入（录入侧默认录入状态、报告侧传报告状态）；角标数据 `/external/requisition-counts` | 后端：`routes/external.ts` + `services/external-report-info.ts`（解析+匹配）；页眉页脚用每报告 meta（`buildReportMetaFromReq`→`buildReportTypst` 的 `report_meta`）。录入侧列表同有「状态」列（`order-shared.ts` `deriveOrderStatus`）。设计见 `待实现内容.md` 6.0a–6.0e。⚠️ **首页样品清单/样品信息表 = 本报告编号自带样品（scope.samples）直取**：`autoGenerateRequisition` / `/requisitions/generate` 把 `requisition.scope.samples`（接口 1.2 SampleList）映射成 `report_samples` 传入 `buildReportTypst`，覆盖从 `work_orders.payload` 回查/按 assignment 收敛的 `order_samples`——保证样品数量/名称/零件号严格等于该报告编号推送的样品（单样品→样品信息表自动折叠、不出表；不会混入整单其它样品或数量对不上）。手动/整单生成不传 `report_samples`，仍走 payload scope 逻辑 |
| 报告"字段编辑"入口（生成后才编辑）| **流程：取号补齐 → 生成 → 报告入库快照 → 进 `InstanceEditor`(`/report/edit?id=`) 改字段值/增删字段/结果表行/格式**。Workbench 底部「本单已生成报告」面板列出已生成报告 + 「编辑字段/排版」按钮（取号生成后单份自动进编辑器，多份在「取号报告」面板逐份点「编辑」）；OrderList 的「已生成报告」计数 Modal 也有同样入口 | 字段编辑是**报告生成之后**对实例文档（content_doc）的操作，不在模板选择阶段 |
| 改"主检 / 审核"字段如何渲染 | `FormRenderer/index.tsx`（顶部 `field.semantic_role` 分支）+ `Lab/Record.tsx` 中 `injectAuditFields()` | 报告侧绑定走 `CellBinding.source = 'record_meta'` |

### 审核流 / 版本管理

| 想做的事 | 主要文件 | 配套要看 |
|---|---|---|
| 改录入数据审核流 | `server/routes/record-data.ts`（POST/PUT 带 `status` 写快照 + `/:id/submit` `/:id/withdraw` `/:id/review`）。**状态机**：`draft`(草稿) → `pending`(待审核) → `reviewed`/`rejected`；草稿/退回可 submit、待审核可 withdraw、仅 pending 可 review | 录入页 `Lab/Record.tsx` 双按钮「保存草稿/提交审核」+ 未保存守卫 `useUnsavedGuard`；详情页 `Lab/OrderDetail.tsx` 主检「提交审核/撤回」、审核员「审核」。**审核弹窗内「查看录入后的原始记录（渲染预览）」**按钮打开 `ReadonlyRecordViewer`（传 `hideReject`：退回走审核弹窗、不显报告端 rework 退回）——审核员据此看到主检填好的原始记录按锁定版本渲染的 PDF，定位错误后再决定通过/退回（之前审核弹窗只有签字摘要、看不到数据，无从判断对错） |
| 改录入数据「审核后锁定 / 一致性」 | **reviewed 锁定**：`record-data.ts` 的 POST/PUT/`/images` 命中 reviewed 记录返回 409（解锁靠报告端「退回原始记录」rework→rejected）。**按锁定版本编辑**：`Lab/Record.tsx` 编辑已有记录时按 `record_data.template_version_id` 加载模板（`GET /:tid/versions/:vid`），不用当前版本——模板后续修改不回改已生成记录。详情页 reviewed 行「编辑」变「**详情**」——点开仍进 `Lab/Record.tsx`（左编辑器 + 右 PDF），但**左侧编辑器整块 `pointerEvents:none` 只读**、保存/提交禁用（不再只给 `ReadonlyRecordViewer` 的纯 PDF）；`goRecord` 对 reviewed 放开角色限制（任何人可看详情）。**图片按钮 reviewed 时仍在**、`ImageUploadPanel readOnly`＝只看不传/删/存；退回转草稿后恢复可编辑。`ReadonlyRecordViewer` 仅保留给审核弹窗里的预览 | 退回流程 `routes/rework.ts` 直接 UPDATE 绕过锁；新建录入仍用当前 approved 版本 |
| 改退回/返工工单 + 订单时间线 | `server/routes/rework.ts`（建单/resolve/timeline）+ `record-data.ts` review approve 分支（stale + 自动关单）+ `components/ReadonlyRecordViewer.tsx`（报告端「退回原始记录」）+ `pages/Report/Workbench.tsx`（订单时间线 Drawer） | 场景1 复用现有 `rejected` 态；migration 020 |
| 改外部退回闭环（接口 1.3 ModifyType / P-Flow-2 场景3） | **正式入口** `routes/external.ts` `POST /report-modify`（接口 1.3 RefreshReportInfo，`ModifyType=data_entry`→退录入重录、`report_edit`→退文员改报告；新字段 `RecordState`/`SecondAuditDate`/`Remark`）。**无 ModifyType 时按 `RecordState` 推进状态机（真实部署外部审核结论走这条）：`审核通过`→`external_approved`（签发终态，`markReportApproved`）、`审核不通过`→等价 report_edit 退回**；**软触发** `POST /report-feedback`（外部回执，仅演示手动用，approved/needs_revision 与 1.3 共用同一 `rework-ops` 原语）—— 两者经 `services/rework-ops.ts` 共用同一状态机原语：`reports.external_status='external_revision'`+`stale`（migration 028）+ 建工单（data_entry 把报告 `record_data_ids` 全部 reject+建 scope=record 工单；report_edit 建 scope=report 工单）；前端 `pages/Report/Workbench.tsx` 取号报告卡（**`data_rework_open`→「等待实验室数据重新审核」锁定态，禁用 编辑/重生成/送审**）+「历史版本」抽屉（`/reports/:id/versions`）+「外部返工」面板（改报告/升级到录入/驳回） | **文员侧锁**：`data_entry` 退回后报告有未关闭 `data_entry` 工单＝锁定（`hasOpenDataEntryRework`，`/requisitions/generate` 跳过 + `/deliver` 409）；**匹配口径＝工单 `report_id=本报告` OR 工单 `record_data_id ∈ 本报告 record_data_ids`**——故文员从「录入进度／报告编辑器·退回原始记录」退回（工单常只带 record_data_id、无 report_id）也能正确阻断引用该记录的报告。重审通过自动 stale+关单（`record-data.ts`，按 record_data_id）→**自动解锁**→文员重生成抓新数据→重走 1.4 `/requisitions/:id/deliver` 回传。重生成保留旧报告为历史版本（`superseded_by`，migration 034）。设计 `待实现内容.md` §7.4 |
| 版本回退（恢复到历史/生效版本） | `services/template-versions.ts` 的 `rollbackToVersion`，按"目标是否=当前生效版本"+"是否有未定稿"分流：**①有未定稿草稿/待审(open=draft/pending)时**：·目标=当前生效版本→内容与生效版一致＝无真实改动→**直接 DELETE 草稿行丢弃**（不留草稿、不送审，回到干净生效态），返回 `{discarded:true}`；·目标=历史(superseded)版本→内容确实不同→把草稿内容**重置**为该版本（仍是草稿、不送审，复用 `createDraft` UPDATE 分支）；pending 一律**先 `withdrawVersion` 撤回审核**（含"仅提交人/审核员"权限校验 403）。**②无未定稿**→克隆为新草稿→submitForReview→pending，走正常审核生效。rejected 冻结历史仍拒绝（先处理）。删除草稿行安全：`template_audit_log.version_id` 无 FK，draft 也不被 `record_data`/`parent_version_id`/`current_version_id` 引用。路由 `POST /:id/versions/:vid/rollback`（record+report 都有）；前端三处入口（`TemplateVersionPanel` 历史抽屉 + 三个编辑器历史只读视图顶栏）：superseded 恒有「恢复此版本」；approved 在有未定稿时显示「恢复为此版本」 | 历史只追加不破坏；恢复为生效版本＝丢弃草稿（不会凭空留下需审核的草稿）；重置/丢弃后都无需审核；旧记录版本锁定不受影响。审计 detail：`discard_draft`(丢弃)/`reset_draft`(重置)/`withdrew_pending` 标记区分；pending 撤回另记 `withdraw {via:'rollback'}` |
| 改模板版本流（draft / submit / withdraw / review） | `server/services/template-versions.ts`（通用 helper，record / report 共用） | `routes/record-templates.ts` + `routes/report-templates.ts` 调用同一组 helper。**修改说明（change_summary）在「提交审核」弹窗填写**（`TemplateVersionPanel` 的 submitModal），随 `POST /:id/submit` 的 `change_summary` 经 `submitForReview` 的 `COALESCE` 写入本版本。**草稿槽位语义（migration 022）**：pending 不可被 PUT 覆盖（409，需先 `withdraw`）；rejected 冻结为不可变历史，再编辑/重提自动开新版本号行；draft 保存带 `draft_updated_at` 乐观锁，不一致 409（前端弹「保存冲突」） |
| 改模板审核界面（修改说明 + 属性级 diff + 新旧 PDF 对比） | `TemplateVersionPanel.tsx` 的 `ReviewDrawer`（调 `GET /:id/versions/:vid/diff` 实时算，PDF 走编辑器同款 `shared/typst-generator` + mock 预览管线） | diff 引擎在 `shared/template-diff.ts`（按 `field.id` 配对 + 属性级 from→to；兼容渲染 migration 014 旧格式 `{key,kind}`） |
| 改模板操作审计日志（谁何时做了什么） | `services/template-versions.ts` 的 `logTemplateAudit` / `listAuditLog`（表 `template_audit_log`）；routes 在 create/rename/archive/restore/controlled/update_draft/submit/withdraw 埋点，service 在 approve/reject/fork/sync 随事务埋点 | UI 在 `TemplateVersionPanel` 历史 Drawer 的「操作日志」Tab（`GET /:id/audit-log`） |
| 改 fork / lineage / 母子同步行为 | `services/template-versions.ts` 中 `forkTemplate`（fork 时写 `field_mapping` 恒等映射）/ `getLineage`（递归 CTE）/ `syncToChildren` + `computeSyncedFieldDefinitions`（纯函数：替换/删除映射字段 + **同步分区改名/布局** + 可选带入母版新增字段、子模板自建字段不动）。**母模板审核通过即强制自动同步**：`reviewVersion` approve 后自动对所有有映射的直接子模板 `syncToChildren`（每个生成 pending，各自重审；有未定稿/无差异的子模板跳过并在 `child_sync` 返回里说明） | `TemplateVersionPanel.tsx`：审核通过提示里展示自动同步结果（应用 N 个/跳过 M 个）；`LineageDrawer` + `SyncWizard` 仍可手动再同步。改名/改属性/删除都会同步（不只是新增） |
| 改模板版本面板 UI | `TemplateVersionPanel.tsx` 渲染模式：`actionsOnly`（行内按钮组，`buttons` prop 选子集——列表页据此把按钮拆进 版本管理/关联关系/操作 三列）/ 默认（编辑器顶栏完整状态条）/ `compact`（小 tag，目前已无调用方，保留兼容） | 「查看此版本」跳编辑器只读模式（`?id=X&version_id=Y`，三个模板编辑器都支持）；`editorPathBase` prop 决定跳哪个编辑器。**三个模板编辑器顶栏都内置该面板**（提交审核/历史/回退/归档/血缘）——record 传 `kind="record"`，cover/project 传 `kind="report"` + 各自 `editorPathBase`（cover/project editor），版本元信息由各页 `versionMeta`(current_version_no/open_draft) 提供（report 侧走 `useReportTemplateEditor`） |
| 改报告模板编辑器（首页/项目）的公共外壳 | `client/src/pages/ReportTemplate/useReportTemplateEditor.ts`——CoverEditor + ProjectEditor **共享** hook：加载（只读历史版本 / 草稿续编 / `dedupeTemplateIdentity` 自愈）、保存（PUT report-templates + 409 冲突 + 草稿乐观锁 + `binding_warnings`）、未保存守卫、版本元信息（`versionMeta`，供顶栏 `TemplateVersionPanel`）、编辑器⇄PDF 跳转、示例数据开关。页面特定的部分（首页页眉页脚 UI、项目关联记录+binding 校验、各自预览 typst）留在各页，项目用 `onLoaded` 回调按 `linked_record_template_id` 拉关联记录 | 抽此 hook 前 cover/project 两页各复制 ~150 行加载/保存逻辑；record 编辑器（含 POST 建模板/受控登记/试录）差异较大，暂未并入，仍各自实现 |
| 改编辑器「能力开关」（三种模式差异集中映射） | `FieldEditor/field-types.ts` 的 `editorCapabilities(mode)` → `{ projectName, titlePanel, autoTitleToggle, conclusionField, valueBinding, linkedRecordBinding }`，替代散落在 `index.tsx`/`DocumentStylePanel`/`FieldPropsPanel` 里的 `editorMode === 'record'` 等判断。加第四种编辑器或调某项归属只改这一张表 | 设计原则：三者差异都是"录入模板 vs 报告映射/版面"的**语义**差异（编辑核心三模式共用同一 `FieldEditor`），不是缺功能 |
| 改模板列表树形分组 / 待审过滤 / 高级搜索 | `client/components/template-tree.ts`（buildTemplateTree / filterTemplateRows / applyTemplateSearch，两个列表页共用）+ `components/TemplateSearchBar.tsx`（关键字/状态/修改人/时间范围/母子范围，纯前端过滤）+ `pages/RecordTemplate/List.tsx` + `pages/ReportTemplate/List.tsx`。报告模板列表的「首页/项目」tab 受控于 URL `?tab=cover\|project`——Cover/Project 编辑器「返回」各自带 tab 参数，从哪个 tab 进就回哪个 tab | 列表 API 的 `last_activity`（GREATEST(base.updated_at, 版本行最新时间)，列名「最近修改时间」，dayjs `YYYY-MM-DD HH:mm` 防换行）与 `current_author`；「全部」=母子嵌套树按子树最近修改排序，「待审核/我的草稿」=平铺过滤。**列结构**：版本(vN) / 状态 两列分开（状态列还会叠「删除待审」红 tag）；按钮拆三列——版本管理(版本历史)、关联关系(派生关系)为**紫色文字型图标钮**，操作列(+子模板/编辑/提交审核\|审核\|撤回/删除审批)为**描边图标钮**（`TemplateVersionPanel` 的 `buttons` + `iconOnly` props；流转主操作保留文字），全部带 Tooltip、单行不换行 |
| 改模板删除审批流（申请→审核员批准/驳回/撤销） | `services/template-versions.ts` 的 `requestArchive / cancelArchiveRequest / reviewArchiveRequest` + 两个 routes 的 `performArchive`（record 含 force 解除报告引用，report 简单归档）+ `client/components/TemplateArchiveButton.tsx`（按角色/状态四态按钮 + 申请/审批 Modal） | 约束与版本审核一致：申请人≠批准人、仅 reviewer 可批、驳回必填备注；直接 DELETE 已停用（403）；审计动作 archive_request / archive_request_cancel / archive_reject / archive |

### 数据 / API

| 想做的事 | 主要文件 | 配套要看 |
|---|---|---|
| 加 / 改 DB 表 | `db/migrations/NNN_xxx.sql`（**不要改已存在的**）+ 跑 `pnpm migrate` | 改类型同步 `shared/types.ts` |
| 加新 API | `server/src/routes/` 加文件 → `server/src/index.ts` 注册 → 前端在 `client/src/api/` 或页面内 fetch | — |
| 加预览用 mock 数据 | `shared/mock-data.ts` 中 `generateMockValue()` 按字段类型分支；或 `FieldDefinition.example_value` 单字段覆盖 | `RecordTemplate/Editor.tsx` 顶部「示例数据 / 空白」开关 |

### 接真实接口（最大遗留）

| 任务 | 改什么 |
|---|---|
| 接委托单数据源 | 把 `services/seed-work-orders.ts` 的 hardcoded 数组改成轮询 / 订阅外部系统并写入 `work_orders` 表。前端、API、关联模型完全不动。`payload` JSONB 结构对齐 `example.json` |
| 接 SSO | 1) `client/auth.tsx` 改为从 SSO 拿 token + userInfo 2) axios 拦截器 `Authorization: Bearer` 3) 后端 `services/template-versions.ts` 中 `readActor()` 替换为 session/JWT 解析 |


---

## 六、关键约定 / 容易踩坑

### 嵌套分区（子分区）限一层 + 存储平铺

`FieldGroup.parent_group_id` 指向顶级分区 id ⇒ 子分区；**只允许一层**（编辑器限制：「+子分区」仅顶级、「移入分区」仅限无子分区的顶级）。存储仍是平铺 `groups[]`——diff/母子同步/矩阵展平/Excel 导入等平铺遍历逻辑全部无感知；渲染端一律经 `shared/group-tree.ts` 的 `buildGroupTree` 分桶（顶级按数组序、同父子分区按数组序、归属与数组位置无关、悬空 parent 按顶级处理）。删父分区连删子分区；`dedupeTemplateIdentity` 改分区 id 时会同步更新子分区的 parent 引用；母子模板同步追加分组时 parent_group_id 按分组映射翻译成子模板侧 id。

### shared/ 是单一事实来源

前后端都 import 它。改类型一定要两边一起跑通。

### 数据库连接池：只用 `server/src/db.ts` 的共享单例

后端**全进程只有一个连接池**，定义在 `server/src/db.ts`。所有路由 / service 都 `import { pool } from '../db.js'`，**不要**在路由里再 `new Pool(...)`（早期 14 个路由各建一个池＝14 套连接、配置重复、高并发下打满 PostgreSQL 连接上限——已统一）。池大小由 `DB_POOL_MAX` 控制（默认 20）。这是长生命周期单例，**任何请求处理里都不要调 `pool.end()`**（会把整进程的连接关掉）。

### Typst 编译：三级缓存 + 并发闸门

`server/src/services/typst-compiler.ts` 每次编译都 `spawn` 一个 typst 子进程（CPU 密集）。报告 PDF 之前在**每次查看/下载/回传**时都用 `final_typst` 现编译，只有进程内 LRU（100 条）兜底——重启即失、超 100 条被挤掉、多进程各编各的，是 200 人并发的 CPU 大头。现在 `compileTypst` 走**三级缓存**：

1. 进程内 LRU（最快）
2. **磁盘缓存**：按 sha256 落盘（`TYPST_CACHE_DIR`，默认 `<tmpdir>/cdr-typst-pdf-cache`；`=off` 关闭）。重启/超 LRU/跨进程仍命中 → 每份报告内容只编译一次。
3. 都没命中才 spawn typst 编译，产物同时写 LRU + 磁盘。

**自动失效**：缓存键 = sha256(**渲染环境指纹** + `source`)。报告改了 → `final_typst` 变 → 键变 → 自然 miss 重编。渲染环境指纹 = `typst-packages/` 主题源（按文件内容）+ `fonts/` 内置字体（按 size/mtime）——**改主题（如 record-theme 的 `#field`）或换字体后旧缓存自动失效**，不然同一份 source 会命中旧 PDF（脏缓存，踩过：改了 field 悬挂缩进、预览还是旧排版）。指纹在进程启动时算一次，dev 下改主题文件要重启 server 才生效（`tsx watch` 只盯 `src/`，改 server 代码会自动重启、改 `typst-packages/` 不会）。磁盘缓存可随时清空；文件数超 `TYPST_CACHE_MAX_FILES`（默认 2000）按 mtime 淘汰最旧。

**并发闸门**：同时在跑的 typst 进程数限制在 `TYPST_MAX_CONCURRENCY`（默认 4），超出排队，防高并发 fork 打爆机器。缓存命中（LRU 或磁盘）**不**占槽位（先查缓存再进闸门）。调大上限看机器核数。

### 矩阵展平键格式

```
{matrixCode}__{sampleId}__{paramCode}            # 数据格
{matrixCode}__summary__{rowId}                   # 汇总行（无 paramCode）
{matrixCode}__summary__{rowId}__{paramCode}      # 汇总行（有 paramCode）
{matrixCode}__sumcol__{colId}__{sampleId}        # 汇总列
```

这些键**不写入** `record_data.raw_data`（`stripMatrixFlatKeys` 会剥掉），只在运行时 / 渲染时存在。

### 计算顺序（录入和 PDF 必须一致）

```
矩阵单元展平 → 单元格/列级公式 → 汇总行公式 → 汇总列公式 → 模板级 computed_field 拓扑排序
```

两侧入口：`FormRenderer/index.tsx` 中 `computeDerivedMerged` + `shared/typst-generator.ts` 中 `flattenDataForDisplay`。**改一边记得改另一边**。

⚠️ **必须按【实际样品行】迭代，不能用 `default_sample_count`（2026-06 修，回应"录入时增删行后汇总行平均值不更新/算不到"）**：录入端增删样品行用的 sample id 是 `s{时间戳}`（`FormRenderer.addSample` 的 `s${Date.now()}`），**不再是 `s0..s{default-1}`**。`matrix-flatten.ts` 的 `applyMatrixCellFormulas`（列级公式）/`applyMatrixSummaryFormulas`（per_column_aggregate 平均值、汇总列 per_row_aggregate）/`collectMatrixSummaryDataKeys`（汇总列 per-sample 取键）原先都按 `for i<default_sample_count` 拼 `s${i}` 迭代 → 增删行后样品 id 对不上、汇总算空（平均值显示 —）。改为统一用 **`deriveMatrixSampleIdsFromFlat(flat, code)`** 从 flat 键派生**实际样品 id**（排除 `summary`/`sumcol`），所有汇总/列公式按实际样品迭代；`collectMatrixSummaryDataKeys(template, flat?)` 加可选 flat 参数（有则按实际样品收汇总列键，`computeDerivedMerged` 传 `result`）。一处改、录入+报告+渲染三端齐修（`applyMatrixSummaryFormulas` 被 FormRenderer/reports.ts/typst-generator/mock-data 共用）。

### 样式层叠（文档 → 区块 → 字段，P1）

`StyleOverride`（`shared/types.ts`：font/size/weight/italic/color/align/line_height/**tracking**/**vertical_align**/**block_spacing**）可挂在 `FieldGroup.style`（区块级）与 `FieldDefinition.style`（字段级），缺省＝继承上层（文档默认 `theme_config` → 区块 → 字段）。渲染：`shared/typst-generator.ts` 的 `styleSetRules()` 把它编译成 `#set text(...)`/`#set par(leading:...)`（**`tracking` 字距也在此 emit**；**`block_spacing`→`#set block(spacing:)` 控制分区内字段/表格之间的间距，区块级「格式·字段间距」**），`applyBlockStyle()` 再套水平对齐 + `#v(段前/段后)`。**区块级 set 规则会级联进该区块所有内容（含 `#field`/内联/矩阵）**，所以"不同区块不同样式"天然成立；**字段级作用范围**：普通 `#field`（vertical 分区）✅ + **two-col / grid**（`renderMultiCol`/`cellFieldInner`，P14 起 label_style/value_style 生效；中/右对齐 break out 成整行跨页对齐）✅；inline（`inline-fields` 主题函数）/ 矩阵单元格的字段级样式仍待后续期。**字段名 vs 字段值分开配（P14·14.2）**：`FieldDefinition.label_style`/`value_style`（各一份 `StyleOverride`，仅文字属性 font/size/weight/italic/color）渲染为主题 `#field` 的 `label_args`/`value_args`（`fieldPartTextDict()` → splat 进各自 `text()`），与 `field.style`（承担字段整体版式：对齐/段前后/缩进/行距）正交叠加。`hide_label` 段把 value_style 套在值上。**对齐跨整页**：vertical 分区里 `align` 直接跨整页（⚠️ **`hide_title` 分区的外层包裹必须 `#block(width: 100%)`**——缺省 `#block` 收缩到内容宽度，内部 `#align` 没有可对齐空间，表现为"对齐只在左半/无效"，`renderGroupEntry` 已修）；**two-col/grid 分区里，中/右对齐的字段会从网格里 break out 成整行独立块、跨整页对齐**（`renderMultiCol`：左对齐/未设＝留在 1fr 列内流动，中/右＝拎出来整页对齐；字段级优先、否则继承分区级 `group.style.align`，故"分区设居中"＝该区字段都整页居中）。UI：区块头「格式」Popover（`FormatPanel`，传 `block` 时多一档「垂直对齐」）+ 字段属性面板的「格式」段。**文档↔分组间距命名统一 + 可见层叠（2026-06）**：文档样式面板的 `line_gap` 叫**「字段间距」**(全局默认)、`paragraph_gap` 叫**「分组间距」**；分组面板的 `line_height` 叫**「行间距」**(par leading，≠字段间距)、`block_spacing` 叫**「字段间距」**(覆盖文档默认、仅该组)。两处"字段间距"是同一属性的默认/覆盖关系（`#field` 默认 gap=line_gap，分组经 `gap:` 覆盖）。①文档「字段间距」旁有「应用到全部分组」入口，一键清掉各组 `block_spacing` 覆盖（同 `setLabelWeight` 的"统一=清下级覆盖"）；②分组「字段间距」placeholder 显示继承的文档值（`FormatPanel` 的 `inheritedFieldGap` prop，`FieldEditor/index.tsx` 透传 `theme_config.line_gap`），「行间距/字段间距」被覆盖时各有「↩恢复继承」只清该项。**图/表也响应字段间距（2026-06 修）**：文字字段靠 `#field(gap:)` 撑间距，但矩阵/报告自动表/图片是裸 `#block`/`#table`、原先只认 Typst 默认块距 → 文档级「字段间距」调不动图表（尤其图↔图）。`generateGroupContent` 给每个分区补一条 `#set block(spacing: <分区 block_spacing ?? 文档 line_gap>)`（即 `sectionGap`），让图/表与文字统一响应文档级/分区级字段间距（分区 block_spacing 已设时由 applyBlockStyle 负责、此处只补"未设"档；分区设置覆盖文档、仅作用本分区）。**`sectionGap` 已提到函数顶部并前置到 `section_role='images'` 的早返回**——否则图片记录分区（走 `generateImageGroupContent` 早返回）会绕过它，多张图片之间的间距冻结、不随字段间距变（2026-06 补）。**无标题分区之间（分区↔分区）也随字段间距（2026-06 补）**：`sectionGap` 只管分区**内部**块间距；**无标题分区**（`renderGroupEntry` 的 `hide_title` 分支 → 裸 `#block(width:100%)`，如项目报告里检测方法/结果表/图片/设备各独占一个无标题分区）彼此之间原本走 Typst 默认块距 → "分区内字段间距大、分区之间(图↔表)间距小"。修法＝给该 `#block` 加 `spacing: <分区 block_spacing ?? 文档 line_gap>`，使相邻无标题分区按字段间距等距。**有标题分区（`#section`）之间仍走 `v(paragraph_gap)`＝「分组间距」**（有可见标题分隔，是另一档）。**图/表内部的「标题↔图、图↔备注」距离与字段间距隔离（2026-06 补）**：`wrapFigure` 把标题+图+备注包进一个 `#block[#set block(spacing:0pt) …]`，内部间距清零，使这两段距离**完全由 `label_gap`/`caption_gap`（标题块 below、备注块 above/below）决定**；否则分区级 `#set block(spacing:字段间距)` 会作为图/标题/备注块的默认 above/below、并以"取较大值"盖住较小的 `label_gap`/`caption_gap`（表现为：标题/备注离图的距离调小无效）。外层块自身仍继承分区「字段间距」与相邻分区等距。**`space_before/after`（段前/段后间距）已渲染**（`applyBlockStyle` emit `#v()`）——把块往下压 / 块间留白，用于首页/封面这类竖排版面，替代自由拖拽定位。

**模块定位（钉底/居中 + 偏移 + 不拆页，回应"签字区自动钉到所在页底部"）**：区块（或「模块」）的竖向锚定。
- **`vertical_align`（center/bottom，仅区块级）** = 整页垂直分布——渲染时在**页流层**（不是 `#block` 内，块内 `1fr` 不撑开）注入 `#v(1fr)`：center=内容上下各 1fr 居中、bottom=上方 1fr 钉底（自动落在所在页底，第1页放得下钉第1页、溢到第2页钉第2页）；**只对顶级分区有效**。
- **`vertical_offset`**（如 `2cm`）= 钉底后再往上抬，给印章/二维码留位 → `#v(offset)` 在模块后。
- **`FieldGroup.module_span`**（如 3）= 把「本组 + 后续 span-1 组」当一个**模块**整体锚定（如 签字+签发+备注）。
- **`keep_together`** = 模块包进 `block(breakable:false)` 不拆页。
- 渲染：`generateTypst` 的 group 循环改为下标遍历、`renderGroupEntry` 渲染单组、模块整体加 `#v(1fr)`/`#v(offset)`/`breakable:false`。编辑器：`FormatPanel`（block）「定位」段——随正文/居中/钉底 + 距底(cm) + 整块不拆页。
- ② **`tracking`** = 字距（封面"检 验 报 告"那种拉开），替代手敲全角空格。③ **`spacer` 字段类型** 见下。② **`tracking`** = 字距（封面"检 验 报 告"那种拉开），替代手敲全角空格。③ **`spacer` 字段类型**（`FieldType='spacer'`，`spacer_height` 固定 cm/pt/em）= 可插入的「间隔（空白）」块 → 渲染 `#v(高度)`，对应 Word 敲回车留白。**`spacer` 是纯版式、无数据**：不进 `#let data`（`collectTypstDataKeys` 跳过）、不进 `raw_data`、`mock-data` 跳过、录入端 `FormRenderer` 渲染成不可交互占位条。`margin`（`{top/bottom/left/right}`）**已渲染**（`applyBlockStyle` → `#pad(...)`，`left` 用于横向缩进定位，如把"签发日期"推到页中右）；`width`（字段宽）仍待后续。

**报告封面/首页复刻相关能力（2026-06，向后兼容，目前经模板 JSON / upsert 脚本设置，编辑器 UI 暂无开关）**：
- `layout_options.suppress_title`：正文不出大标题（标题已在页眉重复时用，避免一页两个标题）；`generateTypst` 据此把传给主题的 `title` 置空。配合 `layout_options.subtitle=''` 连副标题也不出 → **"只渲染字段"**（主题 `record-theme` 对空 `title`/`org` 不渲染、连顶部间距也省）。编辑器：`DocumentStylePanel`「只渲染字段」开关一键设这两项。
- `FieldDefinition.label_bold`（true/false/缺省跟随文档 `label_weight`）：**单独控制某字段名（标签）加粗**（如"检测要求/检测结果"加粗、其余不加）。生成器把它传给主题 `#field(..., label_bold:)`。**P14 起已被 `label_style` 取代**（@deprecated）：简单值类型的「字段名」段用 `label_style`（字体/字号/加粗/斜体/颜色，写入时清空旧 label_bold）；`label_style.weight` 未设时生成器仍回退读 `label_bold`，存量模板零改。复杂类型的旧「格式」Tab 仍保留 label_bold 三档。⚠️ **文档级「字段标签」加粗/正常会清掉所有字段的 `label_bold`/`label_style.weight`**（`DocumentStylePanel.setLabelWeight`），让统一设置真正落到全部字段——这是"文档级 vs 字段级"覆盖关系的有意取舍：document 统一动作以"清字段级覆盖"实现 apply-to-all。
- **faux-bold（仿宋/黑体/楷体等无粗体字体的加粗）**：`FandolFang` / 仿宋 `FangSong(_GB2312)` / 黑体 `SimHei` / 楷体 `KaiTi` 都只有 Regular 字重，Typst 对缺字重字体**不合成粗体**，故 `weight:"bold"` 无反应（页眉「检测报告」、字段标签加粗都看不出）。主题 `_nobold-font()` 与生成器 `isNoBoldFont`（命中 `/Fandol|FangSong|SimHei|KaiTi/i`）改用**描边 `stroke: 0.03em`** 模拟粗体。有真粗体的字体（`Songti SC` 等）仍走 `weight`，行为不变。新增单字重字体时记得加进这两处判断。**faux-bold 覆盖面（2026-06 补全）**：早期只有 `#field` 标签/值（经主题 `_bold`）和 `styleSetRules` 走 faux-bold；**分区标题、文档大标题、子分区标题、表格/多列字段标签、签名标签、矩阵表标题、检测结论表标题**等"`#text` 直接加粗"处当时**漏了**（仿宋下这些都不加粗）。现统一：① 生成器 `fauxBoldStroke(font)` 给所有 `#text(weight:700)` 直发处补描边；② 标题专用 `titleTextArgs(style, defaultSize)`（weight+描边+字号+字体/斜体/颜色）供顶级/子分区标题共用；③ 主题 `#section` 默认标题改走 `_bold(...)`、有 `title_args` 时直接套生成器算好的参数；④ 主题文档大标题（`record-theme` 标题块）改 `_bold(text(..title_args)[title], on: weight 是否加粗)`；⑤ **全局 `#show strong`**：主题对 `*粗*` markup / `#strong`（表头 `[*…*]`、富文本 `**粗**`）补 `text(stroke)`（仅 `_nobold-font` 命中时，保留 weight 故西文真粗体不丢）——一处覆盖所有表头/富文本加粗。⚠️ 任何新增"`#text(weight:700)` 直接加粗"代码都要带上 `fauxBoldStroke()`（`*…*` markup 已被全局 show 兜底，无需手动）。字体下拉（`DocumentStylePanel`/`FormatPanel`）已加「仿宋（FandolFang·免费）」(值 `FandolFang R`)；本机预览需装该字体（已随 TeX Live 提供，复制到 `~/Library/Fonts`），生产环境用 `仿宋_GB2312`。
- `FieldDefinition.signature_line`：渲染成「标签 ＿＿」下划线签名格；同组多个 → `generateSignatureRow` 等分整行（编制/审核/批准）。值（签名）在线上居中。**同一分区里的非签名字段（签发日期/备注等）照常竖排渲染在签名行下方**——所以「签字+签发+备注」可合成**一个分区**（如首页模板的「签字栏」组）。**2026-06-29 起该分区在编辑器里整段【置灰只读】**：含 `signature_line` 字段的分区即「签发/签字栏分区」（判定 `isSignatureGroup`，`section-presets.ts`），在 `FieldEditor`（首页/项目模板）与 `InstanceEditor`（文员"编辑首页"）里都**不可改字段/值/排版/拖拽**（版面按参考样张固化、签发日期/备注由接口取号自动填）。**实现＝渲染与普通分区完全一样的字段行（排版/样式不变），只外包 `pointerEvents:none + opacity` 置灰屏蔽交互**（不是另画一个简化预览，避免"变丑"）。**例外·仍可改两项**：① **位置**——分区卡上有「位置」`Segmented`：跟随正文(`vertical_align` 空)/居中(`center`)/底部钉底(`bottom`)，写 `group.style.vertical_align`（保留 `keep_together`）；② **整段删除/添加**——FieldEditor 分区头删除钮仍在、`SECTION_PRESETS` 的「签字栏（首页）」(`signature_block`，`editors:['report-cover']`)仍在「添加分区」下拉里（仅 `report-cover` 即首页模板编辑器可见；`InstanceEditor` 无分区级增删，需在模板编辑器做）。
- `theme_config.label_width`：字段标签固定列宽（含冒号），使所有字段「值」对齐到同一制表位（公文/报告版面）；缺省 none＝行内紧贴（原行为）。主题 `#field` 实现。**可被分区级 `FieldGroup.label_width` 覆盖**（`'none'`=该区紧贴 / `'<len>'`=该区对齐宽度 / undefined=跟随文档）——`#field(..., label_width: auto|none|<len>)` 参数，`auto` 跟随文档全局。仅竖排字段；多列已行内紧贴。
- `conclusion_table.column_labels`：结论汇总表列表头文字覆盖（如"项目"→"检测项目"）。
- 上述能力曾用于复刻样例「测试报告」前两页（`scripts/front-template.ts` + `scripts/upsert-front-template.ts`）。**该复刻已按用户要求回滚**：DB 首页模板 id=9 已恢复到原版本 v1，未保留复刻内容。这些渲染能力本身向后兼容、保留可复用。

### 未保存守卫（四个编辑器 + 录入页，2026-07 修过一轮误报/漏报）

`hooks/useUnsavedGuard`（beforeunload + 返回按钮三选一弹窗）接在：记录模板编辑器、报告首页/项目模板编辑器（`useReportTemplateEditor`）、报告实例编辑器 `InstanceEditor`（此前**没接**，返回直接丢改动）、录入页 `Lab/Record.tsx`。三条脏判定规则，破坏任何一条都会复发"没改也提示 / 保存了还提示"：
1. **只读态豁免**——历史版本查看/送审中 pending/`?readonly=1` 时守卫恒不脏（加载期补名/规范化 setTemplate 不算用户改动；记录编辑器历史视图补模板名时也同步刷快照）。
2. **保存与快照取「最新」状态**——`handleSave` 一律读 `templateRef/docRef`（每次渲染同步的 ref），不用点击时闭包里的 state；否则输入控件 onBlur 提交与点保存竞态时，保存的是旧内容、快照停在旧内容，离开时仍误弹。
3. **录入页基线在自动注入之后算**——矩阵默认行/审核字段注入（`injectAuditFields`/`ensureDataMatrixDefaults`）不是用户改动，基线签名必须对注入后的 data 计算（此前新建录入一打开就误报）。

### 文本换行（值里的 \n 会真的换行）+ 字段值悬挂缩进

Typst 正文默认把单个换行折叠成空格。主题导出的 `#let multiline(v)`（`record-theme/0.1.0/lib.typ`）把值里的 `\n`→`linebreak()`、空行 `\n\n`→`parbreak()`；生成器的 `#let __cell`（`typst-generator.ts`，矩阵/内联单元格）走它。所以**多行文本框字段、报告里手填的多行文字，在 PDF 里就按所敲的换行渲染**。普通单行值原样不变。注：报告结果表单元格（`renderReportResultTableTypst` 里 `[#escapeTypst(...)]`）目前未过 `multiline`，需要时再扩。

`#field`（主题）**不走 multiline**：值内 `\n` 在 field 内部直接转 `linebreak()`（`\n\n` 渲成空一行），并且整段用 `par(hanging-indent: 标签宽)` 包裹——**多行值（如多台测试设备各占一行）或长值自然折行时，第二行起对齐到「标签：」之后的值起点，不再顶格**。缩进量：设了 `label_width` 制表位就用它，否则 `measure()` 实测标签宽；标签总是装进 `box(width: indent)`，首行值起点与悬挂缩进在构造上严格相等。三个坑：① `#set par(hanging-indent)` 对 block 内松散行内内容**不生效**（Typst 0.13+ 不把它包成 par 元素），必须显式 `par()`；② `par()` 里出现 `parbreak()` 会被吞掉并告警——所以 field 值的空行按两个 `linebreak()` 渲染、不走 multiline；③ **不能直接 `measure([标签：])`**——全角冒号在测量时位于"行尾"，CJK 标点调整裁掉其尾部空白，量出来偏短约半个冒号、第二行左漂（系统字体下不明显，`fonts/` 内置中文字体下必现）——要带一个尾随汉字测量再减去汉字宽取全宽 advance。

### 报告 v2 vs v3

- v3 的 `FieldGroup[]` 是主路径
- v2 的 `blocks[]`（在 `report-blocks.ts`）仍可读但不要再扩展
- 新功能加在 v3 一侧（`injectReportFieldsIntoTypst`）
- `reports.ts` 的 `buildReportTypst()` 同时兼容两套，优先走 v3 groups

### 报告·检测结果表的"汇总列"是跨行单格

`summary_cols[].binding` 是单一 binding（不是按 rowId 的字典）。Typst 用 `table.cell(rowspan: rows.length)`；编辑器 UI 用 `<td rowSpan>`。改过结构的话注意旧数据可能还有 `cells: { rowId → binding }` 字段，删掉重加即可。

### `variant_list` 字段类型已废弃

原 base-template 的"预处理条件"和"试验环境"已改为普通 `select` / `number` 字段。代码（`flattenDataForDisplay` 等）保留兜底渲染逻辑，但 UI 不再允许新建。遇到旧 `variant_list` 字段在编辑器里会显示橙色警告 + 「转为普通单选」一键按钮。

### 报告部件：封面 / 首页 / 项目（P3）

报告可由三类部件组成（`ReportTemplateKind`）：`cover_page`=**真·封面（标题页）**、`cover`=**首页（结论汇总，历史命名）**、`project`=**项目报告**。
- 封面是 P3 新增的独立报告模板类型；其文字（标题/编号/委托信息）用 `CellBinding`（order/literal 等）绑定，版式用样式层叠（P1：字体/字号/对齐/段距），**Word 式调整、不做拖拽**（封面是居中竖排版面）。
- 组装：`buildReportTypst` 接可选 `cover_page_template_id` → 装进 `content_doc.front_cover`；`renderContentDoc` 把封面**插在首页 `#show` 行之后、首页 `#let data` 之前** + `#pagebreak()`，所以**首页那条 `#show` 仍统管全文页眉页脚**（封面目前与全文共用页眉页脚，"封面不出页眉"是后续 first-page-different 细化）。
- `generate-by-order`/`generate-batch`/`preview` 均接受可选 `cover_page_template_id`。无封面时 `front_cover` 缺省，渲染路径与改造前完全一致。
- 前端（P3.2 已实现）：报告模板列表「新建封面」+ 封面分组（复用 cover 编辑器 + P1 格式面板调标题/委托信息）；报告工作台可选「封面模板」下拉 → 生成/预览传 `cover_page_template_id`。`InstanceEditor` 整份深拷贝 `content_doc`，**`front_cover` 在编辑保存时自动保留**、重渲染（`PUT`/`preview-content-doc` 均把整份传给 `renderContentDoc`）。
- ⏳ 仍待做：在实例编辑器里**直接编辑封面段**（目前封面在模板期定稿、实例期只保留不可编辑）+ `flattenContentDocValues`/`diffContentDocValues` 纳入 `front_cover` 的留痕；"封面不出页眉页脚"的 first-page-different 细化。

**首页图片字段：用「原样照片表」(`report_photo_table`)、不要用「图片表/图库」(`report_image_gallery`)**。首页是**订单级**、`coverCtx` 不含 `linked_record_template`，而 `report_image_gallery` 靠关联原始记录的 image 字段取图 → 放首页**真实报告也只会出「（未关联原始记录模板）」占位**（不只是预览）。首页的原样照片走 `report_photo_table`：文员直接上传（存 `field.photo_table.photos`、随 `cover_groups_override` carry）、无记录绑定，渲染 `renderPhotoTableTypst` 用 `#block(width:100%)` 撑满整页。编辑器预览：`report_photo_table` 由 `withMockPhotoTables` 注入示例照片；`report_image_gallery` 由 `CoverEditor.MOCK_CTX` 的 mock `linked_record_template`+`record_raw_data` 注入示例照片（仅预览，真实报告不经此）。两类图片表均已统一**满宽**（gallery 的 `renderReportImageGalleryTypst` 也包了 `#block(width:100%)`，与原始记录图片组/原样照片表同口径）。**首页种子模板 `scripts/front-template.ts` 的「原始样品」字段已从 gallery 改为 `report_photo_table`**——存量库里的首页若仍是 gallery，重跑 `tsx scripts/upsert-front-template.ts` 或在编辑器把该字段类型改成「报告·原样照片表」。

**首页三张自动表的标题/备注/间距编辑（统一走 `wrapFigure`）**：样品信息表 / 检测结论表 / 原样照片表的 renderer 都经 `wrapFigure`，和项目报告图表**完全同一套**：「基础」Tab 的**显示为标题**开关（标题文字＝`field.label`、**居左、跟随模板字体**，由 `hide_label` 控制）、**备注信息**（`field.caption`），「版式」Tab 的**标题样式 / 标题↔表距离（`label_gap`）/ 题注位置 / 备注样式 / 备注↔表距离（`caption_gap`）/ 对齐+段前后间距（`field.style`）**。这三类都已进 `FIGURE_LAYOUT_TYPES` + `NO_FORMAT_BINDING`，无特判分支。⚠️ **检测结论表不再自带居中标题**——`conclusion_table.show_title`/`title_text` 已废弃（renderer 不读，`@deprecated`），标题统一＝`field.label`；存量结论表标题会"消失"直到在「基础」Tab 开「显示为标题」（新建/seed 默认 `hide_label:false` 已开）。检测结论表与样品信息表「类型配置」均有**列宽**（旋钮+单位 fr/%/cm/pt，按列名存 `col_widths_map`；旧位置数组 `col_widths` `@deprecated` 仍兜底）和**行高**（`cell_inset_y`→`inset:(y:)`，与结果表/设备表同口径）。结论表列宽含样品列（多样品自动出现也可调）；样品信息表「列」做成逐列一行（显示开关+列名+列宽旋钮），**第一列默认＝`样品编号`**（值＝接口 `SampleSortNo`，非"序号"）。新增首页自动表类型时一并加进这两个列表 + renderer 走 `wrapFigure`。

### 报告页眉页脚（机构级元数据，按订单号注入）

报告每页页眉/页脚印一组机构级元数据（检验码/报告编号/公司信息/资质/签发日期），由外部按订单号回传（当前 mock：`services/external-report-meta.ts` 的 `fetchReportMeta`）。流向：`buildReportTypst` 按 `order_no` 取 `ReportMeta` → `buildHeaderFooterConfig()` 合成 → 写进**首页** `coverTpl.layout_options.header_footer` → 随 `content_doc` 快照冻结（重渲染走同一份，合规一致）→ `themeConfigToTypstDict` 序列化成 `header_footer:(...)` 传给主题 → `record-theme` 的 `set page(header,footer)` 渲染。

**版式对齐参考报告 .doc（`record-theme/0.1.0/lib.typ` 的 `_render-header`/`_render-footer`）**：页眉 = `title`（默认「检测报告」，字号由 `title_size`/`title_size_first` 定，参考 .doc=**24pt**）**居中、独占一行** → **下一行**右对齐两行 `校验码：… / 报告编号：…`（**10.5pt**，与标题分两行竖排）；行间距单倍（`set par(leading:0.3em, spacing:0.3em)`）；页眉与正文间有分割线，`header_rule:false` 时用 `hide(line())`——**线不可见但占位距离保留**（对齐 .doc 的隐藏分割线）；分割线**两侧各留 1.0 行间距**（`_hf-line-gap=14pt`≈正文 12pt 一行高）：`报告编号 →(v 14pt)→ 隐藏线 →(header-ascent 14pt)→ 正文`，避免页眉贴正文太近；页脚 = `公司名称`（**12pt 加粗**，居中）/ `公司地址`、`电话：… 传真：… 网址：…`（**9pt 不加粗**，居中两行）→ **下方**右对齐 `第X页共Y页`（**9pt**，页码独占一行、不与三行重叠）；行间距单倍（`set par(leading:0.3em, spacing:0.3em)`）；页脚顶部同样有**隐藏分割线**（`hide(line())`，`footer_rule` 缺省继承 `header_rule`），两侧各 1.0 行间距：`正文 →(footer-descent 14pt)→ 隐藏线 →(v 14pt)→ 公司名称`（与页眉对称，避免正文贴页脚太近）。每页标题字号一致取决于模板 `title_size`/`title_size_first` 设同值（首页模板设 22pt；若想首页更大才设不同值）。`buildHeaderFooterConfig` 增了 `title`（缺省「检测报告」，报告模板 layout 可覆盖）。注：为贴合该 .doc，页脚不再放 `qualification_note`/签发日期（如需另行安置）；logo/印章为图像，按决策不做。

**对齐封面 `1.1 报告封面 CN.doc`（2026-06）**：① 页脚联系行末尾加 **`网址：{website}`**（`ReportMeta.website` ← 接口⑦ mock `www.grgtest.com`；缺省空＝不渲染）；② 页脚 **公司名称加粗**（`_bold`，仿宋等无粗体字体走描边 faux-bold）；③ **页眉页脚字体独立固定 `header_footer.font`**（主题 `_render-header`/`_render-footer` 各自 `set text(font: hf-font)`，`_bold` 也按此字体判 faux-bold）——一旦定下就**不随编辑器改正文字体/行距而变**（编辑器 `DocumentStylePanel` 改的是 `theme_config`，与 `header_footer.font` 解耦）；缺省回退 `theme_config.font`（向后兼容）。首页模板设 `FandolFang R`（生产 `仿宋_GB2312`）。**页眉页脚行距对齐 .doc**（实测）：页眉两行编号 ≈14.7pt；页脚 公司名(12pt)→地址 16pt、地址→电话 12pt、电话→页码 12pt（显式 `v()` 控制，不再过密重叠）。位置（按参考 .doc `中文-CN-20250827.doc` 实测坐标对齐，2026-06）：**hf-on 时顶部页边距放大到 5.3cm**（容纳「标题独占一行 + 校验码/报告编号两行」三行页眉不裁切，避免大标题溢出页顶），`header-ascent:0.4cm` 把页眉钉到距顶≈79pt（标题）/110·125pt（编号两行）；`footer-descent:0.25cm` + 底边距 2.8cm 把页脚三行 + 页码钉到页底（公司名距底≈61pt、页码距底≈25pt，右对齐）。非 hf 模板维持原边距与 30% ascent（存量原始记录不受影响）。`buildHeaderFooterConfig` 现也透传版式键 `title_size`/`title_size_first`/`title_tracking`/`header_rule`（缺省由主题取默认）。

要点：① 整篇报告 cover+projects 共用**首页那一个 `set page`**（projects 的 `#show` 被 `renderContentDoc` 剥掉），所以页眉页脚在 cover 设一次即覆盖全文；② 首页报告编号用 `cover_report_no`、其余页用 `report_no`（主题用 `counter(page).get().first()==1` 区分，已 Typst 编译验证首页 `-1`、其余页基号）；③ 无 `header_footer` 配置时主题不出页眉页脚，**存量原始记录模板渲染不变**；④ 仅 v3 groups 路径生效（v2 blocks 路径不走主题）；⑤ 元数据字符串经主题 `#插值` 渲染为字面量、不被当 Typst 代码（无注入）。

**版式开关（版本化）**：首页报告模板编辑器 `CoverEditor.tsx` 顶栏可配「页眉页脚=标准/无」+「页码开关」，存进 `report_templates.layout_options.header_footer.{enabled, show_page_number}`，随模板版本走。出报告时 `buildHeaderFooterConfig(meta, layout)` 读这两个开关（缺省都为开）合进最终 config——即"**值来自外部、版式由模板定**"。编辑器预览用 `PREVIEW_HF_VALUES` 示例值填充以便所见即所得。

**页眉页脚几何「版式微调」（可调 + 实时预览，2026-06）**：CoverEditor 顶栏「版式微调 ▾」Popover 暴露**全部位置/行距旋钮**——`page_height`（页面高度，A4=29.7cm，参考样张=29.0cm；非 none 时主题用 `width:21cm + height`）、`top_margin`/`bottom_margin`（hf-on 时正文上/下边距=页眉页脚区，缺省 5.3/3.6cm）、**`header_gap`（报告编号↔正文间距=页眉侧）**、**`footer_gap`（正文↔页脚间距=页脚侧）**（已拆成两个独立旋钮，各缺省回退 `hf_line_gap`→14pt；`hf_line_gap` 保留为两侧统一兜底键，主题 `header-ascent`/`footer-descent` 分别读取 header_gap/footer_gap）、`header_leading`/`footer_leading`（页眉/页脚各自行距，缺省 0.55/0.4em）、`title_size_first`（首页标题字号）、**`title_gap`（标题"检测报告"↔校验码的额外间距，缺省 0pt）**、**`title_dx`（标题水平微调，缺省 0pt，`move(dx:)`）**、**`title_align`（标题左右对齐 left/center/right，缺省 center；字符串键不在 HF_LENGTH_KEYS）**。链路：存进 `header_footer`（随版本）→ `themeConfigToTypstDict` 的 `HF_LENGTH_KEYS` 按裸长度序列化（`title_align` 走普通字符串序列化） → 主题 `_render-header`/`_render-footer`/`set page` 用 `hf.at(key, default: 原值)` 读取（**缺省全=原硬编码值，向后兼容**）→ **生成期** `buildHeaderFooterConfig` 把这些键透传（否则只在编辑器预览生效、报告里丢失）。改完 CoverEditor 右侧 PDF 实时重渲。⚠️ 参考样张「1.1 报告封面 CN.doc」实测=**21×29.0cm（非标准 A4）** + 页眉距顶 2.75cm + 大字号 + 空段落排版，故首页 `page_height` 已设 29cm；其余位置交由该面板按需微调。字段放页眉/页脚的细粒度布局、实例期备注覆盖仍未做（见 `待实现内容.md` 6.6）。

**页脚标签约定（地址/电话/传真/网址）**：页脚三行＝公司名称（12pt 加粗居中）/ `地址：`+地址（9pt 居中）/ `电话：`+电话　`传真：`+传真　`网址：`+网址（9pt 居中）。**`地址：`/`电话：`/`传真：`/`网址：` 四个标签写死在主题 `_render-footer` 里，`header_footer` 的 `company_address`/`phone`/`fax`/`website` 只存纯值**（地址空值时整行不渲染，含标签）。预览示例值在 `CoverEditor.tsx` 的 `PREVIEW_HF_VALUES`；**真实出报告时这些值由接口 1.2（`report_meta`）抓取**，不随模板版本保存。

**页眉版式细调键（向后兼容，缺省＝原行为；用于精确复刻 .doc 封面）**：`header_footer` 还认这些可选键 —— `title_size`（其余页标题字号，缺省 13pt）、`title_size_first`（**首页标题字号**，缺省＝`title_size`，让首页大、续页小）、`title_tracking`（标题字距，如"检 测 报 告"，缺省 0）、`header_rule`（页眉下分隔线，缺省 true）。序列化在 `themeConfigToTypstDict` 的 `HF_LENGTH_KEYS`（字号/字距按裸长度而非字符串），渲染在主题 `_render-header`（用 `counter(page)...first()` 区分首页）。**这些键目前只能经模板 JSON / upsert 脚本设置，编辑器 UI 暂无开关。**

**全局默认（`config/header-footer.json`，2026-06）**：这套版式键现有一份**随代码部署的默认** —— `buildHeaderFooterConfig` 优先级＝**报告模板自配 `layout_options.header_footer` > `config/header-footer.json` 的 `settings` > 主题硬编码默认**。意义：① 新服务器即使数据库空，也用配置文件默认（不再回退主题默认而"页眉页脚乱、冒出分割线"）；② 改一处文件即改**所有报告**页眉页脚默认（页眉页脚本是文档级、首页+项目共用）；③ 分割线由 `settings.header_rule`/`footer_rule` 决定（缺省主题 true，配置文件里设 false＝隐藏，对齐样张）；④ 取号前示例公司信息来自同文件 `sample_meta`（`fetchReportMeta` 读它）。当前默认值＝原 id=9 首页模板那套（已写入文件）。`footer_rule` 现也由 `buildHeaderFooterConfig` 透传（此前只透传 `header_rule`）。

### 原始记录模板「对应项目名称」→ 报告项目名

原始记录模板有一个**必填**的「对应项目名称」，存在 `record_template_versions.layout_options.project_name`（随版本冻结）：
- **填**：模板编辑器左栏顶部卡片「PDF 大标题」下方的「对应项目名称 *」输入（`FieldEditor` 顶部卡片，仅 record 模式显示；`Editor.tsx` 的 `handleSave` 必填校验）；新建模板 v1 直接带上。
- **不显示在原始记录上**：`generateTypst`/`themeConfigToTypstDict` 只读 `layout_options` 的 `theme_config`/`header_footer`/`controlled`，**不读 `project_name`**，所以记录本身不印它。
- **显示在报告上**：`reports.ts` 的项目名优先级 = 工作台 title 覆盖 > **`linkedTpl.layout_options.project_name`** > 原始记录模板名 > 项目报告模板名。
- **显示在模板列表**：`GET /api/record-templates` 用 `cv.layout_options->>'project_name'` 选出该列；列表有「对应项目名称」列（空显示「未填」）。
- 存量模板未填 → 列表标「未填」、报告回退到模板名；编辑填上并审核通过后生效。

### 原始记录顶部受控行（受控号/颁布/实施日期）

原始记录顶部印一行受控文件信息（对齐参考 `.xls`）：`GRGJL.WI-HX-06-471(1.7)　颁布日期：2025/8/20　实施日期：2025/8/20`（左=受控号、右=两个日期）。
- 它是**原始记录模板版本的属性**（同模板所有记录共用），存在 `record_template_versions.controlled_*`（migration 021），**随版本冻结**（历史记录按锁定版本回放对应受控号）。
- 数据来源：**受控登记**（模板编辑器顶栏「受控登记」按钮 → `POST /:id/controlled` 写当前生效版本，手动应急通道；接口⑦就绪后外部回传同写此处）。
- 渲染：服务端 GET 把三列合进 `layout_options.controlled` → `themeConfigToTypstDict` 序列化成 `controlled:(...)` → `record-theme` 在标题上方印受控行。无受控信息时不印（存量不变）。**默认自动加、不逐条编辑**。

### 报告映射引用完整性（binding 失效会静默变空）

报告 `CellBinding`（`record_field`/`record_cell`/`record_summary`）用字符串编码指向关联原始记录字段。原始记录改名/删了字段编码后，`resolveBinding` 取不到会静默落到 `'—'`，那格变空且无告警。校验器 `shared/binding-integrity.ts` 的 `validateReportBindings(reportGroups, recordGroups)` 收集报告所有 binding 比对原始记录字段集，返回失效项。已接入：项目报告编辑器（`ProjectEditor.tsx`）实时标红、`GET /api/report-templates/:id/binding-check`、PUT/approve 响应带 `binding_warnings`。**默认只告警不阻断保存**（合规上保存草稿不该被卡）。新增报告 binding 来源时，记得在校验器里加对应分支。

**委托单接口字段绑定（接口 1.1）**：`CellBinding` 另有 `order`（订单级，扩展键 `OrderMetaKey`）/ `sample`（样品级）/ `test`（材料分单级）三类来源，取自 `work_orders.payload`（接口 1.1 PushOrderInfos 入库的 `meta` / `samples` / `test_infos`）。生成期 `buildReportTypst` 载入 payload，按每个项目的 `record_data.sample_external_id` + `test_item_name` 回查出 `ctx.sample_info` / `ctx.test_info`、订单级 `ctx.order_meta`，写进 `resolveBinding` 与 `content_doc` ctx 快照。这三类**不指向原始记录字段集**，`binding-integrity` 视为恒有效（不会因原始记录改名/删字段而失效）。样品稳定 id 取接口的 `BarCode`。
**检测周期（订单级派生）**：`OrderMetaKey` 含 `test_period`/`test_start`/`test_end` —— 委托单本身没有"整单检测周期"字段，故 `buildReportTypst` 在载入 payload 时**跨全单材料分单聚合**：`test_start`=最早 `StartDate`、`test_end`=最晚 `EndDate`、`test_period`=合成「开始 ~ 结束」时间范围（两端相同折成单值、缺一侧只显另一侧、都缺为空），写进 `ctx.order_meta`。BindingPickerModal「委托单字段」Tab 可选这三个键。
**时间范围字段类型 `daterange`（推荐配检测周期）**：`FieldType` 加 `daterange`，`FieldDefinition.date_range:{start?,end?,separator?}`——两端各一个 `CellBinding`（`literal`＝手填日期 / `order` 等＝绑定字段，如 `test_start`/`test_end`）。渲染 `formatDateRange`＝`${start}${separator}${end}`（separator 缺省 ` ~ `；缺一端只显另一端、都缺为空），经 `injectReportFieldsIntoTypst` 注入 `#let data`（与普通绑定字段同路径，`collectTypstDataKeys` 默认收）。编辑器：调色板「时间范围」（report-cover/project）；字段属性面板与简单字段一致给 **基础 / 字段名 / 字段值 / 版式** 四页（`FieldPropsPanel` 的 `isDateRange` 分支）——其中**字段值**＝两端 `CellBindingButton`（开始/结束）+ 分隔符 + 值样式（取值是两端绑定、非通用单 binding，故仍在 `NO_FORMAT_BINDING`、不出「类型配置」「取值绑定」Tab，日期绑定即放在「字段值」页）；**字段名/版式**与文本字段同（label/label_style、对齐间距），渲染走通用 `#field` 故 `label_style`/`value_style`/`style` 均生效。首页种子「检测周期」已用 daterange 绑 `order.test_start`/`order.test_end`。单键 `order.test_period`（合成串）仍可用，二选一。

**报告接口字段绑定（接口 1.2）**：`CellBinding` 还有 `report_meta` 来源（键 `ReportMetaBindKey`：公司名/地址/传真/电话/客户名/客户地址/报告备注/资质备注，各含中英文，+ 报告号/检验码/签发日期）。用途＝**让封面/首页正文直接引用取号推送的页眉页脚/抬头信息**（如"报告抬头单位名称""单位地址"），文员不必手填。取数：`buildReportTypst` 把每报告的 `ReportMeta`（取号时 `buildReportMetaFromReq(requisition)`，否则按订单号 `fetchReportMeta` mock）经 `reportMetaCtx` 写进 `projCtx` / `coverCtx` / `content_doc` 各 ctx 快照（页眉页脚渲染与正文绑定**共用同一份 `ReportMeta`**，中英文已按 `Language` 选中）。同样**不指向原始记录字段集**、`binding-integrity` 恒有效。UI：`BindingPickerModal` 的「报告接口字段(1.2)」Tab；模板编辑器预览用 `CoverEditor`/`ProjectEditor` 的 `report_meta` 示例值填充。

### 首页样品名称/零件号：单/多样品自动切换（系统固定规则，文员一套模板通吃）

报告抓取的 `样品名称/样品编号/零件号` ← 接口样品 `SampleName/SampleSortNo/Model`（真实接收口 `external-orders.ts` 已把这三个存进 `work_orders.payload.samples`，渲染读 `ctx.order_samples`）。**文员编辑首页模板时并不知道某次报告是单样品还是多样品**，所以"单样品直显、多样品出表"这条规则**写进系统渲染期、按实际样品数自动切换**（对齐检测结论表 `conclusion_table.sample_col:'auto'` 同款约定），文员不用为单/多分别建模板、也不用每份报告手动判断。两个机制：
- **内联字段**：首页顶部用 `CellBinding{source:'report_sample', key:'name'|'sort_no'|'model', multi_text?}` 绑样品名称/零件号。`resolveBinding`：`ctx.order_samples.length>=2` → 返回 `multi_text || '见后续页。'`（常量 `REPORT_SAMPLE_MULTI_DEFAULT`）；单样品 → 直显该样品值。UI 在 `BindingPickerModal`「样品信息」Tab（含「多样品占位文案」Input）。
- **样品信息表**：检测结论表前放 `report_sample_table` 字段（`sample_table.mode:'auto'(缺省)|'always'`）。`renderSampleTableTypst`：auto 且样品 ≤1 → 返回空串（折叠，单样品交给上面的内联字段）；多样品 → 列 `序号/样品名称/零件号` 满宽表。UI 在 `FieldPropsPanel` 的「单/多样品」Radio。

即：**单样品 → 顶部直显名称/零件号、表折叠；多样品 → 顶部显示「见后续页。」、表自动列出全部样品。** 详见 `报告映射方案.md` §八 P-Map-15。

### 报告模板删除时要清 mappings

`report_templates` 被 `report_template_mappings`（v1 旧表）外键引用，DELETE 路由必须先 `DELETE FROM report_template_mappings WHERE report_template_id = $1` 否则违反外键约束。

### 同一上下文全局只有一条 record_data

upsert 唯一键：`(template_id, order_no, sample_external_id, test_item_name)`。前端「录入数据」按钮检测到已存在记录会自动跳「编辑数据」。
⚠️ **解除关联（`work-orders.ts` 的 `/link` `op='remove'`，2026-07 收紧）**：① 该上下文有**已审核通过(reviewed)** 的 record_data → **409 拒绝解除**（已审核数据不可被任何操作销毁；解锁唯一路径＝报告端「退回原始记录」rework→rejected 后再操作），OrderDetail 该行解除按钮也已禁用；② 其余状态（draft/pending/rejected/无状态）→ 解除时**删除该上下文全部 record_data**，重新关联即干净的空白新录入——否则旧数据按上下文键被重新加载、且锁定在旧模板版本（用户两次报告的 bug：先是草稿残留，后是待审核/被退回数据残留）。`record_audit_log` 随 FK CASCADE 清；引用被删记录的 `rework_tickets` 未关闭的先置 `resolved`（附系统备注，避免 data_entry 锁因永不重审而挂死报告）再置空 `record_data_id`。OrderDetail 解除关联前弹确认（提示将删除全部录入数据、不可恢复）。
⚠️ 任务列表匹配记录时必须**带 template_id 过滤**（`Lab/order-shared.ts` 的 `findRecord`）——唯一键含模板，换关联模板后旧模板录的记录不属于本行；漏掉这个条件会"不管关联哪个模板，打开编辑永远进旧模板的记录"。旧记录仍保留在库与审计中。
✅ 唯一键含 template_id ⇒ **一个测试项目关联多个模板时，每个模板各自一条 record_data、各自录入与审核**，天然支持一对多（详情页按 template 展开成多行；报告 Workbench 一条 record_data = 一个项目槽）。

### 录入时的结构微调权限（开放权限 / P2）

数据录入开放的是**"数据量"**、不是**"表单设计"**：
- **样品行增减**：`FormRenderer` 默认**开放**（`cfg.allow_add_remove_samples !== false`），模板可在矩阵编辑器「录入时允许增删行」开关里**显式锁定**（设 `false`＝固定样品数）。
- **图片张数**：`field.allow_multiple !== false` 默认开放多图上传 + 删除。
- **行名/列名改名**：按 `allow_edit_*_labels_at_entry` 开关（改显示名，不改 `code`）。
- **表头备注可选项（统一表头模型，模板预先配置、录入端从中选）**：四类表头（参数列/样品行/汇总行/汇总列）的"备注"（括号显示在表头里）都可固定（如单位）或配可选项（如「客户要求 / 标准要求」）。录入端出下拉（`HeaderNoteCell`/`UnitCell`），所选值存 `DataMatrixValue.{parameter_unit_overrides, summary_note_overrides, sumcol_unit_overrides, sample_note_overrides}`，PDF 端同步显示；配置入口=模板矩阵画布**右键表头** → `HeaderConfigCard`。
- **永远锁死**：字段 `code`/类型/增删字段、公式、固定单位（无 `unit_options` 时）、版式、映射——这些是模板设计，录入不可改；增删**参数列**（`allow_add_remove_parameters`）默认仍关（改列＝动结构/公式）。
- 一切录入仍走 提交→审核→版本锁定+审计。
- ✅ 已解决（P-Map-10「试样带」）：录入期增减样品超过模板默认数时，报告检测结果表用**试样带**（`result_table.band`，见速查表「改报告·检测结果表的『样品带』」行）按实际样品数自动展开行/列——不再受"按索引绑定覆盖不到新样品"限制。不开试样带的逐格静态表仍是固定行列。（早期的"动态·矩阵驱动整表模式"`source.mode='matrix'` 已于 2026-06-22 移除——能力被试样带覆盖、属冗余。）

### 模板字段值的写入 vs 自动注入

带 `semantic_role` 的字段**不写入 raw_data**——它的值由 `record_data` 表的 `tester_name / tested_at / reviewer_name / reviewed_at` 五列权威持有。`FormRenderer` 渲染只读，提交时 `Lab/Record.tsx` 把这些 code 从 raw_data 排除。

### 模板版本改造对原有路由的影响

- **base 表只存元数据** — `record_templates` / `report_templates` 不再持有 `field_definitions / typst_source / layout_options`（migration 017 删除）。所有读路径必须 `LEFT JOIN *_template_versions cv ON cv.id = t.current_version_id`，把 `cv.field_definitions` 等字段拿过来。**写路径同理**：`INSERT/UPDATE` base 表（如 `forkTemplate`、新建模板）绝不能再带这三列，内容只写进版本行——否则会抛 `column ... does not exist`
- 真实数据源是 `current_version_id` 指向的版本行
- PUT 字段定义 = 创建/更新一个 draft（**不立即生效**），改 name 等元数据立即生效
- 新建模板 v1 直接 approved（demo 简化，可改为 draft）
- **审核流（谁能做什么）**：`提交审核`(draft→pending) 由**作者本人或任一审核员(reviewer)**触发（`submitForReview` 收 `actorRole`，避免草稿因作者不在线/不存在而卡在 draft）；`审核通过/退回` 仅 reviewer 且**作者本人不能审自己**(`reviewVersion` 查 `author_name===reviewerName` 拒绝)——合规不变。`TemplateVersionPanel` 列表行：草稿→「提交审核」(作者/审核员可见)、待审→「审核」(审核员且非本人)、本人提交的待审显示「待他人审核」+「撤回」。
- **草稿槽位语义（migration 022 起）**：①pending 不可被 PUT 覆盖——必须先 `withdraw`(pending→draft) 或等审核结果；②**rejected 行冻结为不可变历史**（退回时的内容 + 审核备注永久保留），再编辑会开新版本号行，原样重提（`submit` 一个 rejected 版本）会复制内容开新行直接进 pending；③draft 保存带 `draft_updated_at` 乐观锁，不一致 409。**"未定稿"(open_draft) 的定义**因此变为：版本号最大的 draft/pending/rejected **且版本号大于当前生效版本**——被新版本取代的旧 rejected 行是纯历史，不再出现在未定稿位（`OPEN_DRAFT_SQL` / `getOpenVersion` 两处同语义，改一处必须同改另一处）。
- **编辑器加载未定稿**：三个模板编辑器（Record Editor / Cover / Project）加载时若有 draft/rejected 未定稿，会**加载草稿内容**继续编辑（而不是当前生效版本），并提示"已加载未生效的草稿 vN"；`?version_id=Y` 进入**只读历史版本**模式（左栏禁交互 + 金色 banner + 无保存按钮）。历史只读视图顶栏：① **「恢复此版本」** 按钮（`rollbackTo` → `POST /:id/versions/:vid/rollback`，与版本历史抽屉同一回退入口）——`superseded` 恒显示；**`approved`(当前生效) 在有未定稿（草稿/待审）时显示为「恢复为此版本」**。**恢复为生效版本＝丢弃草稿**（内容无真实改动，直接删草稿行回到干净生效态，不留草稿/不送审）；恢复为 superseded 历史版本＝重置草稿内容（仍是草稿）；无未定稿时→新建 pending；pending 一律先撤回审核（按钮文案/确认框按 `viewingVersion.status==='approved'`(丢弃) 与 `open_draft.status`(draft/pending) 自适应）；② **「← 返回」走 `navigate(-1)`** 回到刚进来的入口（列表 / 编辑器 / 历史抽屉上下文），不再硬跳列表；③ **「回到当前版本编辑」跳 `?id=X`**。⚠️ 三个编辑器的**可编辑/克隆加载分支必须 `setViewingVersion(null)`**——否则从历史只读视图导航回 `?id=X` 时金色「历史版本」标记会残留、面板消失（看起来"还在历史版本里"）。
- **编辑器加载 pending（已提交审核）= 只读看送审版本**：若 open_draft 是 `pending`，进编辑器**只读展示送审中的那个版本内容**（不是已生效版本、也不可编辑——后端 PUT 本就 409），顶栏金色 banner「vN 审核中 · 待审核通过 · 只读」+ 「查看当前生效版本 vM」按钮（跳 `?version_id=current_version_id` 只读看生效版本）。版本历史里 pending 版本本就排最上（`listVersions` 按 `version_no DESC`）、其下是上一个 approved。顶栏 `TemplateVersionPanel` 仍在（可「撤回」转回草稿继续改/看历史）。状态由 `pendingReview` 驱动（record 在 `Editor.tsx` 内联、report 在 `useReportTemplateEditor.ts`）；提交/撤回后经 `reloadToken` 重跑加载，使只读/可编辑态与最新 open_draft 同步，不必手动刷新。
- **模板操作审计（template_audit_log）**：版本表回答"内容是什么"，这张表回答"谁何时做了什么"（create/update_draft/submit/withdraw/approve/reject/fork_out/fork_in/sync_out/sync_in/archive/restore/rename/controlled）。approve/reject/fork/sync 在 service 事务内写，其余在 routes 埋点；新增模板写操作时记得埋（参考 `logTemplateAudit`）。
- **删除（归档）需审批（migration 023）**：任何人删除模板都要先「申请删除」（原因可选），由审核员批准后才归档生效；申请人≠批准人、驳回必填备注，与版本审核同一合规约束。申请期间状态列显示「删除待审」，申请人可撤销。直接 `DELETE /:id` 已停用（403）。归档仍是软删：版本历史 + 录入数据完整保留、可恢复。
- **母子字段映射与同步（field_mapping）**：fork 时在子模板 base 行写 `{groups:{childId:parentId}, fields:{childId:parentId}}` 恒等映射（**不能**靠"同 id 即映射"——id 只在模板内唯一，母子各自新增可能撞 id）。`syncToChildren`：映射字段被母版改→整体替换（保留子 id）、母版删→子删、母版新增（可选）→追加进映射对应分组并把新条目写回映射；**子模板自建字段（不在映射键域）永不触碰**；子模板有未定稿则跳过不覆盖；同步产物是子模板的 **pending 版本**，各自审核通过才生效。归档母模板（force）或解除母子关系时 `field_mapping` 一并清 NULL。

### 报告实例文档（content_doc）= 生成后的可编辑快照

- 生成报告时（v3 groups 模型）把"模板 + binding 解析结果"冻结成 `reports.content_doc`：`{cover, projects[]}`，每个含 `groups`（结构）+ `ctx`（数据快照）
- 生成与"结构化编辑后重渲染"**共用** `shared/typst-generator.ts` 的 `renderContentDoc()`，保证装配口径一致
- **首页草稿（cover_draft，migration 029）复用同一 content_doc + InstanceEditor**：取号前 `POST /reports/cover-draft` 建一份 cover-only 实例，文员在 `InstanceEditor` 编辑首页（值/字段/表格/样式）；取号生成时把它的 `cover.groups` 作 `cover_groups_override` carry 到每份报告（见第五节"首页草稿 carry"）。所以 `InstanceEditor` 天然支持空 `projects`（只显示 cover 标签页）。⚠️ **检测结论表的 project_assignments 由 `deriveApprovedAssignments(order_no)` 从订单【全部 `audit_status='reviewed'` 的原始记录】派生**（每条记录经 `report_templates.linked_record_template_id` 匹配未归档项目模板）——不再传空数组，所以"编辑首页"看到的结论表与取号生成报告**一致**（有多少审核通过的记录就有多少项目行）。幂等：已有草稿且 `edited=true` 则保留不动；**`edited=false` 则按当前审核通过记录重建** content_doc（也修复历史上 assignments 为空的旧草稿）。**carry 只发生在取号生成那一刻**——所以"编辑首页后已生成的报告不会自动更新"；`InstanceEditor`（首页草稿）顶栏「应用到已生成报告」→ `POST /reports/apply-cover` 把首页**回填**到勾选的已生成报告（正常场景：缺省勾未单独编辑过的，「已编辑」需手动勾才覆盖）。⚠️ **送审/退回边界**：**已送审未退回的报告（`external_status='submitted_external'`）是终态、不可被首页套用覆盖**（前端不列出、后端兜底拒绝）；**有报告被退回（`external_revision`）时，套用目标只限被退回且【可编辑】的那些报告**（已送审的冻结不动）——即"退回时改首页只影响被退回的报告"。⚠️ **数据退回(data_entry)锁定的报告 `external_status` 同为 `external_revision` 但不可编辑**——须用 `GET /reports` 新增的 `data_rework_open` 字段区分（与 `hasOpenDataEntryRework` 同口径的 EXISTS），前端排除 + `apply-cover` 后端拒绝（"等待实验室数据重新审核"）。Workbench 的「报告首页」卡（选模板+编辑首页）在全部送审后由 `coverLocked` 整体禁用，有可编辑退回报告时解锁；换首页模板由 `cover-draft` 幂等接口感知（模板变了或未编辑→按新模板重建草稿）
- 文员结构化编辑（`Report/InstanceEditor.tsx`）的本质：**改值 = 把字段/单元格的 `binding` 改成 `{source:'literal', text}`**；增删字段/结果表行 = 直接改 `content_doc.groups`。改完 `PUT /api/reports/:id {content_doc}` 服务端重渲染 `final_typst` 并标记 `edited=true`
- **右侧预览 = 与模板编辑器同款 `TypstViewer`**：客户端用 `renderContentDoc(doc)`（与服务端 `/preview-content-doc` 同一函数）算出 typst 源交给 `TypstViewer`（内部 `POST /api/typst/compile` 编译 + PdfViewer 渲染）。好处：**改动后 PDF 不回到顶部**（PdfViewer 保滚动）、自带「下载 PDF」按钮。**不再用** `<iframe src=blobUrl>`（每次刷新整页重载、回顶部）。左右两栏用 `EditorSplit`（与三个模板编辑器同款，**分隔条可拖拽调宽 25%–75%、双击复位、localStorage 记忆**）。所有字段类型（含 computed/reference/variant_list 等）都有兜底分支渲染出"标签+值"——保证编辑器把全部字段及其值拉取展示（无 binding 的派生值只读）
- **结果表（`report_result_table`）实例编辑增强**：`ResultTableEditor` 除填值/增删行外，新增 **增删列、列宽（写 `columns[].width`）、合并单元格（点格子→设 `colspan`/`rowspan`，盖住的格子跳过渲染）**——这些字段渲染器 `renderReportResultTableTypst` 早已支持（colWidthSpec / table.cell(colspan,rowspan) + 覆盖格计算），实例侧只补 UI，渲染路径不变
- **永不回写 record_data**：报告侧所有编辑只落在 `content_doc`。每次生成/编辑写 `report_audit_log`（字段级 diff）；编辑器对比 `content_doc_original`（生成时不可变快照）对**偏离原始数据**的字段标红告警。`GET /api/reports/:id/audit` 取留痕
- **检测结论表（`report_conclusion_table`）现在可编辑**（`InstanceEditor` 的 `ConclusionTableEditor`）：默认仍按 `ctx.project_summary` 自动展开（取号后各报告按自身项目）；**列名 / 列宽随时可改**（写 `conclusion_table.column_labels` / `col_widths`，渲染器 `renderConclusionTableTypst` 读取）；点**「解锁编辑」**把当前自动行固化成可改内容（`conclusion_table.manual=true` + `rows`），可改单元格 / 增删行，「恢复自动」清回。⚠️ 在**首页草稿**里解锁固化后会随 `cover_groups_override` carry 到每份报告（即各报告都用这份固化结论）——不解锁则各报告按自身项目自动展开。
- 设备表 / 图片表仍来自 `ctx` 数组、显示为"自动生成"只读，结构编辑留待后续（见 OPTIMIZATION.md）
- **原样照片表（`report_photo_table`，首页用）**：文员直接上传照片的图片表，**不依赖关联原始记录**（区别于项目报告的 `report_image_gallery` 强依赖 `ctx.linked_record_template`）。渲染 = 一行「加粗标签：普通说明」（`#text(weight:"bold")[caption_label：]caption_text`）+ 一张带表头(`header`)的图片表（复用 `renderImageSlotsTypst`）；函数 `renderPhotoTableTypst`（typst-generator），占位锚点 `__REPORT_PHOTO_TABLE__`。⚠️ **照片存 `field.photo_table.photos`（字段定义里）而非 `ctx`**——这样随 `content_doc.cover.groups → cover_groups_override` carry 到每份报告（与结论表手动行/字面量 binding 同一 carry 机制；若存 ctx 会在取号重算 ctx 时丢失）。**职责切分**：模板期（CoverEditor）**只设标准文案**（标签/说明/表头，`FieldPropsPanel` 的 `report_photo_table` 分支，`field-types.ts` 类别 `editors:['report-cover']`，默认文案＝样品描述/见原始样品照片。/原始样品）——**模板期不编辑图片**；**照片上传 + 图片版式（每行张数/尺寸/无缝）都在实例期**由文员在 `InstanceEditor` 的 `PhotoTableEditor` 做（上传走 `POST /api/images/upload`，同图片字段）。**文员也可在 `InstanceEditor` 的「插入内容」菜单（行间 InsertZone / 末尾下拉）直接插入一个原样照片表**（`onInsertAt` 的 `kind:'photo_table'`，默认文案同上）——所以无需先去模板里加字段，编辑首页时即可加照片表。**示例数据预览**：CoverEditor 的「示例数据」开关经 `withMockPhotoTables`（`shared/mock-data.ts`）给空照片的 photo_table 注入一张样图（`samples/sample-images/before.png`），真实报告不经此函数。⚠️ **满页宽**：`renderPhotoTableTypst` 外层必须 `#block(width: 100%, …)`——否则缺省 #block 收缩到内容宽、里面 `#table(columns:(1fr))` 的 fr 列塌缩成内容宽、表格不占满页宽（与原始记录图片组 `renderImageGroupTypst` 的 `#block(width:100%)` 同口径）
- **字段名（label）可在 `InstanceEditor` 直接改**（写 `field.label`，对所有有可见标签的字段生效）——满足"自动获取的字段也能改字段名"
- **报告内排版（P4）**：实例编辑器（`InstanceEditor`）每个区块/字段都有「格式」`FormatPanel`（字体/字号/加粗/对齐/行距/段距）→ 写进 `content_doc` 的 `group.style`/`field.style`，重渲染走 `renderContentDoc`（与模板期同一套样式层叠）。**注**：纯样式改动目前不进 `flattenContentDocValues`/`diffContentDocValues` 留痕 diff（只追字段值变化）；实例期结果表列宽拖拽未做（模板期 `ReportResultTableCanvas` 已有）
- **报告内"软编辑"（让精修没那么死板）**：实例编辑器「插入内容」下拉可加 **段落 / 小标题 / 说明字段 / 空行间距**，每个字段可**上移/下移重排**。段落/小标题是 `hide_label: true` 的文本字段——渲染成**纯文本块（无「标签：」前缀）**：`generateFieldBlock` 对 `hide_label` 走 `#block[#multiline(data.code)]` + 字段级样式（小标题=加粗大字）。配合 P0.1 换行 + P4 格式，文员可较自由地组排报告正文。
- **加/删空行（版式留白）**：`spacer` 字段（`hide_label`，`spacer_height` 默认 `1em`）渲染成 `#v(高度)`（`generateFieldBlockInner` 的 spacer 分支）。⚠️ **空行不是自动的**——版面里字段之间的留白来自隐式块间距（`block_spacing`/段距），不是 spacer 对象；要有"可编辑的空行"必须**插入一个 `spacer`**。`InstanceEditor` 提供 **3 种插入法**（任意位置）：① 字段间 hover 显形的 `InsertZone` 气泡「+ 空行 / 内容 ▾」；② 每行行首拖柄列常驻的 **`+`** 下拉「在下方插入」；③ 顶部工具条的 **「↕ 空行（拖我）」chip** 拖到任意行放下（`DraggableField` 的 `onDrop` 认 `__spacer__` 标记 → 插在该行上方）。三者都走 `onInsertAt(index, kind)` splice。spacer 渲染为一行（浅灰虚框）：**em 高度 + 半行/一行/两行预设 + 明显「删除」**。**模板里设计的 spacer 会随 `content_doc.cover.groups` 显示在实例编辑器**。更细的间距走「格式」Popover 的 **段前/段后**（−/+ 步进）/**字段间距**（`block_spacing`）。
- **字段行 UI（实例编辑器，一字段一条 + 选中式公共栏）**：`DraggableField` 每行最左只有一个拖柄 `⠿`（HTML5 drag，拖到目标行上缘蓝线落位 → `onReorderField` splice 重排）；**点击整行选中**（`onFocusField` → `focused`，行高亮 `selectedFi`）。**上移/下移/删除/有名无名/字段格式**都收进左栏顶部公共栏，对**选中字段**生效（`moveFocused`/`deleteFocused`/`toggleFocusedHideLabel`/`setFocusedFullStyle`）——不再在每行塞 ↑↓/删除/格式/有名无名 小按钮（原来太凌乱）。插入仍走行间 hover 的 `InsertZone` + 末尾「插入内容▾」+ 顶部「↕空行」拖拽。
- **字段呈现方式（有名/无名）**：模板编辑器 `FieldPropsPanel` 给报告字段一个三选预设（有名·绑定值 / 无名·手填 / 无名·抓取＝`hide_label`×`binding` 组合）；`InstanceEditor` 每个普通字段行有一个 **「有名/无名」紧凑切换**（`onMutateField` 改 `hide_label`），让文员对**单份报告**临时显示/隐藏字段名（值随时可在值框改＝手填，无需切来源）。**空值的 hide_label 字段不渲染**：`generateFieldBlockInner` 的 hide_label 分支对 `none`/`""`/`"—"` 输出空内容（`#if … [] else […]`）——避免空的资质备注/声明留下"—"或空块（labeled 字段/表格单元仍显示"—"作缺值提示）。
- **模板编辑器侧已对齐**：报告/原始记录**模板**编辑器（`FieldEditor`）本就有 react-dnd 拖拽 + 可插入 `spacer`（`visibleCategories` 不含 report-only 标记，记录/报告模式都出「间隔（空白）」），且共享 `FormatPanel`（段前/段后 −/+ 步进自动生效）；`FieldPropsPanel` 的 spacer 配置 2026-06 也加了 **半行/一行/两行** 预设，与实例编辑器一致。
- **内联富文本（已实现）**：字段 `rich: true` 时值按 Markdown 子集渲染——`**粗**`/`*斜*`/`_斜_`、`-`·`1.` 列表、换行、空行分段。`shared/typst-generator.ts` 的 `richTextToTypst()` **先转义 Typst 特殊字符再套白名单标记（无 eval，杜绝 `#代码`/`$公式` 注入）**，走 `// __RICH__` 锚点在 `generateTypstWithData`（录入）和 `injectReportFieldsIntoTypst`（报告）两处替换为内容块。`InstanceEditor` 的「段落」即 `rich` 字段，配 B/I/• 工具条（`RichTextEditor`，操作 Markdown 串）。**安全是关键**：新增标记类型时务必在 `richTextToTypst` 里走转义白名单，绝不 `eval` 用户串。
- **文档级样式（实例编辑器）**：左栏顶部挂 `DocumentStylePanel`（与模板编辑器同款，`editorMode='report-cover'`），绑到 **`content_doc.cover.layout_options`**（写 `theme_config`）——因整篇报告 cover+projects 共用首页那一个 `set page`，所以改 cover 的 theme_config 即统一影响整份 PDF 的字体/字号/行距/标题等。
- **字段工具栏（实例编辑器，已重构）**：选中某字段后的 sticky 工具条。⚠️**关键修正**：文字加粗/斜体/字号/颜色必须写进 **`label_style`（字段名）/ `value_style`（字段值）**，不能写块级 `field.style`——`applyBlockStyle` 只渲染对齐/边距/段距，**不渲染 weight/italic/color**（旧版工具栏写 `field.style.weight` 所以"加粗没反应、清除没反应"）。工具栏：①`Segmented` 选作用对象 **字段名 / 字段值** → B/I/字号±/颜色(`ColorPicker` 色卡，含预设+清除)写到对应 `*_style`，实现**字段名/值分别加粗**；②`AlignLeft/Center/Right` 图标按钮写块级 `style.align`；③**显示字段名** 切换 `hide_label`；④「版式▾」开 `FormatPanel`（字体/行距/段前后/边距）；⑤清除＝清空 `style`+`label_style`+`value_style` 三套；⑥字段操作 上移/下移/删除；⑦**「空行」按钮**（点击在选中字段下方插入 spacer，也可拖到任意行间放下——替代旧的"空行（拖我）"文案）。
- **选中/取消选中**：点字段行选中（高亮 `selectedFi`）；**再次点已选中字段的空白处（非输入框）取消选中**，或点字段列表的空白区域（`e.target===e.currentTarget`）取消——`DraggableField.onClick` 按点击目标是否为 INPUT/TEXTAREA/BUTTON/SELECT/ant-select 判断（点输入框只选中不取消，避免编辑时误取消）。
- **仍待（更"像 Word"）**：预览内就地编辑（edit-in-place，与 P5 同北极星，已评估"暂不做"见 OPTIMIZATION）

### 录入数据按版本锁定渲染（合规要求）

- `record_data.template_version_id` 在录入时写入"当时所用的模板版本"
- 报告渲染时按这个 version_id 取字段定义，**不**取模板的最新版本
- **编辑已录入记录也按这个 version_id 加载模板**（`Lab/Record.tsx`，`GET /:tid/versions/:vid`）——不是当前版本，保证录入/编辑/渲染三处对着同一套结构
- 这样工程师后续修改模板（重命名字段、改单位、改公式等）不会影响已录入数据
- 老 record_data 的 template_version_id 为 NULL，fallback 到模板当前生效版本
- **审核后锁定**：`reviewed` 记录的 POST/PUT/images 一律 409，禁止直接改；解锁只能走报告端「退回原始记录」(rework→rejected)。draft/pending/rejected 仍可改

### 模板软删 + record_data 永不物理删除

- `archived_at` 非 NULL 表示模板已归档，列表过滤掉，编辑器不可访问
- `DELETE /api/{record,report}-templates/:id` 实际是 UPDATE archived_at
- `record_data` **永远不删**——已审核的检测数据是法律证据，合规体系（GxP / ISO 9001）要求保留
- 想真清理测试数据应该走专门的脚本而非 API
- `POST /:id/restore` 撤销归档

### HTTP 头中文必须 URL 编码

HTTP 头按 Latin-1 解读，`X-Demo-User: 张工` 直接发会乱码：

- 客户端 `client/src/auth.tsx` axios 拦截器 `encodeURIComponent`
- 服务端 `services/template-versions.ts` 中 `readActor()` `decodeURIComponent`

接 SSO 时如果 token 含中文同样要走 URL 编码，或换非中文 user identifier。

### 登录身份 vs 本地角色（RBAC）

**两件事分开**：① 身份（你是谁）来自外部认证接口 5.1（`services/external-auth.ts`，只给 `jobNo/姓名/部门/token`）；② 授权（你能干什么）在本系统本地——`users` 表存"该工号被分配了哪些角色"，角色→权限矩阵在 `shared/rbac.ts`（**前后端单一事实来源**，改权限只改这里）。

- 首次登录自动建档，roles 默认空＝**待分配**（无权限），管理员在「用户管理」页派角色。
- 请求身份头：`X-User-Job`（工号，RBAC 真身份，后端 `routes/auth.ts` 的 `requirePermission` 按它查 users）；`X-Demo-User`（姓名）继续作审核日志 actor（`readActor` 不变，向后兼容）。
- 前端 `useAuth().has(perm)` 门控按钮/菜单；后端 `requirePermission(perm)` 门控路由。**目前服务端硬门控只加在用户管理路由**；给录入/审核/报告等路由加服务端硬校验是后续增量（中间件已就绪，按 `shared/rbac.ts` 的能力点加即可）。
- 护栏：不能停用 / 摘除最后一个 admin（`routes/auth.ts`）。

### 不要再开决策 / 分析 markdown 文档

项目根已有 `项目背景.md` / 本 README，早期方案/规范/计划归档在 `docs/`（见 `docs/README.md`），可作背景参考但不必新增。变更性的内容直接改 README。


---

## 七、API 一览

### 通用

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 健康检查 |
| POST | `/api/typst/compile` | Typst 编译，返回 PDF |
| POST | `/api/typst/query` | 取回 `<__fepos__>` 位置标记（编辑器 ⇄ PDF 双向跳转），与 /compile 传同一 source |
| GET | `/api/typst/health` | Typst 服务状态 + 缓存 |

### 委托单

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/work-orders` | 委托单列表（含 `payload.samples` 嵌套结构 + `source`：external/manual） |
| GET | `/api/work-orders/:no` | 单条委托单详情 |
| POST | `/api/work-orders` | 手动新建订单（`source=manual`，与接口传入的单同构）。body：`{order_no, customer_name?, received_at?, samples:[{name, test_infos:[{name, standard?}]}]}`；样品 id 缺省自动补 `s1/s2…`；单号重复 409 |
| DELETE | `/api/work-orders/:no` | 删除订单 + 关联数据（按外键序清 report_audit_log → rework_tickets → reports → report_batches → record_data（级联清 record_audit_log）→ work_orders，单事务） |
| PUT | `/api/work-orders/:no/structure` | 编辑订单结构（改/增删 样品·测试项目）。body：`{samples:[{id?, name, test_infos:[{_orig_name?, name, standard?}]}]}`（样品按 id 配对、项目按 `_orig_name` 配对，缺失=新增）。**不审核但留痕**；护栏：删除有已录数据的样品/项目 → 409+`blocked[]`，整单回滚；改项目名级联 `record_data.test_item_name`；保留原 `linked_template_ids`。写一条 `work_order_audit_log` |
| GET | `/api/work-orders/:no/audit-log` | 订单结构变更留痕（actor/summary/detail/created_at） |
| PUT | `/api/work-orders/:no/link` | 关联 / 解除原始记录模板（**一个测试项目可关联多个**）。body：`{sample_id, test_name, linked_template_id, op}`，`op='add'`（默认）加入集合、`op='remove'` 移除；统一写 `payload.test_infos[].linked_template_ids: number[]`（兼容读取旧单值 `linked_template_id`）。**解除关联：已审核(reviewed)数据存在 → 409 拒绝；否则删除该上下文全部 record_data（草稿/待审核/被退回），重关联即空白新录入**，响应带 `removed_records` 计数 |

### 外部接口接收（递归智能推送）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/external/orders` | **接口 1.1 PushOrderInfos**：接收委托单推送（PascalCase JSON，单条/数组）→ `services/external-orders.ts` `parseOrderInfos` → upsert `work_orders`（`source=external`）。已存在则更新 `meta/customer` 并按 样品名+项目名 保留 `linked_template_ids`；返回 `{ok,count,results,warnings}`（同样品重复 ProjectName 去重告警）。字段映射见 `待实现内容.md` 第 1 节 |
| POST | `/api/external/reports` | **接口 1.2 PushReportInfos**（报告取号）：接收整单 `ReportList[]`（每条=一份报告）→ `services/external-report-info.ts` `parseReportInfos` upsert `report_requisitions`（按 `sys_number` 幂等）+ 按 样品名+项目名 算匹配。**收到即自动生成**：对未生成且有 matched 且数据已 reviewed 的取号单，用默认首页模板 + 已匹配 assignments 调 `autoGenerateRequisition`→`generateAndStoreReport`（失败仅 warning，不阻断接收）。数据若在取号后才录入，由报告工作台载入时兜底自动生成。返回 `{ok,count,results:[{sys_number,report_number,matched,unresolved,auto_generated,report_id}],warnings}` |
| POST | `/api/external/report-modify` | **接口 1.3 RefreshReportInfo**（报告改号 + 退回修改，《递归智能接口文档》1.3 节）：body 仅 6 个官方字段 `[{SysNumber,ReportNumber,RecordState,SecondAuditDate,ModifyType,Remark}]`（不再读取 `Suggestion`/`ExternalRef`/`SecondAuditeDate` 等非规范别名）。先按 `sys_number` 改号并写元数据（`SecondAuditDate`→`issue_date` 经 `dateOnly` 去时分秒、`RecordState`→`record_state`、`Remark`→`last_modify_remark`；已生成同步 `reports.report_no`+`stale`）；再按 `ModifyType` 退回（仅对已生成报告，经 `services/rework-ops.ts` 共用原语，`Remark` 作退回原因/`reject_note`）：`report_edit`=退文员改报告（报告置 `external_revision`+`stale`+建 `scope=report` 工单；改完重走 `/deliver` 回传）；`data_entry`=退实验室重录（把该报告 `record_data_ids` 全部置 `rejected`+各建 `scope=record/target=data_entry` 工单；**此时文员侧锁定**——重生成/编辑/送审被禁用，重审通过自动 stale+关单→**自动解锁**→文员重生成会抓取新数据）。**⚠️ 无 `ModifyType` 时按 `RecordState` 推进报告状态机（真实部署里外部审核结论就走这条路，非演示用的 `/report-feedback`）：`审核通过`→`markReportApproved`（`reports.external_status='external_approved'`+`stale=false`、关闭未关闭的 `scope=report` 工单，签发终态）；`审核不通过`→等价 `report_edit` 退文员改报告；其余（草稿/审核中/无报告）→仅记录元数据。** 返回 `regenerate_needed`/`modify_type`/`external_status`/`rejected_records`/`record_state`/`issue_date` |
| GET | `/api/external/requisitions?order_no=X` | 列某单取号报告（**实时刷新匹配** `match_result`），工作台「取号报告」面板用。每行附 `data_rework_open`（该报告有未关闭的 `data_entry` 工单＝实验室数据退回中，文员侧据此锁定）+ `report_rework`（该报告未关闭的 `scope=report` 退回工单 `{id,reason,suggestion}`＝报告退回修改中，前端据此在该报告条目下方就近展示退回意见、放开「编辑/送审」）+ `record_state`/`last_modify_remark`（接口 1.3 元数据） |
| GET | `/api/external/requisition-counts` | 各订单取号聚合（报告列表角标 + 状态 + KPI 用，轻量不重算匹配）：`{order_no:{total,generated,delivered,approved,revision,data_rework}}`（delivered=已回传/送审、approved=外部审核通过/签发终态数、revision=外部退回待改报告数、data_rework=实验室数据退回中报告数）。报告列表据此派生订单状态：退回修改>审核通过>已送审>已生成>待生成>未取号 |
| POST | `/api/external/requisitions/generate` | 按取号单生成报告。body `{order_no, cover_template_id, cover_page_template_id?, items:[{requisition_id, assignments:[{record_data_id, project_template_id, title?, page_break?}]}]}`。复用 `reports.ts` `generateAndStoreReport`（与手动拆分同口径），`report_no=报告编号`、页眉页脚用该取号单元数据；回填 `requisition.report_id` + `status=generated`。**重新生成时旧报告行保留并标 `superseded_by=新报告id`（历史版本）**；该取号单若有未关闭的 `data_entry` 工单则该项返回 `{ok:false,locked:true}` 跳过（实验室数据退回未重审前不可重生成） |
| POST | `/api/external/requisitions/:id/deliver` | **接口 1.4 报告 PDF 回传（出站，**SOAP**）：取已生成报告 `final_typst`→编译 PDF→Base64→`services/external-report-delivery.ts` `submitReportToDiGui` 构 **SOAP 1.1/1.2 信封**调业务系统 WCF 方法 **`PushReportFile(sysNumber, file, jobNo)`**（sysNumber=SysNumber、file=PDF Base64、jobNo=委托单业务员工号 `payload.meta.job_no`；**少 jobNo 对方拒收**）→解析 `PushReportFileResult`/SOAP Fault→更新 `delivery_status/delivered_at/delivery_error`，并置 `reports.external_status='submitted_external'`+`stale=false`。**送审成功即视为该报告退回修改已处理：关闭其未关闭的 `scope=report` 工单 + 清取号单 `stale`→报告回到终态**（再次退回前送审按钮不可点击）。未生成报告则 400；**该报告有未关闭 `data_entry` 工单（实验室数据退回中）则 409**（须等数据重审通过+重生成）。配置 `config/report-delivery.json`+`.local.json`+`DELIVERY_*`（`soap_endpoint`/`method`/`param_id_name`/`param_file_name`/`param_jobno_name`/`soap_action`，空 endpoint=mock=不真发；以业务系统 WSDL `http://172.18.0.97:8003/lab/chemistry` 为准）。⚠️ 规范文档的 AcceptReportFromDiGui 在真实 WSDL 不存在，实为 PushReportFile |
| POST | `/api/external/report-feedback` | **外部报告回执（P-Flow-2 场景3）**：body `{report_id?/report_no?/sys_number?, order_no?, decision:'approved'\|'needs_revision', suggestions?/suggestion?, external_ref?}`。`approved`→`external_approved`；`needs_revision`→等价 1.3 `report_edit`（与之**共用** `services/rework-ops.ts` 原语：`external_revision`+`stale`+建 `scope=report` 工单，文员可再升级到录入）。`services/external-report-feedback.ts` 仅解析回执契约 |

**外部接口（1.1/1.2/1.3）错误响应约定**：统一 JSON `{ok:false,error}`，按状态码分责任方——**400**=请求非法（JSON 解析失败 / 缺 `OrderNumber`·`SysNumber` 等必填，调用方问题）；**404**=资源不存在；**500**=报告系统内部异常（不泄露细节，详情进服务端日志）；**502**=仅 1.4 回传下游 SOAP 失败。**批量接口即使部分条目失败也回 200**，逐条成败看 `results[].ok`/`error`（解析阶段失败才整体 400/500）。对接方完整说明见 `../ref_files/递归智能报告系统_对接接口规范.md` 二节「错误响应」。

**接口 5.1 登录认证（`commonLogin/login`）**：`services/external-auth.ts` 的 `loginViaCommonLogin` + `encodePwd` + `parseLoginResponse`（归一化 `code/jobNo/userName/departName/token`，`0010`=成功）。**配置在 `config/auth.json` + `config/auth.local.json`（部署填，已 gitignore）+ `AUTH_*` 环境变量**：`common_login_url`（**含路径前缀**，现场 `http://172.19.0.27/grgtapi/common-api`）/ `app_id`（现场 `chemistry`）/ `pwd_hash`（`sha1`=明文按 SHA-1 大写加密后发送，OA 要密文不要明文）/ `timeout_ms`。**留空 `common_login_url` = mock 模式**（任意账号密码登录，登录页显示演示账号）；**配了 = 真实模式**（GET `{url}/commonLogin/login?...`，pwd 后端加密、URL 字符串拼接保留前缀、Node fetch 直连不走代理，带超时/404/网络错误清晰提示，`/api/auth/meta` 返回 `login_mock` 供前端隐藏演示账号提示）。⚠️ 认证系统**只返回身份、不返回角色** → 角色权限在本系统**本地 RBAC** 管理。**完整对接规范 + 排错手册见根目录《外部OA登录对接.md》**；独立联调工具见 `../test_api/login/`。

**管理员破冰（内网只用 OA 登录时「无人可审首批角色申请」）** — `routes/auth.ts` 的 `/login` 提供两条互补途径，均配在 `config/auth.json`（可在 `auth.local.json` 覆盖）：① **部门自动授权**`admin_departments`（数组，默认 `["九顶信息化开发管理部"]`）：OA 返回的 `departName` 命中名单 → 该用户登录时自动补 `admin` 角色（保留其它角色），IT/信息化部门用**真实 OA 账号**即为管理员，无弱口令、可审计；置 `[]` 关闭。② **本地管理员旁路**`local_admin`/`local_admin_pwd`（默认 `admin`/`123`）：此账号**跳过 OA** 直接本地登入，`ON CONFLICT` 始终确保 `admin` 角色 + `active`，作为部门名对不上 / OA 不可达时的破冰兜底；分配了真实管理员后把 `local_admin_pwd` 置空 `""`（auth.local.json）即关闭。⚠️ 两条途径都在调用 OA **之前/之后**生效，不改 OA 协议本身。

### 登录 + 本地角色权限（RBAC）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/auth/login` | body `{loginName, pwd, appId?}`→调 5.1 接缝校验身份→本地 `users` 表**首次登录建档**(roles 默认空=待分配)→返回 `{job_no,user_name,depart_name,roles,permissions,token}`。停用账号 403 |
| POST | `/api/auth/sso` | 外部系统深链**免二次登录**（最简方案）：body `{job, key, name?, dept?}`，`key` 须等于服务端 `sso_secret`（timingSafeEqual）→本地建档→返回同 `/login`。未配 `sso_secret`=503 关闭。前端 `auth.tsx` 挂载时若 URL 带 `key/job` 自动调用并落在深链页（如 `/report/order/:orderNo`），随后清 URL 参数。密钥经 URL 传入，安全靠内网兜底。详见《部署说明-Ubuntu.md》§七点五 + 根目录《外部系统报告跳转对接.md》 |
| GET | `/api/auth/me` | 按 `X-User-Job` 头返回当前用户 + 权限；无身份 401（前端 Gate 据此显示登录页） |
| GET | `/api/auth/users` | 列所有用户（**仅 `user.manage`**，`requirePermission` 中间件） |
| PUT | `/api/auth/users/:jobNo` | 改 `{roles?, active?}`（**仅 `user.manage`**）。护栏：不能停用/摘除最后一个 admin |
| GET | `/api/auth/meta` | 角色/权限元数据（角色集 + 标签 + 角色→权限矩阵） |
| POST | `/api/auth/role-requests` | **自助申请角色**（任意登录用户）：body `{roles, reason?}`→建 `role_requests`(pending)。已拥有的角色自动去掉；每人同时只允许 1 条待审（部分唯一索引，违反返 409） |
| GET | `/api/auth/role-requests/mine` | 当前用户自己的申请记录 |
| POST | `/api/auth/role-requests/:id/withdraw` | 撤回自己的待审申请 |
| GET | `/api/auth/role-requests` | 列出申请（**仅 `user.manage`**），`?status=pending`(默认)/`all` |
| POST | `/api/auth/role-requests/:id/review` | 审核（**仅 `user.manage`**）：body `{action:'approve'\|'reject', note?}`。approve＝事务内把申请角色并入 `users.roles`(去重)；reject 必填 note。审核流：`pending → approved/rejected`（或本人 `withdrawn`） |

**角色申请/分配流（migration 032）**：身份来自外部 SSO、**角色本地管理**；分配有两条路径——① 管理员在「用户管理」页直接派角色；② **用户自助申请**（顶部用户名下拉「我的角色 / 申请」→ `pages/Account/MyRoles.tsx`，选角色+理由提交）→ 管理员在「用户管理」页顶部「待审角色申请」面板**审核通过即分配**。权限始终由角色矩阵派生（`shared/rbac.ts`，不单独授权限）。审核通过后用户经 `useAuth().refresh()`（拉 `/me`）无需重登即可拿到新权限。**管理界面放在系统内**（`/admin/users` + `/me/roles`，复用同一登录/`X-User-Job`/`requirePermission`），不另起独立系统。

**身份头**：前端 `auth.tsx` 拦截器发 `X-User-Job`(工号=RBAC 真身份)+`X-Demo-User`(姓名，审核日志 actor，沿用旧约定)+`X-Demo-Role`(主角色)+`Authorization: Bearer`。**角色→权限矩阵**：`shared/rbac.ts`（管理员/实验员/审核员/模板审核/文员 → `record.entry`/`record.review`/`template.edit`/`template.review`/`report.generate`/`report.edit`/`user.manage`），前后端共用。前端 `useAuth().has(perm)` 门控 UI、后端 `requirePermission(perm)` 门控路由（当前硬门控仅用户管理；其余路由的服务端硬校验是后续增量，中间件已就绪）。前端：未登录显示 `pages/Login.tsx`；管理员见「用户管理」`pages/Admin/Users.tsx`（派角色/启停）。

**模拟外部推送（联调/演示）**：`mock-external/push.ts` 调 1.1（固定结构：样品A=密度+弯曲强度/模量、样品B=透光率）+ 预关联原始记录模板 + 1.2 完成取号；**不灌数据**（数据由你到录入台手动录入审核，再到工作台生成），`--mode=whole|per-sample|per-sample-project` 三种拆分分别测试，见 `mock-external/README.md`。

### 原始记录模板（含版本流）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/record-templates` | 列表（带 `current_version_no` / `current_status` / `current_author` / `open_draft` / `parent_template_id` / `last_activity`）。**`?status=approved`** 只返回【当前生效版本已审核通过】的模板（`cv.status='approved'`）——录入关联(`Lab/OrderDetail`)、报告首页选择(`Report/Workbench` 传 `kind=cover&status=approved`) 用它过滤掉未审核模板；项目模板由 `reports.ts` 的 `deriveApprovedAssignments` 同样只取 approved。管理列表页不传该参数、仍看全部 |
| GET | `/api/record-templates/:id` | 当前生效版本完整内容 |
| GET | `/api/record-templates/:id/versions` | 该模板所有版本 |
| GET | `/api/record-templates/:id/versions/:vid` | 某一版本完整快照（「查看此版本」只读模式用） |
| GET | `/api/record-templates/:id/versions/:vid/diff` | 实时 diff：该版本 vs 当前生效版本（审核预览用；属性级，见 `shared/template-diff.ts`） |
| GET | `/api/record-templates/:id/audit-log` | 模板操作日志（template_audit_log，新→旧） |
| GET | `/api/record-templates/:id/lineage` | 母子模板树（ancestors + descendants） |
| POST | `/api/record-templates` | 创建新模板，v1 直接 approved |
| PUT | `/api/record-templates/:id` | 改字段定义 → 创建 / 更新 draft；改 name 等元数据立即生效。可带 `draft_updated_at` 乐观锁，不一致 409；目标是 pending 版本也 409（需先撤回） |
| POST | `/api/record-templates/:id/submit` | body `{version_id, change_summary?}`，draft → pending（作者本人或审核员均可提交）；rejected 版本原样重提会复制内容开新版本号行 |
| POST | `/api/record-templates/:id/versions/:vid/withdraw` | 撤回审核：pending → draft（提交人或审核员） |
| POST | `/api/record-templates/:id/versions/:vid/review` | body `{decision, note}`，需要 reviewer 角色，作者本人不能审。**approve 后自动强制同步**所有有映射的直接子模板（各生成 pending），结果在响应 `child_sync` |
| POST | `/api/record-templates/:id/versions/:vid/rollback` | **回退**：把该（superseded）版本内容克隆为新 draft 并提交审核（pending），审核通过后生效；有未定稿则 409 |
| POST | `/api/record-templates/:id/fork` | body `{name, parent_version_id?}`，派生子模板（自动写母子字段映射 field_mapping） |
| POST | `/api/record-templates/:id/sync-to-children` | 母→子同步：body `{child_ids, include_added?, source_version_id?, dry_run?}`。按映射把母版字段应用到选中直接子模板，各生成 **pending** 版本（须各自审核通过才生效）；有未定稿的子模板跳过；`dry_run:true` 返回每个子模板的变化预览 |
| POST | `/api/record-templates/:id/archive-request` | **申请删除**（body `{note?}`，任何登录用户；migration 023 起删除必须经审批）。重复申请/已归档 409 |
| POST | `/api/record-templates/:id/archive-request/cancel` | 撤销删除申请（申请人或审核员） |
| POST | `/api/record-templates/:id/archive-review` | 审批删除：body `{decision:'approve'\|'reject', note?, force?}`。仅 reviewer 且申请人≠批准人；驳回必填备注；批准即软删归档（record_data 永不物理删除）；有活跃报告模板引用时 409，带 `force:true` 重批解除关联 |
| DELETE | `/api/record-templates/:id` | **已停用**（403）——删除必须走上面的审批流。`GET /?include_archived=1` 看归档列表 |
| POST | `/api/record-templates/:id/restore` | 恢复已归档模板 |
| POST | `/api/record-templates/:id/controlled` | 受控登记：body `{controlled_no, controlled_issue_date, controlled_effective_date}` 写到**当前生效版本**列；GET `/:id` 与 `/:id/versions/:vid` 会把这三列合进 `layout_options.controlled` 供渲染顶部受控行（手动应急通道，接口⑦就绪后由外部回传） |

### 报告模板（与原始记录模板同结构）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/report-templates?kind=cover\|project` | 列表（可按 kind 过滤） |
| GET / POST / PUT / DELETE | `/api/report-templates/...` | 同 record-templates |
| 版本流 / withdraw / diff / audit-log / fork / lineage / sync-to-children / archive-request·review | 同 record-templates，路径替换 | 共用 `services/template-versions.ts` |
| GET | `/api/report-templates/:id/binding-check` | 映射引用完整性校验：当前版本（可 `?version=vid`）所有数据绑定 vs 关联原始记录当前版本字段集，返回 `{linked, warnings:[{path,label,source,reason,detail}]}`。PUT（存草稿）/ approve 审核的响应也带 `binding_warnings` |

### 录入数据

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/record-data?order_no=X` | 实验记录列表（按单号过滤） |
| GET | `/api/record-data/:id` | 单条记录详情 |
| POST | `/api/record-data` | 提交录入。需要 tester 身份。body 带 `status`：`'draft'`=存草稿（不进审核队列）/ 缺省 `'pending'`=提交审核。upsert 命中已有记录按 status 落库 |
| POST | `/api/record-data/:id/submit` | 草稿 / 被退回 → 待审核（详情页主检用，数据已存，仅状态流转）。写 `submit` 日志 |
| POST | `/api/record-data/:id/withdraw` | 待审核 → 草稿（主检撤回尚未被审的记录）。写 `update`(撤回) 日志 |
| PUT | `/api/record-data/images` | **单独上传/更新图片字段**（与完整录入解耦：详情页「上传图片」+ 移动端拍照页）。body：`{template_id, order_no?, sample_external_id?, test_item_name?, field_code, images:[]}`。只合并该 `field_code`，不动其它字段；找不到记录则新建（图片可先于数据）；属数据变更 ⇒ 重置 `pending` + 写审计。⚠️ 注册在 `PUT /:id` 之前 |
| PUT | `/api/record-data/:id` | 更新录入。body 带 `status`（draft/pending），按 status 落库，写 `update` 日志 |
| POST | `/api/record-data/:id/review` | 审核：body `{decision: 'approve' \| 'reject', note?}`。需要 reviewer 身份；不能与主检同一人；**仅 `pending` 可审**（草稿/已审/退回均拒）；reject 必须带 note |

### 审核日志

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/audit-log?order_no=X` | 按单号拉事件流（含 `version_no` / `data_snapshot` / `status_after`） |
| GET | `/api/audit-log?record_id=N` | 按某条记录拉事件流 |

### 退回 / 返工工单 + 时间线（P-Flow-1）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/rework?order_no=&target_stage=&status=&scope=` | 列工单（任意组合过滤）。主检看 `target_stage=data_entry&status=open` |
| POST | `/api/rework` | 建工单（场景1：报告→录入退回）。body `{order_no, scope:'record', record_data_id, origin_stage:'report_gen', target_stage:'data_entry', reason}`。scope=record+target=data_entry 时连带把 `record_data` 置退回态 + 写一条 reject 审计 |
| POST | `/api/rework/:id/resolve` | 解决工单（body `{resolution_note?}`） |
| GET | `/api/orders/:order_no/timeline` | 全订单时间线：`rework_tickets` + `record_audit_log` + `report_audit_log`（JOIN reports 取 order_no）按时间合并，返回 `{order_no, events:[{type,ts,actor,title,detail,...}]}` |

> 闭环：数据 reject→主检改→重审 **approve 时**自动 `UPDATE reports SET stale=true WHERE 引用该记录` + 自动 resolve 该记录的待返工工单（`record-data.ts` review 分支）。

### 报告生成

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/reports/preview` | 实时预览（不入库）。接受空 `project_assignments` → 渲染**仅首页**（cover-only） |
| POST | `/api/reports/cover-draft` | **首页草稿（order 级）**：幂等创建/返回该订单的 cover-only 首页实例（`is_cover_draft=true` 的 reports 行），供「编辑首页」用 `InstanceEditor` 编辑。body `{order_no, cover_template_id, cover_page_template_id?}` → `{report_id, existed}`。已存在则直接返回（保留文员已编辑内容） |
| POST | `/api/reports/generate-by-order` | 按委托单号 + cover + 多项目模板生成**单份**报告（旧流程，保留） |
| POST | `/api/reports/generate-batch` | **按批次生成多份报告**（**前端已不调**，手动拆分入口已撤；保留兼容）。body：`{order_no, cover_template_id, split_mode, reports:[…], mock_context}`。报告拆分现由外部取号决定，见 `/external/requisitions/generate` |
| GET | `/api/reports?order_no=X` | 查询单号下已生成报告（含 `batch_id` / `report_no` / `scope` / `edited`）。**永远排除 `is_cover_draft` 首页草稿**，并**排除被取代的历史版本（`superseded_by IS NULL`）**——历史版本只在 `/:id/versions` 查看 |
| GET | `/api/reports/:id` | 报告详情 |
| GET | `/api/reports/:id/pdf` | 下载 PDF（对任意 id，含历史版本，都按其 `final_typst` 编译） |
| GET | `/api/reports/:id/versions` | **报告历史版本链**：沿 `superseded_by` 自指链上溯+下溯，返回 `[{id,report_no,version,generated_at,generated_by,edited,is_current}]`（按时间倒序）。退回修改→重新生成会保留旧版，工作台「历史版本」抽屉用，历史 PDF 走 `/:id/pdf` |
| GET | `/api/reports/:id/docx` | 下载 DOCX（PDF→DOCX，LibreOffice headless） |
| POST | `/api/reports/preview-content-doc` | 结构化编辑实时预览（传 `content_doc`，不入库，返回 PDF） |
| POST | `/api/reports/apply-cover` | **把订单首页草稿套用到已生成报告**：body `{order_no, report_ids[]}`。逐份把报告 `content_doc.cover.groups`（结构/图片 `image_photos`/手改字面量）+ `cover.layout_options.theme_config`（样式）换成草稿的，**保留各报告自己的 `cover.ctx`（报告号/样品/结论）/`header_footer`/`projects`**，`renderContentDoc` 重渲染 `final_typst`、`edited=true`、写审计。哪些报告套用由前端勾选。⚠️ **已送审未退回（`external_status='submitted_external'`）与数据退回锁定（有未关闭 data_entry 工单）的报告都会被后端拒绝**（前者终态、后者等待数据重审，各返回该条 `ok:false`）——前端在「报告退回」场景下也只列出被退回且可编辑(`external_revision` 且 `data_rework_open=false`)的报告作为套用目标，正常场景默认勾未单独编辑过的、并排除已送审与数据锁定。`GET /api/reports` 响应含 `data_rework_open` 布尔字段供此判断。解决"编辑首页后已生成报告不更新"——新生成的报告本就经 `cover_groups_override` carry，此接口补"回填已生成的" |
| GET | `/api/reports/:id/audit` | 报告编辑留痕（生成 + 每次编辑的字段级 diff：谁/何时/把什么从 X 改成 Y） |
| PUT | `/api/reports/:id` | 二次编辑保存。传 `content_doc` = 结构化编辑（服务端按实例文档重渲染 `final_typst`，标记 `edited=true`，**不回写 record_data**）；传 `final_typst` = 原始 Typst 覆盖 |

### 其他

| 方法 | 路径 | 说明 |
|------|------|------|
| GET / POST / DELETE | `/api/equipment` | 设备库 |
| POST | `/api/equipment/import` | Excel 一键 upsert（按"管理编号"主键） |
| GET | `/api/equipment/lookup?codes=A,B` | 批量查 |
| POST | `/api/excel-import/parse` | 上传 Excel，返回 sheet 列表 + 预览 |
| POST | `/api/excel-import/extract` | 按映射配置提取指定 sheet |
| POST | `/api/excel-import/:id/attachments` | 给某条 record_data 存附件（form 字段 `kind`：`excel`＝导入留存的 Excel / `file`＝通用附件任意格式，缺省 file）。**按 `<根>/<订单号>/<样品名_测试项目名>/<附件名>` 分文件夹存**（由 recordId 反查订单/样品/项目，见 `services/upload-paths.ts`），DB `attachments[].path` 存相对路径。通用上传走 `client/components/AttachmentManager.tsx`（订单详情页每行「附件」弹窗 + 录入页底部，两处同一出口、同步、可下载） |
| GET | `/api/excel-import/:id/attachments/:fileId` | 下载某条记录的附件（`resolveStoredFile` 解析相对路径 + 历史扁平回退） |
| POST | `/api/images/upload` | 上传图片。form 附带落盘上下文 `order_no`/`record_dir`（样品名_测试项目名，首页传 `_首页`）/`field_name`，**存到 `<根>/<订单号>/<record_dir>/<字段名>.ext`**（同字段多图自动 -2/-3），返回 `{name, original_name, server_path, rel_path, url}`（`url=/api/images/file?p=<相对路径>`） |
| GET | `/api/images/file?p=<相对路径>` | 按新结构相对路径读图（越界防护 + 历史扁平回退） |
| GET | `/api/images/:name` | 历史扁平图片兼容（旧引用 `url=/api/images/<文件名>`） |
| GET / POST | `/api/proposals` | 临时字段提议（API 已有，UI 未启用） |
| GET / POST | `/api/mappings` | v1 字段映射（保留兼容） |

> 所有写操作都从 `X-Demo-User` / `X-Demo-Role` 头读身份。生产 SSO 接入见第四节 4.2。


---

## 八、数据库 + Migration 一览

| 表 / 列 | Migration | 说明 |
|---|---|---|
| `_migrations` | 000 | Migration 记录表 |
| `record_templates` | 001 | 原始记录模板基本表 |
| `record_data` | 002 | 实验记录数据（raw_data + derived_data） |
| `report_templates` | 003 | 报告模板基本表 |
| `report_template_mappings` | 004 | v1 字段映射（保留兼容） |
| `ad_hoc_field_proposals` | 005 | 临时字段提议（API 骨架，UI 未启用） |
| `record_data.attachments` | 006 | 加 attachments JSONB 列（Excel 等附件） |
| `equipment_library` | 007 | 仪器设备库（45 列原始 Excel 存到 `raw_payload`） |
| `report_templates.template_kind` 等 | 008 | 报告模板加 cover/project 拆分 + linked_record_template_id + layout_options |
| `reports` | 009 | 已生成报告快照（final_typst + blocks_snapshot + data_snapshot + warnings + version） |
| `report_templates.field_definitions` | 010 | report_templates 加 v3 groups 列 |
| `work_orders` | 011 | 委托单（order_no PK + customer / received_at + payload JSONB 嵌套 samples / test_infos）。`test_infos[].linked_template_ids: number[]` 一对多关联（旧单值 `linked_template_id` 仍兼容读取） |
| `record_data.order_no` 等 3 列 | 011 | record_data 加 order_no / sample_external_id / test_item_name |
| `record_data.tester_name` 等 5 列 | 012 | 加 tester_name / tested_at / reviewer_name / reviewed_at / audit_status |
| `record_audit_log` | 012 | 审核事件流（record_id / order_no / action / actor_name / actor_role / note / created_at） |
| `record_audit_log.version_no` 等 4 列 | 013 | 加 version_no / data_snapshot / status_after / diff_summary |
| `record_data.current_version` 等 2 列 | 013 | 加 current_version / reject_note |
| `record_template_versions` / `report_template_versions` | 014 | 模板版本流水表（append-only，含 status / author / reviewer / change_summary / diff_from_prev） |
| `record_templates.current_version_id` 等 | 014 | 模板加 `current_version_id` / `parent_template_id` / `parent_version_id` |
| `record_templates.test_project_id` 删除 | 015 | 业务上"关联测试项目"的概念已被 work_orders 替代 |
| `record_data.template_version_id` | 016 | 录入数据锁定模板版本——历史数据按当时快照渲染，不被模板后续修改影响（合规） |
| base 表删 field_definitions / typst_source / layout_options 三列 + 加 archived_at | 017 | 取消 dual-write，所有读路径强制 JOIN 版本表；模板软删，record_data 永不物理删除（合规） |
| `report_batches` + `reports.batch_id/report_no/scope/content_doc/edited` | 018 | 报告批次：一单出多份报告（按样品/按项目/自由）。一个 batch 挂多行 reports，每行带 scope（含哪些 样品×项目）。`content_doc`/`edited` 给 P2（报告结构化可编辑）用 |
| `report_audit_log` + `reports.content_doc_original` | 019 | 报告编辑留痕（生成/编辑事件 + 字段级 diff）+ 生成时原始实例快照（不可变基线，编辑器据此对"偏离原始数据"的字段告警）|
| `rework_tickets` + `reports.stale` | 020 | 退回/返工工单（P-Flow-1，场景1）：order_no/scope/origin_stage/target_stage/reason/status + parent_ticket_id 链式升级；`reports.stale` 标记源数据已更新需重新生成 |
| `record_template_versions.controlled_no/_issue_date/_effective_date` | 021 | 原始记录模板版本的受控信息（受控号/颁布/实施日期），印在记录顶部受控行；随版本冻结（版本锁定回放）。受控登记 `POST /:id/controlled` 写入（手动应急；接口⑦回传同写此处）|
| `template_audit_log` | 022 | 模板操作审计：创建/改草稿/提交/撤回/审核/fork/同步/归档/恢复/改名/受控登记 全事件流（template_id 无 FK——模板软删后日志仍可查） |
| `*_template_versions.updated_at` | 022 | 草稿保存乐观锁（PUT 带 `draft_updated_at`，不一致 409 防并发互盖） |
| `*_templates.field_mapping` | 022 | fork 子模板的母子字段映射 `{groups:{childId:parentId}, fields:{childId:parentId}}`，母→子同步据此应用；解除母子关系时清 NULL |
| `*_templates.archive_requested_by/_at/_note` | 023 | 删除（归档）审批流：申请人/时间/原因三列。批准归档或驳回/撤销后清空；直接 DELETE 已停用 |
| `work_orders.source` | 024 | 委托单来源：`external`（接口同步，默认）/ `manual`（界面手动新建）。手动单不被启动 seed 覆盖 |
| `work_order_audit_log` | 025 | 订单结构变更留痕（order_no/actor/summary/detail JSONB）。结构编辑不走数据审核流但可溯源 |
| `report_requisitions` | 026 | 报告取号单（接口 1.2 PushReportInfos 每条报告一行）：order_no/sys_number(UNIQUE)/report_number/check_code/language/sample_name/issue_date/header_footer(JSONB)/scope(JSONB)/match_result(JSONB)/report_id/status/stale。报告编号与范围由外部取号决定，系统按 样品名+项目名 回查 record_data/关联报告模板 |
| `report_requisitions.delivery_status` 等 | 027 | 报告回传留痕（接口 1.4）：delivery_status（none/sent/failed）/delivered_at/delivery_error |
| `reports.external_status` 等 | 028 | 报告外部回执状态机（P-Flow-2 场景3）：external_status（none/submitted_external/external_approved/external_revision）/external_ref/external_suggestion/external_feedback_at。needs_revision 时建 scope=report/origin=external 返工工单 |
| `reports.is_cover_draft` | 029 | 首页草稿标记（order 级，每单至多一份，部分唯一索引 `uq_reports_cover_draft`）。取号前文员编辑"首页实例"的载体，复用 reports 行 + `InstanceEditor`；`GET /reports` 列表永远排除；取号生成时其 `content_doc.cover.groups` 作 `cover_groups_override` carry 到每份报告 |
| `users` | 030 | 本地用户与角色（RBAC）：`job_no` PK / user_name / depart_name / `roles TEXT[]` / active / last_login_at。身份来自外部认证（接口 5.1），**角色本地分配**；角色→权限矩阵在 `shared/rbac.ts`（不入库）。预置 admin + 各角色演示账号 |
| `role_requests` | 032 | **用户自助申请角色**工单：`job_no` / `requested_roles TEXT[]` / reason / status(pending→approved/rejected/withdrawn) / reviewer_* / review_note。每人同时只允许 1 条 pending（部分唯一索引）。管理员审核通过即把角色并入 `users.roles` |
| — | 033 | **角色重构**：`users.roles` / `role_requests.requested_roles` 旧角色名 → 新（tester→test_engineer、reviewer→test_supervisor、template_reviewer→report_reviewer、clerk→report_clerk）。幂等 `array_replace` |
| `reports.superseded_by` + `report_requisitions.record_state`/`last_modify_remark` | 034 | **报告退回修改（接口 1.3 RefreshReportInfo）**：`reports.superseded_by`(自指 FK)＝重新生成时旧报告被新版取代的链（历史版本，旧行保留可重编 PDF；`GET /reports` 列表按 `IS NULL` 只显当前版，`/:id/versions` 看全链）。`report_requisitions.record_state`(外部审核状态 草稿/审核中/审核通过/审核不通过) + `last_modify_remark`(1.3 退回备注 Remark)；签发时间 SecondAuditDate 复用既有 `issue_date` 不新增列 |

### 关键索引

```sql
CREATE INDEX idx_rtv_template_version  ON record_template_versions(template_id, version_no DESC);
CREATE INDEX idx_rtv_status            ON record_template_versions(status) WHERE status IN ('pending', 'draft', 'rejected');
CREATE INDEX idx_record_data_order_no  ON record_data(order_no);
CREATE INDEX idx_audit_log_order       ON record_audit_log(order_no);
CREATE INDEX idx_audit_log_version     ON record_audit_log(record_id, version_no);
```

### 性能策略（5000+ 模板规模）

- 列表页只 SELECT 元数据（不取 `field_definitions`）
- 版本列表懒加载（开 Drawer 时才查）
- Lineage 用 PostgreSQL 递归 CTE，单次查询拉全树
- 单模板版本数 <100 时查询稳定 < 5ms
- typst-compiler LRU 缓存：相同 typst 源码不重复编译
- 估算：5000 模板 × 平均 20 版本 ≈ 10 万行版本，JSONB ~2 GB，PG 单机 hold 得住

---

## 九、DOCX 导出技术路径

```
final_typst (reports.final_typst, JSONB)
       │
       ▼  compileTypst() — services/typst-compiler.ts，spawn typst CLI
PDF Buffer
       │
       ▼  convertPdfToDocx() — server/src/routes/reports.ts
       │  spawn soffice 子进程，临时目录 mkdtemp 隔离
       │  args: --headless --infilter=writer_pdf_import --convert-to docx --outdir <tmp> <pdf>
DOCX Buffer
       │
       ▼  HTTP 200 application/vnd.openxmlformats-officedocument.wordprocessingml.document
```

### 关键决策

- **不走 Typst → DOCX 直转**：Typst 官方只输出 PDF/PNG/SVG，社区 `typst-to-docx` 对复杂 `table.cell` 不成熟
- **必须加 `--infilter=writer_pdf_import`**：LibreOffice 默认遇到 PDF 走 **Draw** 路径，无 docx 导出筛选器，会报 `no export filter for ... aborting`。强制用 **Writer** 路径加载，PDF 被识别为可编辑文本流，才能导出 docx
- **同步 spawn 而非异步队列**：单份报告转换 ~2-4 秒（LibreOffice 冷启动占大头），并发请求自然排队。Demo 阶段不上专门的 LibreOffice 服务（unoserver / docker-libreoffice），后续要扩张并发再考虑

### 已知保真度损失（重要——交付前要让用户知道）

| 损失 | 原因 | 影响 |
|---|---|---|
| 合并单元格被拆 | PDF 没有 colspan/rowspan 元数据，仅有像素位置 | 数据矩阵的汇总列（rowspan）、汇总行（colspan）变成普通格子 |
| 段落变文本框 | LibreOffice 逐字符识别后聚合 | 长段落 OK，但表格交错处可能多余换行 |
| 字体替换 | 思源宋体 / Songti SC 在 Word 端缺失会回退 | 行距、字间距漂移 |
| 页眉页脚装饰丢失 | Typst 用绝对定位画的边框/线条无法还原 | `@local/record-theme` 的页眉页脚需在 Word 里手动调 |

### 不适用场景

- 客户要"DOCX 是正式交付物，要保留可编辑结构"：本路径不行，需要走原生 docx 生成（重写 typst-generator → docx，工作量约 1-2 周）
- 客户要"DOCX 跟 PDF 像素级一致"：不可能。建议主交付物保持 PDF

### 改这条路径时去哪改

| 想做的事 | 文件 | 函数 |
|---|---|---|
| 改 soffice 参数 / 错误处理 / 临时目录策略 | `server/routes/reports.ts` | `convertPdfToDocx()` |
| 加 Workbench 实时预览阶段的 DOCX 下载 | `routes/reports.ts` 加 `POST /preview-docx` + `Workbench.tsx` 加按钮 | 同上 |
| 换更高保真方案（路径 B：直接 Typst→DOCX） | 重写 `shared/typst-generator.ts` 为 docx 生成器（用 `docx` npm 包） | 整个文件 |

---

## 附：跑起来 5 步

完整说明见 [`RUNNING.md`](./RUNNING.md)。

```bash
pnpm install
createdb cdr_demo && pnpm migrate
bash scripts/install-typst-packages.sh
pnpm dev   # 5173 + 3001
```

---

## 附：相关文档

| 文档 | 内容 |
|---|---|
| `RUNNING.md` | 怎么跑起来（环境 / 配置 / 内网部署） |
| `OPTIMIZATION.md` | 待优化事项 backlog（已知但未实现的优化/设计改进项，按优先级累积） |
| `待实现内容.md` | 外部接口对接说明（委托单数据源 / SSO / 审批系统 等：已实现/mock/未实现 + 接口契约 + 替换点） |
| `报告映射方案.md` | 报告结果表映射设计 + 分期落地记录（P-Map-N）：表头可绑定、统一绑定选择器、「试样带」按实际样品数自动展开，解决录入增删样品导致映射失效的问题 |
| `.claude/skills/modify-system/SKILL.md` | **改代码前必读** — 5 阶段工作流（ORIENT/SCOPE/CHANGE/SYNC/AUDIT），自动同步文档 + 自审 |
| `项目背景.md` | 业务背景 + 难点 + 价值（早期产物，背景参考） |
| `docs/` | 归档文档（早期方案/规范），见 `docs/README.md`。含 `docs/背景/系统技术方案_v3.md` 等 |
