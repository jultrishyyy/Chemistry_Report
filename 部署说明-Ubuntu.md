# 内网部署说明 — Ubuntu 24.04 LTS

> 本文件讲「**把系统部署到一台全新的内网 Ubuntu 服务器**」。
> 日常开发 / 配置详解见 [`RUNNING.md`](./RUNNING.md)；系统总览见 [`README.md`](./README.md)。

部署目标：单进程生产模式——一个 Node 后端同时提供 `/api/*`（含外部对接接口）和已构建的前端页面，监听一个端口（默认 `5173`），供内网用户与外部系统（递归智能 / 业务系统 / OA）访问。

---

## 一、需要装什么（结论先行）

| 组件 | 用途 | 必须 |
|---|---|---|
| **Node.js ≥ 20**（建议 22 LTS） | 跑后端 + 构建前端 | ✅ |
| **pnpm 10.25.0** | 包管理 | ✅ |
| **PostgreSQL ≥ 15**（建议 16） | 数据库（重度 JSONB） | ✅ |
| **Typst ≥ 0.11**（建议 0.14） | 渲染报告 PDF（核心） | ✅ |
| **LibreOffice** | 上传 .xls→.xlsx 转换 + 报告 PDF→DOCX 导出 | ✅ |
| `fonts/` 目录字体文件 | 报告排版字体 | ✅ 需手动拷贝 |
| `typst-packages/local/` 主题包 | 公司排版主题（已在仓库） | ✅ 脚本自动链接 |
| **Conda / Python** | 仅开发期 `convert-xls.sh` 批转工具 | ❌ **不需要** |

> **不需要装 miniconda。** 系统运行时代码（`server/src`）没有任何 Python 调用：用户上传 `.xls` 的转换走 LibreOffice，表格解析走 Node 的 `exceljs`。Conda 只服务于一个开发期的历史数据批转脚本，部署生产用不到。

> ⚠️ **最容易漏的一项：字体。** `fonts/` 里的宋体/黑体/楷体/仿宋等是**专有字体**，已被 `.gitignore` 排除，`git clone` 拿不到。**必须手动把开发机的 `fonts/` 目录连同字体文件一起拷到服务器**，否则报告缺字或版面与开发机不一致。

---

## 二、一键安装（推荐）

把整个 `demo_v1` 目录拷到服务器（**务必带上 `fonts/` 里的字体文件**），然后运行（**root 或有 sudo 权限的普通用户都可以**——root 运行时应用文件与 systemd 服务归 root，内网常见、可接受）：

```bash
cd demo_v1
bash scripts/install-ubuntu.sh
```

脚本会自动完成：**换国内镜像源（默认开启）** → Node / pnpm / PostgreSQL / Typst / LibreOffice 安装 → 应用依赖 → Typst 主题包 → 写数据库配置 → 建库建表（migration）→ 构建前端 → 开防火墙端口 → 安装 systemd 服务（开机自启 + 崩溃重启）。装完直接可访问 `http://<服务器IP>:5173`。

> **关于下载速度**：默认 `CN_MIRROR=1`，脚本会自动把 **apt 源换清华、npm/pnpm 源换淘宝（含 corepack 激活 pnpm，走 `COREPACK_NPM_REGISTRY`）、Typst 走 GitHub 加速前缀**——国内/内网服务器从官方源下载常常只有几百 B/s（要十几个小时），换源后快几百倍。海外服务器加 `CN_MIRROR=0` 用官方源。apt 镜像会先备份原文件（`*.bak`）再替换。
>
> **唯一未走域内镜像的是 Node.js（NodeSource）**：国内无可靠 apt 镜像，它走 CDN、通常可达（只是不如域内快）。若某网络下这步极慢/超时，可先从清华 Node 二进制镜像（`mirrors.tuna.tsinghua.edu.cn/nodejs-release/`）手动装好 Node≥20 再重跑脚本（会自动跳过装 Node 这步）——脚本里 Node 安装处也有对应命令注释。

