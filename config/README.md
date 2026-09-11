# 外部接口配置

只使用一份配置文件，由 `INTEGRATIONS_PROFILE` 选择：

| 场景 | 配置文件 | 启动方式 |
|---|---|---|
| 本机演示 / mock | `interfaces.demo.json` | `pnpm dev`（默认） |
| 服务器真实接口 | `interfaces.server.json` | `INTEGRATIONS_PROFILE=server PORT=5173 pnpm serve` |

服务器首次部署：

```bash
cp config/interfaces.server.json.example config/interfaces.server.json
# 编辑 interfaces.server.json：OA、SOAP 和 public_base_url
pnpm build
INTEGRATIONS_PROFILE=server PORT=5173 pnpm serve
```

`public_base_url` 必须填写用户访问系统的真实 HTTP(S) 地址，例如 `https://reports.example.com` 或 `http://172.18.0.158:5173`。它用于生成 PDF 内附件下载链接；填写后重启服务即可，旧 PDF 缓存会自动因地址变化失效并重新生成。

报告编号/资质信息是**入站推送**，无需在 `interfaces.server.json` 里填写另一个远端地址。上游系统应调用本服务：

```text
POST http(s)://<本系统地址>/api/external/reports
```

`INTEGRATIONS_PROFILE=server` 时，最终报告页眉页脚只使用该接口推送的 `ReportList` 字段（包括 `QualificationRemark` / `QualificationRemarkEN`），缺失值保持为空，不会回退 `header-footer.json` 的示例内容。可访问 `/api/health` 核对返回值：

```json
{ "integrations_profile": "server", "report_meta_source": "external_interface" }
```

`server` 模式缺少 `interfaces.server.json` 时应用会拒绝启动，不再静默进入 mock。

`report_delivery` 是业务系统 WCF SOAP 的统一配置，1.4 `AcceptReportFromDiGui`、1.5 `CancelFlowFromDiGui`、1.6 `UpdateMaterialTaskState` 共用 `soap_endpoint` / `target_namespace` / `soap_version`，但各自的 method、参数标签和 SOAPAction 独立配置。部署前应从实际服务器访问 `{soap_endpoint}?wsdl` 核对这些值，并先运行 `pnpm migrate` 创建 1.6 的持久化重试队列。

`auth.json`、`database*.json`、`storage*.json`、`typst.json` 和 `header-footer.json` 仍分别管理本地权限策略、数据库、文件存储、Typst 与报告版式；它们不是外部接口端点配置。旧 `auth.local.json`、`report-delivery*.json` 不再被接口加载器读取，请把真实值迁移到 `interfaces.server.json`。
