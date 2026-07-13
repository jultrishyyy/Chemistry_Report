# 外部 OA 登录对接说明

> 本文档说明「化学检测报告系统」如何对接外部 OA 的统一登录接口，**包含对方接口规范、我方实现位置、配置方法、排错手册**。
> 目的：接口出问题时，即使是新对话，照本文也能定位和修改。
>
> 配套独立联调工具见 `../test_api/login/`（零依赖小服务，可脱离完整系统单独验证登录链路）。

---

## 0. 一句话原理

身份认证走外部 OA（`/commonLogin/login`），**OA 只校验账号密码、返回身份（工号/姓名/部门/token），不返回角色**。
角色与权限由本系统**本地管理**（`users` 表 + `shared/rbac.ts`），首次登录自动建档、无角色，待管理员分配。

```
浏览器登录页 ──POST /api/auth/login──> 本系统后端 ──GET commonLogin/login──> 外部 OA
   (明文密码)                          (SHA-1加密密码)        (校验，返回身份)
                          <── 本地 users 建档/取角色权限 ──
```

---

## 1. 对方接口（外部 OA）

### 1.1 基本信息

| 项 | 值 |
|---|---|
| 用途 | 内部系统统一登录校验 |
| 文档来源 | OA 提供的 Swagger（commonApi-public）+ 现场联调截图 |
| **BaseURL（含路径前缀）** | `http://172.19.0.27/grgtapi/common-api` |
| **完整登录地址** | `http://172.19.0.27/grgtapi/common-api/commonLogin/login` |
| 方法 | `GET` |
| 参数位置 | query string（文档标 `application/x-www-form-urlencoded`，实际参数在 URL 上） |

> ⚠️ BaseURL **带路径前缀 `/grgtapi/common-api`**，不是裸 `http://172.19.0.27:80`。拼接登录地址时前缀必须保留。

### 1.2 请求参数（均必填/现场如此）

| 参数 | 说明 | 现场示例 |
|---|---|---|
| `loginName` | 工号/账号 | `GDJL06567` |
| `pwd` | **密码的 SHA-1 大写十六进制密文**（40 位），**不是明文** | `0CD896ADCBA3F54485F2612AA89B43913EA86A88` |
| `appId` | 接入方应用标识 | `chemistry` |

> ⚠️ **`pwd` 是加密后的密文**。OA 自己不加密、直接拿收到的值与库里的哈希比对。
> 所以调用方（我们）必须先把用户输入的**明文**算成 **SHA-1 大写**再发。
> （依据：联调截图里 pwd 为 40 位大写 hex；**已用已知明文自检确认 `SHA-1(明文)==对方密文`**，算法无误。）
> 本系统由后端 `encodePwd()` 完成加密，用户只输明文。

### 1.3 响应（`ResponseModel«登录返回信息»`，JSON）

| 字段 | 说明 |
|---|---|
| `code` | 业务码：`0010`=成功；`002X`=参数异常；`003X`=token 异常；`004X`=访问控制异常（如密码错误返回 `0040`）；`005X`=系统内部 |
| `success` / `fail` | 布尔，成功/失败标识 |
| `message` | 文案，如「成功」「用户名或密码错误，还剩下4次机会！」 |
| `response.jobNo` | 工号 |
| `response.userName` | 姓名 |
| `response.departName` | 部门 |
| `response.token` | JWT Token |
| `response.loginToken` | .NET Token |
| `response.modifyPwdTips` | 非空/非"0"＝密码超期需提示改密 |
| `response.id` | 用户标识（文档标注「无效」，不用） |
| `ticks` | 服务器响应标识 |

**成功示例（现场实测）：**
```json
{
  "ticks": null, "code": "0010", "message": "成功",
  "response": { "id": null, "jobNo": "GDJL06567", "userName": "朱炜烨",
    "departName": "九顶信息化开发管理部", "loginToken": "...", "token": "eyJhbGci...", "modifyPwdTips": "0" },
  "success": true, "fail": false
}
```
**失败示例：**
```json
{ "ticks": null, "code": "0040", "message": "用户名或密码错误，还剩下4次机会！",
  "response": null, "success": false, "fail": true }
```

---

## 2. 我方实现（本系统）

### 2.1 涉及文件