### 可调参数（环境变量覆盖）

```bash
# 改端口 + 改数据库密码（生产强烈建议改密码）
APP_PORT=8080 DB_PASSWORD='你的强密码' bash scripts/install-ubuntu.sh

# 不装 systemd（自己用别的方式守护进程）
SETUP_SYSTEMD=0 bash scripts/install-ubuntu.sh
```

| 变量 | 默认 | 说明 |
|---|---|---|
| `APP_PORT` | `5173` | 对外服务端口 |
| `DB_NAME` | `cdr_demo` | 数据库名 |
| `DB_USER` | `cdr` | 数据库登录角色 |
| `DB_PASSWORD` | `cdr_demo_pwd` | 数据库密码（**生产务必改**） |
| `NODE_MAJOR` | `22` | Node 主版本（≥20 即可） |
| `PNPM_VERSION` | `10.25.0` | pnpm 版本 |
| `TYPST_VERSION` | `v0.14.2` | Typst 版本 |
| `SETUP_SYSTEMD` | `1` | 1=装 systemd 自启；0=跳过 |
| `CN_MIRROR` | `1` | 1=换国内镜像（apt/npm/GitHub）；0=用官方源（海外服务器） |
| `APT_MIRROR` | `mirrors.tuna.tsinghua.edu.cn` | apt 镜像主机；清华不通可换 `mirrors.aliyun.com` |
| `NPM_REGISTRY` | `https://registry.npmmirror.com` | npm/pnpm 镜像源（淘宝） |
| `GH_PROXY` | `https://mirror.ghproxy.com/` | Typst 从 GitHub 下载的加速前缀 |

> **脚本可重复运行**：已装的组件会自动跳过（Node/Typst/LibreOffice/库已存在时不重复装），适合改了参数再跑一次。

---

## 二点五、升级：环境已装好，只替换代码（日常最常用）

> 服务器上 Node/pnpm/PostgreSQL/Typst/LibreOffice/字体都已装好、只是要把代码换成新版本时，**不用重跑 `install-ubuntu.sh`**，按下面四步即可。数据库、上传文件、配置、字体都在代码目录之外或被 `.gitignore` 排除，**不会被代码覆盖**。

> ⚠️ **不要把 `install-ubuntu.sh` 当日常部署脚本反复跑**：它每次都会**覆盖 `config/database.local.json` 并把数据库密码重置为默认 `cdr_demo_pwd`**（你若设过别的密码就被改掉，导致连库失败），还会重装一堆系统包、很慢。它**只在首次装新服务器时跑一次**。日常启动 / 重启 / 看日志 / 更新代码，用下面的 `scripts/run.sh`。

### 最省事：用 `scripts/run.sh`（推荐）

替换完代码后，**一条命令**搞定"装依赖→链主题→迁移→构建前端→重启"（不动数据库数据、不覆盖配置、不动字体）：

```bash
cd /path/to/demo_v1
git pull                       # 或 rsync 覆盖代码（排除项见下方「务必保留」）
bash scripts/run.sh update     # = 下面手动 5 步的合并版
```

其它日常运维：

```bash
bash scripts/run.sh restart    # 只重启（改了服务端 .ts / 主题 lib.typ 后，无需重新构建时）
bash scripts/run.sh build      # 只改了前端 → 重新构建 + 重启
bash scripts/run.sh logs       # 实时日志（Ctrl+C 退出）
bash scripts/run.sh status     # 服务状态
bash scripts/run.sh start|stop # 启/停
bash scripts/run.sh serve      # 前台运行（没装 systemd 时调试用）
```

> 字体（`fonts/`）和上传文件（`server/uploads/` 或 `data/`）`run.sh` **不碰**——它们被 `.gitignore` 排除、不随代码走，按「四点六」单独同步。

### 升级命令（按顺序）—— 等价于 `run.sh update` 的手动版

