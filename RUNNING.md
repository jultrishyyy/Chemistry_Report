# 运行说明

> 系统总览见 [`README.md`](./README.md)（项目结构 + 已实现功能 + 改 X 速查表）。本文件只讲"怎么把它跑起来"。

---

## 前置条件

| 工具 | 版本要求 | 当前已验证 |
|---|---|---|
| 操作系统 | macOS / Linux | Darwin 23.6.0 |
| Node.js | ≥ 20 | v25.8.0 |
| pnpm | ≥ 9 | — |
| PostgreSQL | ≥ 15 | 16.13 |
| Typst CLI | ≥ 0.11 | 0.14.2 |
| LibreOffice | 用于 .xls → .xlsx 转换 + PDF→DOCX 导出 | — |
| Conda | Python 3.11 环境 | — |

macOS 一键安装：

```bash
brew install node pnpm postgresql@16 typst
brew install --cask libreoffice
```

LibreOffice 默认路径 `/Applications/LibreOffice.app/Contents/MacOS/soffice`；其他平台用 PATH 中的 `soffice`，环境变量 `SOFFICE_BIN` 可覆盖。

---

## 首次设置

```bash
cd demo_v1

# 1. 安装 Node 依赖（根 + client + server）
pnpm install
cd client && pnpm install && cd ..
cd server && pnpm install && cd ..

# 2. 配置（DB 密码等）
cp config/database.local.json.example config/database.local.json   # 本地 PG 可留空
# 接外部 OA 登录（不配=mock 模式，任意账号密码登录，仅本机演示）
cp config/auth.local.json.example config/auth.local.json   # 填 common_login_url + app_id

# 3. 创建数据库 + 跑全部 migration（自动按序应用所有未执行的，当前到 033）
createdb cdr_demo
pnpm migrate

# 4. 安装本地 Typst 包（公司级排版主题）
bash scripts/install-typst-packages.sh

# 5. （可选）创建 Python 环境，用于 .xls → .xlsx 批转
conda create -n cdr_demo python=3.11 -y
conda activate cdr_demo
pip install -r requirements.txt
bash scripts/convert-xls.sh
```

---

## 日常开发

```bash
# 同时启动前后端，热重载（推荐）
pnpm dev

# 或分别启动
pnpm dev:server   # http://localhost:3001
pnpm dev:client   # http://localhost:5173
```

- 前端 Vite 默认 5173，会把 `/api/*` 代理到后端 3001
- 改前后端代码即时生效，无需手动重启
- 服务端启动时会 seed（均按 name 幂等，已存在跳过、不覆盖用户改动 ⇒ 迁移到全新空库的服务器默认即带这套模板）。
  模板内容＝运行系统里真身的【完整配置快照】（逐字段一致，含间距/图片/绑定；存于 `shared/seed-*.data.ts`，由
  `scripts/dump-seed-templates.ts` 导出）：
  - **原始记录模板**：基础原始记录模板、密度和相对密度试验原始记录、透光率雾度试验原始记录、塑料弯曲测试报告
  - **报告模板**：标准检测报告首页(cover)、密度试验项目报告、透光率试验项目报告、弯曲强度&弯曲模量(project，按 name 关联回原始记录)
  - 3 张 mock 委托单（C202512086592 / 86593 / 86594）
  - 另有演示用 `seed-mock-by-sample.ts`：若库里已有 `MOCK-EXT-001`（整单出一份），自动复制出 `MOCK-EXT-002`（按样品出，每样品一份取号报告）供「生成报告」演示

### 数据库迁移

新加 SQL 文件丢到 `db/migrations/NNN_xxx.sql`，然后：

```bash
pnpm migrate
```

`db/migrate.ts` 是 runner——已应用过的会跳过。**不要改已存在的 migration 文件**，加新的就行。

### 验证 Typst

```bash
typst compile samples/typst/manual-record.typ samples/typst/out.pdf
```

中文用思源宋体 / Songti SC，正常情况无需额外配置。

### 字体（项目 `fonts/` 目录 — 跨服务器一致）

`server/src/services/typst-compiler.ts`：**只要 `demo_v1/fonts/` 里有字体文件，就只用本目录渲染**（`--font-path fonts --ignore-system-fonts`）——报告版面在任何服务器上一致，不受该机器系统字体影响。`fonts/` 没字体时回退到系统字体（如刚 clone）。

