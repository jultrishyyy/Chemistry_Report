# mock-external — 模拟「递归智能」外部系统推送

模拟外部业务系统调用本报告系统的入站接口：**推一个委托单 + 完成取号**，但**不灌录入数据**——
数据由你自己到实验室录入台录入，便于测试完整的「录入 → 审核 → 取号生成」流程。
对齐《递归智能报告系统_对接接口规范》接口 **1.1（推委托单）** 与 **1.2（推取号报告）**。

> 演示/联调脚本，真实接口对接后即可弃用。**不修改服务端**，只调用现有 HTTP 端点 + 清理本订单。

## 固定订单结构

- **样品A**：密度、弯曲强度/模量（两个检测项目）
- **样品B**：透光率（一个检测项目）

脚本会把对应的原始记录模板**预关联**到每个 样品×项目（密度→密度模板、弯曲→弯曲模板、透光率→透光率模板），
省去你手动关联；但**不录数据**。订单号默认 `MOCK-EXT-001`（环境变量 `MOCK_ORDER` 可改）。

## 前置

```bash
pnpm dev        # 后端 :3001、前端 :5173
```

## 用法

```bash
# 三种取号（出报告）格式，分别测试：
pnpm tsx mock-external/push.ts --mode=whole               # 整单出：1 份（含全部样品×项目）
pnpm tsx mock-external/push.ts --mode=per-sample          # 按样品出：2 份（样品A 1 份、样品B 1 份）
pnpm tsx mock-external/push.ts --mode=per-sample-project  # 按样品按项目出：3 份（A密度 / A弯曲 / B透光）

pnpm tsx mock-external/push.ts --reset                    # 只清理本模拟订单
```

每次运行先清理同号订单再重建。

## 推完后怎么做（你来录数据）

1. **录入**：打开 `http://localhost:5173/lab` → 进订单 `MOCK-EXT-001` → 逐个 样品×项目 录入数据 → 提交 → 审核通过。
   - 模板已预关联，直接录即可（实验员账号 `zhang_eng` 录入、审核员 `wang_sup` 审核）。
2. **生成**：打开 `http://localhost:5173/report` → 进订单 `MOCK-EXT-001` → 工作台「取号报告」面板 → 生成报告。
   - 录入并审核通过后，取号报告会从 `needs_record` 变为 `matched`，即可生成。

## 它做了什么（端到端）

1. **接口 1.1** `POST /api/external/orders`：推委托单（样品A=密度+弯曲；样品B=透光率）。
2. **预关联**：`PUT /api/work-orders/:no/link` 把匹配的原始记录模板关联到每个 样品×项目（不录数据）。
3. **接口 1.2** `POST /api/external/reports`：按所选格式完成取号（`whole`/`per-sample`/`per-sample-project`）。

不再自动灌数据、不再自动生成——这两步由你在前端手动完成。