```bash
cd /path/to/demo_v1

# 0.（强烈建议）先备份数据库，万一升级出问题可回滚
pg_dump -U cdr -d cdr_demo -Fc -f ~/cdr_demo.$(date +%F-%H%M).dump

# 1. 替换代码（保留数据/配置/字体/上传，见下方「务必保留」）
git pull                       # ① git 部署：直接拉新代码
#   ② 或用打包目录 rsync 覆盖（从 /tmp/demo_v1_new 推过来，排除不可覆盖项）：
# rsync -av \
#   --exclude 'config/*.local.json' --exclude '.env' \
#   --exclude 'fonts/' --exclude 'server/uploads/' --exclude 'node_modules/' \
#   /tmp/demo_v1_new/  /path/to/demo_v1/

# 2. 装/更新依赖（package.json 没变可跳过；不确定就跑，幂等）
pnpm install
( cd client && pnpm install )
( cd server && pnpm install )

# 3. 跑数据库迁移（增量 + 幂等：只执行新增的 migration，不动已有数据）
pnpm migrate

# 4. 重新构建前端（前端有改动必跑，否则页面还是旧的）
pnpm build

# 5. 重启服务（systemd 部署）
sudo systemctl restart cdr-demo
```

> 不放心可分两窗口：升级前在另一窗开 `journalctl -u cdr-demo -f` 盯日志，`restart` 后确认打印出 `[config] …` 启动行、无报错。

### ⚠️ 务必保留（这些不能被代码覆盖）

| 路径 | 是什么 | 安全性 |
|---|---|---|
| `config/*.local.json` | 数据库 / OA 登录 / 报告回传 / SSO 等**本机配置** | `.gitignore` 已排除 → `git pull` 不动；`rsync` 要 `--exclude` |
| `.env`（如有） | 环境变量 | 同上 |
| 上传文件目录 | 图片 / 附件（默认 = **项目目录上一级的 `/data`**，或 `config/storage.local.json` 里配的 `uploads_dir`；旧版在 `server/uploads/`） | 默认在项目目录之外，天然不被覆盖 |
| `fonts/` | 专有字体（页眉页脚版面一致的前提） | `.gitignore` 已排除 |
| PostgreSQL 数据 | **所有**数据 / 模板 / 录入 / 报告的全部版本 | 在 PG 自己的数据目录，根本不在代码文件夹内 |

> **`git pull` 最省心**：被 `.gitignore` 排除的（上述前 4 项）天生不受影响。用 `rsync`/整目录覆盖时务必带上 `--exclude`，否则会冲掉本机配置和字体。
>
> **一个例外**：`config/header-footer.json`（页眉页脚默认）是**提交进仓库**的，会随代码更新——若你在服务器上手动改过它，升级前先备份，升级后再合并回去。

### 出问题怎么回滚

```bash
git log --oneline -5                              # 找上一个好用的提交
git checkout <上个提交>  &&  pnpm build  &&  sudo systemctl restart cdr-demo
# 若新版本跑过 migration 又要彻底回退，用第 0 步的备份恢复库：
# pg_restore -U cdr -d cdr_demo --clean --if-exists ~/cdr_demo.<时间>.dump
```

### 启动 / 停止 / 状态 / 看日志（systemd）

```bash
# 服务控制
sudo systemctl start   cdr-demo      # 启动
sudo systemctl stop    cdr-demo      # 停止
sudo systemctl restart cdr-demo      # 重启（升级后用这个）
sudo systemctl status  cdr-demo      # 看当前状态（是否 running / 最近几行日志）

# 看日志
sudo journalctl -u cdr-demo -f                 # 实时跟踪（升级后盯启动、联调看外部推送都用它）
sudo journalctl -u cdr-demo -n 200 --no-pager  # 最近 200 行
sudo journalctl -u cdr-demo --since "10 min ago"   # 最近 10 分钟
sudo journalctl -u cdr-demo -p err --no-pager  # 只看错误级别
```