- 当前打包：宋体(Songti SC)/黑体(SimHei)/楷体(KaiTi)/仿宋(FangSong)/仿宋_GB2312/Arial/Times New Roman（全完整字体）。
- **英文/数字默认 Arial**（主题 `_with-latin` + `styleSetRules` 把 Arial 垫在字体列表最前，中文自动回退到中文字体）。
- ⚠️ 字体多为**专有字体**，`.gitignore` 排除不入库——**部署到别的服务器要手动把 `fonts/` 的字体文件一起拷过去**，否则会回退系统字体或缺字。
- 加字体：丢进 `fonts/` → `typst fonts --font-path ./fonts --ignore-system-fonts` 查 family 名 → 在 FormatPanel/DocumentStylePanel 字体列表加一行 → 重启。详见 `fonts/README.md`。

---

## 配置说明

### 加载优先级

```
环境变量 > config/*.local.json > config/*.json
```

环境变量命名：`DB_PASSWORD` / `DB_HOST` / `DB_USER` 等。

### 性能 / 并发调优（可选环境变量）

部署在多人共用（如内网 200 人）场景时，这两个值按机器规格调：

| 环境变量 | 默认 | 作用 |
|---|---|---|
| `DB_POOL_MAX` | `20` | 共享数据库连接池最大连接数（`server/src/db.ts`）。全进程一个池，不是每路由一个。需 ≤ PostgreSQL 的 `max_connections`。 |
| `TYPST_MAX_CONCURRENCY` | `4` | 同时在跑的 typst 编译子进程数上限（`services/typst-compiler.ts`）。每个编译是 CPU 密集型，建议设为 CPU 核数的一半左右，过大反而拖慢。 |
| `TYPST_CACHE_DIR` | `<tmpdir>/cdr-typst-pdf-cache` | 编译产物磁盘缓存目录（按 source sha256 落盘，报告 PDF 编译一次后读盘、重启仍命中）。可指向独立磁盘/共享卷；设 `off` 关闭磁盘缓存（只留进程内 LRU）。可随时清空。 |
| `TYPST_CACHE_MAX_FILES` | `2000` | 磁盘缓存最多保留多少个 PDF，超出按 mtime 删最旧的（每 50 次写触发一次清理）。 |

示例：`DB_POOL_MAX=40 TYPST_MAX_CONCURRENCY=6 PORT=5173 pnpm serve`

### 数据库 (`config/database.json` + `config/database.local.json`)

```json
// database.json
{
  "host": "localhost",
  "port": 5432,
  "database": "cdr_demo",
  "user": ""
}

// database.local.json
{
  "password": "（本地 PG 不设密码可留空）"
}
```

### 外部 OA 登录 (`config/auth.json` + `config/auth.local.json`)

身份认证走外部 OA 的 `/commonLogin/login`（接口 5.1，GET，参数 `loginName`/`pwd`/`appId`）。**认证系统只校验身份，不给角色——角色/权限在本系统本地分配。** 完整对接规范+排错见根目录 **《外部OA登录对接.md》**。

```json
// config/auth.local.json（部署到内网时填，已被 .gitignore 忽略；不存在=mock 模式）
{
  "common_login_url": "http://172.19.0.27/grgtapi/common-api",  // OA 地址，含路径前缀！不是裸 :80
  "app_id": "chemistry",                                         // 接入方应用标识（现场值）
  "pwd_hash": "sha1",                                            // 密码加密：sha1=明文SHA-1大写后发 / none=原样
  "timeout_ms": 10000
}
```

- **不配 `common_login_url`（或留空）= mock 模式**：任意账号 + 任意密码即登录，登录页显示演示账号，仅本机调试用。
- **配了 = 真实 OA 模式**：服务端把用户**明文密码 SHA-1 大写加密**后，GET `{common_login_url}/commonLogin/login?loginName=&pwd=&appId=`（地址前缀靠字符串拼接保留），`code='0010'` 为成功，取回 `jobNo/userName/departName/token`；登录页不再显示演示账号。
- 也可用环境变量覆盖：`AUTH_COMMON_LOGIN_URL` / `AUTH_APP_ID` / `AUTH_PWD_HASH` / `AUTH_TIMEOUT_MS`。
- 启动日志会打印当前模式：`[config] OA 登录=真实(...)` 或 `mock(...)`。
- 首次用某 OA 工号登录会在本地 `users` 表自动建档（**无角色**，待 `admin` 在「用户管理」分配，或用户自助申请→审核）。
- 排错：地址/前缀错(404)→检查 `common_login_url` 带 `/grgtapi/common-api`；OA 不可达→「无法连接 OA 认证服务」，在服务器 `curl` 直测连通性；真实账号明文登录失败→可能密码加密非 SHA-1，见《外部OA登录对接.md》§5 自检。**内网联调确认服务器能访问 `172.19.0.27`**。