| 文件 | 职责 |
|---|---|
| `config/auth.json` | 对接配置基础值（提交进库；`common_login_url` 留空=mock） |
| `config/auth.local.json` | 部署时填真实值（**已 gitignore，不提交**）；不存在则用 auth.json |
| `config/auth.local.json.example` | 上面的模板 |
| `config/index.ts` | 加载并导出 `authConfig`（合并 auth.json + auth.local.json + `AUTH_*` 环境变量） |
| **`server/src/services/external-auth.ts`** | **核心**：调 OA、加密密码、解析响应 |
| `server/src/routes/auth.ts` | `POST /api/auth/login` 路由：调上面的函数 → 本地建档 → 返回用户+权限 |
| `client/src/auth.tsx` | 前端 `login()`：POST /login、存身份、加请求头；密码超期提示 |
| `client/src/pages/Login.tsx` | 登录页；据 `/api/auth/meta` 的 `login_mock` 决定是否显示演示账号 |

### 2.2 `external-auth.ts` 关键函数

- **`loginViaCommonLogin(loginName, pwd, appId?)`** — 入口。
  - 配了 `common_login_url` → 真实模式：`GET {url}/commonLogin/login?loginName=&pwd=&appId=`（字符串拼接，**前缀自动保留**），10s 超时，处理 401/403/404/非 JSON/网络错误。
  - 没配 → mock 模式：任意账号登录成功（本机演示）。
- **`encodePwd(pwd)`** — 按 `pwd_hash` 配置加密：`'sha1'`（默认）= SHA-1 大写十六进制；`'none'`=原样。
- **`parseLoginResponse(raw)`** — 归一化：`code='0010' || success===true` 且 `fail!==true` 即成功；取 `response.{jobNo,userName,departName,token,...}`。
- **`isMockLogin()`** — 是否 mock 模式（供前端隐藏演示账号提示）。

### 2.3 登录流程（`auth.ts` 的 `POST /login`）

1. 取 body `{loginName, pwd}`（pwd 为**明文**）。
2. `loginViaCommonLogin()` 校验 → 失败返回 401 + message。
3. 成功 → `users` 表 upsert（**首次登录建档，roles 默认空=待分配**；已存在则更新姓名/部门/last_login）。
4. 账号停用 → 403。
5. 返回 `{job_no,user_name,depart_name,roles,permissions,token,modify_pwd_tips}`。

> 密码加密在**后端** `encodePwd` 做：前端传明文，后端 SHA-1 后发 OA。前端无需改动。

### 2.4 与代理的关系

Node 全局 `fetch`（undici）**默认不读 `http_proxy`/`https_proxy`**，对内网地址是直连——无需特殊设置。
（注：独立联调工具的 Python 版 `urllib` 会读代理，已在那边显式禁用代理；本系统 Node 端不涉及。）

---

## 3. 配置与部署

### 3.1 配置（三选一，优先级：环境变量 > auth.local.json > auth.json）

**方式 A：配置文件（推荐）**
```bash
cp config/auth.local.json.example config/auth.local.json
```
编辑 `config/auth.local.json`：
```json
{
  "common_login_url": "http://172.19.0.27/grgtapi/common-api",
  "app_id": "chemistry",
  "pwd_hash": "sha1",
  "timeout_ms": 10000
}
```

**方式 B：环境变量**
```bash
AUTH_COMMON_LOGIN_URL=http://172.19.0.27/grgtapi/common-api  AUTH_APP_ID=chemistry  AUTH_PWD_HASH=sha1  pnpm dev
```

### 3.2 验证已生效

启动日志会打印：
```
[config] OA 登录=真实(http://172.19.0.27/grgtapi/common-api, appId=chemistry)
```
看到「mock」说明没配上 `common_login_url`。

### 3.3 配置项含义

| 配置键 | 环境变量 | 默认 | 说明 |
|---|---|---|---|
| `common_login_url` | `AUTH_COMMON_LOGIN_URL` | 空 | OA 地址（含前缀）。**空=mock 模式** |
| `app_id` | `AUTH_APP_ID` | `chemistry` | appId；设空则不发送该参数 |
| `pwd_hash` | `AUTH_PWD_HASH` | `sha1` | 密码加密：`sha1` / `none` |
| `timeout_ms` | `AUTH_TIMEOUT_MS` | `10000` | 调 OA 超时 |

---

## 4. 排错手册（症状 → 原因 → 怎么改）