> **没用 systemd**（当初 `SETUP_SYSTEMD=0` 或临时跑）：停服务是 `pkill -f "pnpm serve"`（或杀对应 PID），启动是 `nohup env PORT=5173 pnpm serve > app.log 2>&1 &`，看日志是 `tail -f app.log`。生产建议还是装 systemd（开机自启 + 崩溃重启）。

---

## 三、手动安装（不想用脚本时）

> 国内/内网服务器先换源再装（否则从官方源下载极慢）：
> ```bash
> # apt 换清华源（Ubuntu 24.04 deb822 格式）
> sudo sed -i 's@//archive.ubuntu.com/ubuntu@//mirrors.tuna.tsinghua.edu.cn/ubuntu@g; s@//security.ubuntu.com/ubuntu@//mirrors.tuna.tsinghua.edu.cn/ubuntu@g' /etc/apt/sources.list.d/ubuntu.sources
> # npm 换淘宝源
> export NPM_CONFIG_REGISTRY=https://registry.npmmirror.com
> # 下面第 4 步 Typst 的 GitHub 地址前面加 https://mirror.ghproxy.com/ 即可加速
> ```

```bash
# 0. 基础工具
sudo apt update
sudo apt install -y curl ca-certificates gnupg git xz-utils ufw

# 1. Node.js 22 LTS
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# 2. pnpm（corepack 锁定项目指定版本）
sudo corepack enable
corepack prepare pnpm@10.25.0 --activate

# 3. PostgreSQL 16
sudo apt install -y postgresql postgresql-contrib
sudo systemctl enable --now postgresql
sudo -u postgres psql -c "CREATE ROLE cdr LOGIN PASSWORD '你的强密码';"
sudo -u postgres createdb -O cdr cdr_demo

# 4. Typst（官方静态二进制，无系统依赖）
curl -fsSL https://github.com/typst/typst/releases/download/v0.14.2/typst-x86_64-unknown-linux-musl.tar.xz -o /tmp/typst.tar.xz
tar -xf /tmp/typst.tar.xz -C /tmp
sudo install /tmp/typst-x86_64-unknown-linux-musl/typst /usr/local/bin/typst

# 5. 文档处理工具（Ghostscript 用于自动压缩异常偏大的 PDF）
sudo apt install -y libreoffice-calc libreoffice-writer ghostscript

# 6. 应用本体
cd demo_v1
ls fonts/*.tt[fc]                       # 确认字体在位（git 拿不到，需手动拷）
pnpm install
( cd client && pnpm install )
( cd server && pnpm install )
bash scripts/install-typst-packages.sh  # 链接 record-theme / report-theme

# 7. 数据库配置（覆盖 database.json 里硬编码的开发机用户名）
cat > config/database.local.json <<'EOF'
{ "host": "localhost", "port": 5432, "database": "cdr_demo", "user": "cdr", "password": "你的强密码" }
EOF

# 8. 建表 + 构建前端
pnpm migrate
pnpm build

# 9. 防火墙 + 启动
sudo ufw allow 5173/tcp
PORT=5173 pnpm serve
```

> aarch64（ARM）服务器把第 4 步的 `x86_64` 换成 `aarch64` 即可。

---

## 四、开机自启（systemd）

一键脚本会自动装好。手动安装时可照抄（把 `<用户>` / 路径 / pnpm 路径换成实际值，pnpm 路径用 `command -v pnpm` 查）：

```ini
# /etc/systemd/system/cdr-demo.service
[Unit]
Description=化学部检测报告系统 (CDR Demo)
After=network.target postgresql.service
Wants=postgresql.service

[Service]
Type=simple
User=<部署用户>
WorkingDirectory=/path/to/demo_v1
Environment=PORT=5173
Environment=HOST=0.0.0.0
Environment=INTEGRATIONS_PROFILE=server
Environment=PATH=/usr/bin:/usr/local/bin:/bin
ExecStart=/usr/bin/pnpm serve
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now cdr-demo
sudo journalctl -u cdr-demo -f       # 看实时日志
```