### 报告回传 1.4 (`config/report-delivery.json` + `config/report-delivery.local.json`)

接口 1.4 报告 PDF 回传（**SOAP**，本系统作客户端调业务系统 WCF）。**实际方法（据 WSDL `http://172.18.0.97:8003/lab/chemistry`）= `PushReportFile(string sysNumber, string file, string jobNo)`**——**三个**平铺字符串参数；规范文档里写的 `AcceptReportFromDiGui` 在该服务不存在，已按 WSDL 校正。⚠️ **少 `jobNo`（委托单业务员工号）对方会拒收**。

```json
// config/report-delivery.local.json（部署填；不存在或 soap_endpoint 空 = mock，不真发 → 对方收不到）。值已按 WSDL 填好。
{
  "soap_endpoint": "http://172.18.0.97:8003/lab/chemistry",         // 业务系统 SOAP 端点（空=mock）
  "target_namespace": "http://tempuri.org/",
  "method": "PushReportFile",                                       // 回传报告文件方法
  "param_id_name": "sysNumber",                                     // 第1入参标签（报告 SysNumber）
  "param_file_name": "file",                                        // 第2入参标签（PDF Base64）
  "param_jobno_name": "jobNo",                                      // 第3入参标签（委托单业务员工号 JobNo）
  "soap_action": "http://tempuri.org/IChemistryService/PushReportFile",
  "soap_version": "1.1",
  "timeout_ms": 30000
}
```

- 出口：报告工作台「送审/全部送审」→ `POST /api/external/requisitions/:id/deliver` → 编译 PDF→Base64→取委托单 `JobNo`→`submitReportToDiGui(sysNumber, base64, jobNo)`→构 `PushReportFile` SOAP 信封发 `soap_endpoint`。
- `jobNo` 取自委托单（1.1）`work_orders.payload.meta.job_no`（业务员工号）；委托单没带工号则为空并打 warning。
- 环境变量可覆盖：`DELIVERY_SOAP_ENDPOINT` / `DELIVERY_METHOD` / `DELIVERY_PARAM_ID_NAME` / `DELIVERY_PARAM_FILE_NAME` / `DELIVERY_PARAM_JOBNO_NAME` / `DELIVERY_SOAP_ACTION` / `DELIVERY_TARGET_NAMESPACE`。
- 启动日志：`[config] 报告回传(1.4)=SOAP(...)` 或 `mock(...)`。
- ⚠️ **soap_endpoint 为空＝mock，只返回成功不真发，对方收不到** —— 生产务必配成 `http://172.18.0.97:8003/lab/chemistry`。方法名/三个参数标签名以对方 WSDL 为准，改本配置即可、无需改码。

### 报告页眉页脚默认 (`config/header-footer.json`)

报告页眉页脚的**默认版式 + 取号前示例数据**，随代码部署（不像数据库会丢）。直接编辑这个文件即可改**所有报告**的页眉页脚默认；报告模板若自配 `layout_options.header_footer` 仍优先于此。

- `settings`：版式/样式——字体 `font`、标题 `title_*`、页面/边距 `page_height`/`top_margin`/`bottom_margin`、各处间距 `*_gap`/`*_leading`，以及**分割线开关 `header_rule`/`footer_rule`**（`false`=隐藏页眉/页脚那条线，对齐参考样张；不配会回退主题默认 `true`、把分割线显示出来）。
- `sample_meta`：**取号前**文员编辑首页/预览用的示例公司信息（名称/地址/电话/资质备注/签发日期）。取号后由接口 1.2（`ReportNumber`/`CheckCode`）真实回填，不读本文件。
- `apply_to`：`{cover, project}`，默认都 true（页眉页脚是文档级、首页+项目共用一套）。
- 启动日志：`[config] 页眉页脚默认=header-footer.json(N 项)（分割线 header_rule=false）`。
- 可选 `config/header-footer.local.json` 覆盖（部署机微调、不入库）。

### 上传文件存储目录 (`config/storage.json` + `config/storage.local.json`)

用户上传的**图片 / Excel 附件**存放目录，默认＝**项目目录的上一级 `data/`**（如项目在 `/opt/cdr-demo`，则默认 `/opt/data`）。**数据库数据本就在 PostgreSQL 自己的数据目录、不在代码文件夹里**（覆盖代码不会动到它）；上传文件默认也放在代码目录【之外】，所以「整包覆盖代码」升级不会丢图片/附件。想换到别处（如数据盘 `/data`）才需配置。