| 症状 | 可能原因 | 排查 / 修改 |
|---|---|---|
| 启动日志显示「mock」 | 没配 `common_login_url` | 检查 `config/auth.local.json` 是否存在且填了地址；或设 `AUTH_COMMON_LOGIN_URL` |
| 登录报「OA 登录接口不存在(404)」 | 地址/前缀错 | 核对 `common_login_url`＝`http://172.19.0.27/grgtapi/common-api`（**带 `/grgtapi/common-api`**） |
| 登录报「无法连接 OA / 超时」 | 服务器到 OA 不通 | 在服务器上 `curl "http://172.19.0.27/grgtapi/common-api/commonLogin/login?loginName=x&pwd=y&appId=chemistry"`；不通=网络/防火墙问题，找网络或 OA 对接人 |
| 真实账号、明文密码登录失败 `0040` | **密码加密算法不是 SHA-1**，或编码/加盐不同 | 见 §5 自检；改 `pwd_hash`，或在 `encodePwd` 里换算法；必要时找对接人确认 |
| 用密文当明文输入导致失败 | 把已加密的 hash 又 SHA-1 了一次（双重加密） | 真实用户输**明文**即可；本系统后端只对明文加密一次，正常不会遇到 |
| `0020`/`002X` 参数异常 | appId 不对或参数缺失 | 核对 `app_id=chemistry`；确认 loginName/pwd 都发了 |
| 登录成功但「无任何菜单/权限」 | 首次登录角色为空（设计如此） | 用 admin 在「用户管理」给该工号分配角色，或本人「我的角色/申请」自助申请 |
| **内网只用 OA、没人能当管理员审首批角色申请** | 全新部署、本地无管理员 | 二选一（均配 `config/auth.json`，可在 `auth.local.json` 覆盖）：① **部门自动授权** `admin_departments`（默认 `["九顶信息化开发管理部"]`）→ 该部门 OA 账号登录即自动获 `admin`；② **本地管理员** `local_admin`/`local_admin_pwd`（默认 `admin`/`123`）→ 此账号跳过 OA 直接登入、始终是 admin。分配真实管理员后把 `local_admin_pwd` 置空 `""` 关闭旁路 |
| 改了配置不生效 | 配置在启动时读入 | 改 `auth.*` 或环境变量后**重启后端** |

### 修改密码加密算法的位置
`server/src/services/external-auth.ts` 的 `encodePwd()`。现为 SHA-1 大写：
```ts
return createHash('sha1').update(pwd, 'utf8').digest('hex').toUpperCase();
```
若确认是别的（如不同编码、MD5、加盐），改这里即可；同款逻辑在联调工具 `test_api/login/server.py` 的 `encode_pwd` / `server.js` 的 `encodePwd`。

---

## 5. 验证 SHA-1 是否正确（不连 OA 也能验）

OA 自己不加密、直接比对，所以「明文 → 加密」必须和 OA 存的一致。拿一个**已知明文密码**自检：
```bash
printf '该账号的明文密码' | sha1sum
```
- 输出 == 对方给的密文（如 `0cd896adcba3f54485f2612aa89b43913ea86a88`，忽略大小写）→ **SHA-1 确认无误**。
- 不相等 → 不是纯 SHA-1（可能加盐/编码不同）→ 找对接人确认，再改 `encodePwd`。

---

## 6. 联调已确认 / 待确认

**已确认（现场实测，截图为证）：**
- ✅ 地址含前缀 `http://172.19.0.27/grgtapi/common-api` 可达。
- ✅ `appId=chemistry` 登录成功。
- ✅ pwd 用 **SHA-1 大写密文**、原样发送可登录成功（`code:0010`，GDJL06567 / 朱炜烨 / 九顶信息化开发管理部）。
- ✅ 响应解析、错误处理、内网直连（不走代理）均正常。
- ✅ **「明文 → SHA-1 大写」算法已确认**（用已知明文自检 `SHA-1(明文)==对方密文` 一致）。本系统后端 `encodePwd()` 已实现，用户输明文即可。

**待确认：** 无（核心链路与加密算法均已确认）。

---

## 7. 新对话快速上手指引

接口出问题时，按顺序看：
1. **本文档 §1**（对方接口真实值）+ **§4 排错手册**。
2. 核心代码：`server/src/services/external-auth.ts`（`loginViaCommonLogin` / `encodePwd` / `parseLoginResponse`）。
3. 配置：`config/auth.json` + `config/auth.local.json` + `config/index.ts` 的 `authConfig`。
4. 想脱离完整系统快速验证 → 用 `../test_api/login/`（独立零依赖联调服务，自带网页 + 排错说明）。
5. 改完务必**重启后端**，看启动日志 `[config] OA 登录=...` 确认模式。