> `INTEGRATIONS_PROFILE=server` 必须保留：缺少时应用会安全回退到 `demo/mock`，送审和撤回只会在本地模拟成功，不会调用真实 SOAP 接口。启用前还须按「外部接口统一配置」章节创建并填写 `config/interfaces.server.json`。

### 已部署服务器切换为真实接口模式（推荐覆盖配置）

已有 systemd 服务时，推荐使用 drop-in 覆盖配置，不直接修改原服务文件，避免更新或重新安装服务时丢失：

```bash
sudo systemctl edit cdr-demo
```

在编辑器中填写并保存：

```ini
[Service]
Environment=INTEGRATIONS_PROFILE=server
```

然后重新加载并重启：

```bash
sudo systemctl daemon-reload
sudo systemctl restart cdr-demo
```

确认运行中的服务确实使用真实接口模式：

```bash
sudo systemctl show cdr-demo -p Environment
sudo journalctl -u cdr-demo -n 100 --no-pager | grep -E '\[config\]|报告回传'
```

输出必须包含 `INTEGRATIONS_PROFILE=server`，启动日志应显示：

```text
[config] 外部接口配置=server (config/interfaces.server.json)
[config] 报告取号(1.2)页眉页脚=严格使用 POST /api/external/reports 推送值（不回退示例）
[config] 业务系统 SOAP(1.4/1.5/1.6)=SOAP(http://172.18.0.97:8003/Lab/Chemistry)
```

还可以直接检查运行模式：

```bash
curl -s http://127.0.0.1:5173/api/health
```

应返回 `"integrations_profile":"server"` 和 `"report_meta_source":"external_interface"`。报告编号和资质属于上游主动推送的入站数据，上游接口地址应配置为 `http(s)://<本系统地址>/api/external/reports`，不需要在 `interfaces.server.json` 中再填写一个远端报告编号地址。

如果仍显示 `demo` 或 `mock(未配 soap_endpoint)`，请检查 `config/interfaces.server.json` 是否存在且 `report_delivery.soap_endpoint` 非空，再重启服务。

> 不用 systemd 也可临时后台跑：`nohup env INTEGRATIONS_PROFILE=server PORT=5173 pnpm serve > app.log 2>&1 &`（仅适合临时，重启不自动拉起）。

---

## 四点五、前后端解耦部署（可选，Nginx）

默认是**单进程**部署：Node 自己托管前端 `client/dist` + 跑 `/api`，一个 `pnpm serve` 搞定（上面 §四 即此模式），内网够用。

并发更高、想让静态资源更快/更省 Node 资源时，可改为 **Nginx 托管前端 + 反代 /api 到 Node**。**应用代码无需任何改动**（前端用相对路径 `/api`，见 `client/src/config.ts`，同源反代天然无 CORS）。

**步骤：**

```bash
# 1. 前端照常构建（产物在 client/dist）
cd /path/to/demo_v1 && pnpm build

# 2. Node 只跑 API，并绑回环地址（该端口不对外暴露，只有本机 Nginx 能连）
#    systemd 服务把 Environment 改成：
#      Environment=HOST=127.0.0.1
#      Environment=PORT=3001
#    （或临时：HOST=127.0.0.1 PORT=3001 pnpm serve）

# 3. 装 Nginx，拷示例配置
sudo apt install -y nginx
sudo cp deploy/nginx/cdr-demo.conf /etc/nginx/conf.d/cdr-demo.conf
#    改配置里三处实际值：server_name、root（→ 真实路径的 client/dist）、proxy_pass 端口（对齐第 2 步 PORT）

# 4. 校验并重载
sudo nginx -t && sudo systemctl reload nginx
```

完整 Nginx 配置见仓库 `deploy/nginx/cdr-demo.conf`（已设好 `/api` 反代、SPA 回退、`client_max_body_size 12m` 配合 10MB 上传、报告生成的 `proxy_read_timeout 120s`）。