```jsonc
// config/storage.local.json（仅当想换默认位置时填；已被 .gitignore 忽略；改完重启生效）
{
  "uploads_dir": "/data"   // 绝对路径；留空/不配=默认「项目上一级/data」；相对路径相对仓库根
}
```

- 优先级：环境变量 `STORAGE_UPLOADS_DIR` > `storage.local.json` > `storage.json`（默认空＝项目上一级/data）。
- 启动日志：`[config] 上传目录=/opt/data`。

**目录结构**（按订单与原始记录分开存，人类可读、不混在一起）：

```
<根>/
└─ <订单号>/
   ├─ <样品名>_<测试项目名>/         ← 一条原始记录一个子文件夹
   │   ├─ <字段名>.jpg               ← 图片：文件名=对应字段名（同字段多图自动 字段名-2/-3）
   │   └─ <附件名>.xlsx              ← 附件：文件名=原附件名（重名自动 附件名-2）
   └─ _首页/                          ← 报告首页(封面)图片(不属任何原始记录)
       └─ <字段名>.png
```

- 落盘位置由上传时的上下文（订单号 / 样品名_测试项目名 / 字段名）决定，目录不存在自动创建；非法字符（`/ \ : * ? " < > |`）自动替换为 `_`。
- 图片 PDF 渲染读绝对路径 `server_path`（typst `--root /`，任意位置可读）；浏览器预览走 `GET /api/images/file?p=<相对路径>`。
- **历史扁平文件兼容**：旧版扁平存在 `server/uploads`（图片在 `images/` 子目录）下的文件仍能读（按文件名回退查找），无需强制迁移。

**把历史扁平文件迁入新结构**（一次性脚本，旧文件本就能继续访问、迁移可选）：

```bash
# 预览(DRY-RUN，不改动)：列出将搬动的文件 + 改写的引用
pnpm exec tsx db/migrate-uploads-layout.ts
# 确认无误后执行：搬文件 + 改写 record_data(图片/附件) 与 reports(content_doc + final_typst) 引用
CONFIRM=1 pnpm exec tsx db/migrate-uploads-layout.ts
```

- 同一物理文件被多处引用只搬一次、所有引用改到同一新路径；图片文件名取【字段名】、附件取【原附件名】，重名自动加 -2。
- **会同时重渲染 reports.final_typst**（PDF 实际编译的是 final_typst，含图片绝对路径，不重渲会渲染失败）。
- 无订单号的历史记录跳过（仍走旧兼容）。脚本幂等，可重复跑。
- ⚠️ 跑前先备份：`pg_dump cdr_demo > backup.sql` + 拷一份旧上传目录。

### ⚠️ 升级时「只换代码、不丢数据」检查单

「整包覆盖代码」时,这三类**不在数据库里、却要保住**的东西别被覆盖：

| 要保住的 | 在哪 | 怎么不丢 |
|---|---|---|
| 数据库(单据/记录/报告…) | PostgreSQL 数据目录(代码文件夹外) | 天然安全;升级只跑 `pnpm migrate`(幂等增量),**永不** dropdb/重建 |
| 上传图片/Excel | 默认【项目上一级 `data/`】(代码目录外)，或 `storage` 配的目录 | 默认就在代码目录外,整包覆盖不影响;若改回仓库内路径,覆盖时记得排除 |
| 部署配置/密钥 | `config/*.local.json`、`.env` | 覆盖时排除这些(已被 `.gitignore` 忽略) |

推荐升级方式(任选其一,都不会丢上面三类)：
```bash
# A. git 更新(最稳,*.local.json/.env 本就不在仓库里;上传目录默认在仓库外)
git pull && pnpm install && pnpm migrate && pnpm build && 重启
# B. rsync 整包覆盖但排除本地配置(上传目录默认已在仓库外,无需排除)
rsync -av --exclude='*.local.json' --exclude='.env' --exclude='node_modules/' 新代码/ 服务器目录/
```
升级前先备份数据库：`pg_dump cdr_demo > backup_$(date +%F).sql`。

---

## 内网部署（生产 · 单进程 · 供外部系统访问）