> 此时对外访问端口变成 Nginx 的 80（而非原来的 5173）；**给外部系统的入站接口地址**（§五）的 Base 也相应改成 `http://<服务器IP>`（不带 5173）。HTTPS 同样在 Nginx 这层加证书即可，应用不变。

---

## 四点六、把现有数据搬到新服务器（⚠️ 数据 / 模板 / 页眉页脚不随代码走）

**最容易踩的坑**：一键安装脚本只建**全新空库** + 跑演示 seed。你在开发机/旧机上录入的数据、调好的报告模板、**页眉页脚配置**都存在 **PostgreSQL** 里，上传的图片/附件在**上传目录**（默认 = 项目目录上一级的 `/data`，可在 `config/storage.local.json` 用 `uploads_dir` 改；旧版部署在 `server/uploads/`）、字体在 `fonts/`——这三样都**不随代码打包过去**。只拷代码 → 新服务器数据是空的、报告模板回退默认、页眉页脚版面错乱。

要把现有系统**整体搬过去**，除了装代码，还要迁移这三样：

### 1. 数据库（最关键：含所有数据 + 报告模板 + 页眉页脚配置）

```bash
# —— 在【开发机/旧服务器】导出整库 ——
pg_dump -U <旧库用户> -d cdr_demo -Fc -f cdr_demo.dump      # -Fc=自定义压缩格式
scp cdr_demo.dump <新服务器>:/tmp/

# —— 在【新服务器】先跑过一次 install-ubuntu.sh（已建好空库 cdr_demo）——
# 用 dump 覆盖空库（--clean 先删旧对象，幂等可重复）：
pg_restore -U <新库用户> -d cdr_demo --clean --if-exists /tmp/cdr_demo.dump
# 提示：启动 seed 是幂等的（已存在就跳过），不会覆盖你恢复进来的数据。
```

### 2. 上传文件（图片 / 附件，被 .gitignore 排除）

上传目录默认是**项目目录上一级的 `/data`**（可在 `config/storage.local.json` 里用 `uploads_dir` 指定绝对路径）。它在代码目录之外，所以换代码不会动它；**换服务器/首次搬迁时**要把整个目录 rsync 过去：

```bash
# 默认路径：项目目录的上一级 /data（即 demo_v1 的同级目录）
rsync -av <旧机>/path/to/data/  <新服务器>:/path/to/data/

# 若两边在 config/storage.local.json 配了自定义 uploads_dir，就同步那个目录
# 旧版部署（上传文件还在 server/uploads/）则同步：
# rsync -av <旧机>/path/to/demo_v1/server/uploads/  <新服务器>:/path/to/demo_v1/server/uploads/
```

> 文件存储结构为 `<上传目录>/<订单号>/<样品名_测试项目名>/<字段名|附件名>`（报告首页图在 `<订单号>/_首页/`）。DB 里只存路径引用，所以**目录路径两边要对得上**（同一 `uploads_dir`），否则报告里的图片渲染不出来。

### 3. 字体（页眉页脚版面一致的前提，被 .gitignore 排除）

```bash
rsync -av <旧机>/path/to/demo_v1/fonts/*.tt[fc]  <新服务器>:/path/to/demo_v1/fonts/
sudo systemctl restart cdr-demo     # 重启让 typst 用上本地字体（--ignore-system-fonts 锁版面）
```

> **为什么页眉页脚会乱**：①页眉页脚版式现有一份**随代码部署的默认** `config/header-footer.json`（含分割线开关 `header_rule:false`）——新服务器即使空库也用它，**不再回退主题默认而冒出分割线**（这条已修，2026-06）；早期版本因版式只存数据库、空库取不到才会乱。②`fonts/` 没字体时 typst 回退系统字体，字宽行高变了，按参考样张(21×29cm)调的版面仍会移位——**字体务必拷过去**（上面第 3 步）。所以现在新服务器要页眉页脚正确：拷字体即可；要连具体某模板的个性化版式/录入数据，再走 pg_dump/restore。
>
> **页眉页脚默认想改**：直接编辑 `config/header-footer.json`（`settings` 改版式、`header_rule/footer_rule` 控分割线、`sample_meta` 改取号前示例公司信息），随代码生效、改一处全报告通用。详见 `RUNNING.md` 的「报告页眉页脚默认」一节。

---

## 五、接外部系统（OA 登录 / SOAP 1.4、1.5、1.6）

默认**不接**外部，走 mock（OA 登录任意账号密码可登；SOAP 不真发）——首次部署即可登录验证。接真实环境时统一配置：

```bash
cd demo_v1
cp config/interfaces.server.json.example config/interfaces.server.json
# 编辑同一文件中的 auth、report_delivery 和 public_base_url；
# report_delivery 同时配置 1.4 AcceptReportFromDiGui、1.5 CancelFlowFromDiGui、
# 1.6 UpdateMaterialTaskState。启动时必须设置 INTEGRATIONS_PROFILE=server。
pnpm migrate
```

改完重启服务。启动日志会打印当前模式：`[config] OA 登录=真实(...)` / `业务系统 SOAP(1.4/1.5/1.6)=SOAP(...)`，或 `mock(...)`。

**必须确认服务器到外部系统的网络连通**（在服务器上直测）：

```bash
curl -v http://172.19.0.27/grgtapi/common-api      # OA 登录可达？
curl -v http://172.18.0.97:8003/Lab/Chemistry      # 回传 WSDL 可达？
```

**给外部系统的入站接口地址**（Base = `http://<服务器IP>:5173`）：

| 接口 | 地址 |
|---|---|
| 1.1 推送委托单 | `POST /api/external/orders` |
| 1.2 推送报告信息 | `POST /api/external/reports` |
| 1.3 推送报告修改 | `POST /api/external/report-modify` |

> 规范约定 HTTPS；内网当前用 HTTP（安全由内网/IP 白名单保障）。要 HTTPS 在前面加 Nginx 反代配证书即可，本系统不变。

---

## 六、验证部署成功

```bash
# 1. 服务在跑？
sudo systemctl status cdr-demo           # 或 curl 自测
curl -sS http://localhost:5173/ | head   # 应返回前端 HTML（说明 client/dist 已托管）

# 2. API 通？
curl -sS http://localhost:5173/api/health 2>/dev/null || echo "(按实际健康检查端点调整)"

# 3. Typst 渲染正常？（字体齐不齐）
typst compile samples/typst/manual-record.typ /tmp/out.pdf && echo "Typst OK"

# 4. 浏览器访问 http://<服务器IP>:5173，用演示账号登录走一遍：
#    建模板 → 录入 → 审核 → 生成报告 → 看 PDF 预览
```

### 联调：实时看外部推送是否收到

入站接口 1.1/1.2/1.3 每收到一笔都会打一行日志（只记摘要，不记完整 body）。开一个窗口实时盯：

```bash
journalctl -u cdr-demo -f
```

收到时形如：
```
[external 1.1] 收到委托单 1 条：DEMO-DG-001(insert)
[external 1.2] 收到报告取号 3 条：SYS001→R001(匹配2/未决0)，…
[external 1.3] 报告修改/退回 1 条：SYS001:report_edit
```
解析/入库失败会打 `[external 1.x] …失败：<原因>`（如 `OrderNumber（委托单号）不能为空`）。也可用自带脚本自测：`DEMO_API=http://localhost:5173/api pnpm tsx scripts/demo-recursive-push.ts`。

---

## 七、内网无外网怎么办？

内网服务器常常**没有公网访问**，那么 `apt install` / 下载 Typst / `pnpm install` 都会失败。三种应对：