> **全新 Ubuntu 24.04 服务器从零部署**：直接看 [`部署说明-Ubuntu.md`](./部署说明-Ubuntu.md)，或一键安装：
> ```bash
> bash scripts/install-ubuntu.sh   # 装 Node/pnpm/PG/Typst/LibreOffice + 建库建表 + 构建 + systemd 自启
> ```
> 本节是手动部署的精简步骤；环境组件清单、systemd、接外部系统、离线内网等详见上面那份文档。

目标：部署在内网服务器，**外部系统（递归智能/业务系统）通过 `http://172.18.0.158:5173` 访问**本系统的 UI 与对接接口（1.1/1.2/1.3 入站）。

**架构**：生产默认用**单进程**——Express 后端同时提供 `/api/*`（含 `/api/external/*`）和已构建的前端静态页，监听一个端口即可。不要在生产跑 `pnpm dev`（那是 Vite 5173 + 后端 3001 两个进程，仅开发用）。

> 想要前后端解耦（Nginx 托管 `client/dist` + 反代 `/api`，并发更高/静态更快）：见 [`部署说明-Ubuntu.md`](./部署说明-Ubuntu.md) §四点五 + 仓库 `deploy/nginx/cdr-demo.conf`。应用代码不变。

```bash
# 1. 装依赖 + 迁移（首次）
pnpm install && pnpm migrate
# 2. 构建前端（产出 client/dist，后端会托管它）
pnpm build
# 3. 在 5173 端口启动后端（同时出 UI + API；已绑 0.0.0.0）
pnpm serve            # = PORT=5173 启动 server，可改 PORT=xxxx pnpm serve
# 后台常驻：nohup env PORT=5173 pnpm serve > app.log 2>&1 &
```

**代码无需改动**——系统已满足外部访问：后端默认 `HOST=0.0.0.0`（非仅本机）、`cors()` 全开、前端用相对路径 `/api`（同源，任意端口都对）、`existsSync(client/dist)` 时自动托管前端。

**只需做这些运维项**：
1. **开放防火墙端口**：`sudo ufw allow 5173/tcp`（Ubuntu）。
2. **构建前端**（`pnpm build`），否则访问只有 API、没有页面。
3. 确认服务器到外部系统连通：OA `172.19.0.27`、回传 WSDL `172.18.0.97:8003`。

**给递归智能/业务系统的入站接口地址**（Base = `http://172.18.0.158:5173`）：
| 接口 | 地址 |
|---|---|
| 1.1 推送委托单 | `POST http://172.18.0.158:5173/api/external/orders` |
| 1.2 推送报告信息 | `POST http://172.18.0.158:5173/api/external/reports` |
| 1.3 推送报告修改 | `POST http://172.18.0.158:5173/api/external/report-modify` |

> 规范约定传输为 HTTPS；当前内网用 HTTP（安全由内网/IP 白名单保障，与规范"安全由网络层保障"一致）。若要 HTTPS，在前面加 Nginx 反代并配证书即可，本系统不变。

---

## 技术栈

| 模块 | 选型 |
|---|---|
| 前端 | React 19 + TypeScript + Vite + Antd 6 |
| 拖拽 | react-dnd |
| 代码编辑器 | @monaco-editor/react |
| 后端 | Node.js + Express + TypeScript |
| 数据库 | PostgreSQL 16（重度使用 JSONB） |
| 排版引擎 | Typst 0.14.2 |
| Excel 解析 | exceljs (Node) / openpyxl (Python) |
| Python 环境 | Conda (cdr_demo, Python 3.11) |
| PDF→DOCX | LibreOffice headless（`writer_pdf_import` 滤镜） |

---

## 常用命令速查

```bash
pnpm dev               # 前后端并行热重载
pnpm dev:server        # 只跑后端
pnpm dev:client        # 只跑前端
pnpm migrate           # 执行未应用的 migration
pnpm build             # 前端构建到 client/dist

bash scripts/install-typst-packages.sh   # 装 @local/record-theme
bash scripts/convert-xls.sh              # .xls → .xlsx 批转

# 演示递归智能接口（1.1 委托单 + 1.2 报告取号 / 1.4 回传 / 外部回执退回闭环），灌一套可端到端 review 的数据
pnpm tsx scripts/demo-recursive-push.ts            # 灌入演示订单 DEMO-DG-001 + 3 份取号报告（matched/needs_record/unmatched）
pnpm tsx scripts/demo-recursive-push.ts --feedback # 附带 P-Flow-2：报告1 生成+回传+收到外部"需修改"回执（外部返工面板可见）
pnpm tsx scripts/demo-recursive-push.ts --reset    # 清理该演示数据

# 直接登 DB
PGPASSWORD="" psql -d cdr_demo
```