1. **内网镜像源**：配好内网 apt 镜像 + npm 私服（如 Verdaccio / Nexus），再跑一键脚本即可。
2. **离线搬运**：在一台**有网、同架构（x86_64）的 Ubuntu** 上先跑完依赖安装与 `pnpm install`，把整机 `node_modules`（注意 pnpm 符号链接，建议设 `node-linker=hoisted` 后重装再拷）、Typst 二进制、LibreOffice 的 `.deb` 一并打包搬过去。
3. **Docker 离线镜像（最省心）**：在有网机器上把 Node+Typst+LibreOffice+应用打成镜像 `docker save` 成 tar，拷到内网 `docker load` 即可“复制即跑”。需要的话告诉我，我补一套 `Dockerfile` + `docker-compose.yml`。

---

## 七点五、外部系统深链跳转 + 免二次登录（SSO）

> 📄 **给对方开发的完整对接规范（地址、参数、按钮示例、排查表）见根目录《外部系统报告跳转对接.md》**，可直接转交外部系统开发人员。本节是我方部署/配置侧的说明。

外部系统取完号后，把用户浏览器导航到本系统对应订单的报告生成页，URL 带**共享密钥 + 工号**即免登（最简方案，无签名/无密码）。

### 跳转地址

| 目标 | 地址 |
|---|---|
| 报告生成工作台（推荐） | `http://172.18.0.158:5173/report/order/{订单号}?key={共享密钥}&job={工号}` |
| 实验室订单详情 | `http://172.18.0.158:5173/lab/order/{订单号}?key={共享密钥}&job={工号}` |

- `订单号` = 1.1 推来的委托单号（`work_orders.order_no`，与取号用的 OrderNumber 一致）。
- `key` = 共享密钥（须等于服务端 `sso_secret`）；`job` = 用户工号（贵系统登录账号即工号时可直接传账号）。可选 `&name=&dept=`（仅首次建档显示用）。
- 前端校验密钥成功后自动登入并落在该页；URL 上的 `key/job` 会被自动清除（防泄露）。
- 未登录且无 SSO 参数时仍显示登录页；密钥错会提示并要求手动登录。

### 本系统服务端配置

在 `config/auth.local.json` 设置 `sso_secret`（或用环境变量 `AUTH_SSO_SECRET`），与外部系统约定同一个值：
```json
{
  "sso_secret": "4ef330d4fd25823f5358487b566d509a286c6a6527b391f0b2ba222279d1c8a4"
}
```
> 若已接真实 OA 登录，把 `sso_secret` 加进已有的 `auth.local.json`（与 `common_login_url` 等并列），不要覆盖。

改完 `systemctl restart cdr-demo`。**未配 `sso_secret` = SSO 关闭**（`/api/auth/sso` 返回 503）。密钥校验成功/失败都会在 `journalctl -u cdr-demo -f` 打日志（`[auth sso] …`）。

> ⚠️ 安全：本方案密钥经 URL 传入，会留在浏览器历史/服务器访问日志中，安全性靠内网 + IP 白名单兜底；密钥一旦泄露需两边同步更换。要更高安全可改用「一次性票据」方案（届时告知即可改造）。

---

## 八、常见问题

| 现象 | 原因 / 处理 |
|---|---|
| 报告 PDF 缺字 / 版面错乱 | `fonts/` 没把字体文件拷过来。补齐后重启。 |
| 报告 PDF 异常达到几十 MB | 确认已安装 `ghostscript`（`gs --version`）并重启服务；系统会重新生成旧缓存，且只在优化结果确实更小时替换。 |
| 启动报数据库连接失败 | `config/database.local.json` 的 user/password 与 PG 角色不一致；或 PG 未启动（`sudo systemctl status postgresql`）。 |
| 访问只有接口、没有页面 | 没跑 `pnpm build`（前端未构建，后端无 `client/dist` 可托管）。 |
| 外网访问不到 | 防火墙没放行端口（`sudo ufw allow 5173/tcp`），或公司网络策略限制。 |
| `.xls` 上传转换失败 / 导出 DOCX 失败 | LibreOffice 没装或 `soffice` 不在 PATH（`SOFFICE_BIN` 可指定路径）。 |
| 真实 OA 登录失败 | 见根目录《外部OA登录对接.md》§5 自检（地址前缀、SHA-1 大写、网络连通）。 |
