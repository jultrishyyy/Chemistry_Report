-- 报告取号单（接口 1.2 PushReportInfos「推送报告信息」每条报告一行）
-- 文员在外部系统取号（指定样品×项目出几份），外部推送 ReportList[]：
-- 每份报告带 报告编号 + 检验码 + 页眉页脚全套 + 报告范围（SampleList/TaskList）。
-- 本系统按 样品名+项目名 回查录入侧 record_data/关联报告模板，能对应则自动拉取、对应不上标记手选。
-- 见 待实现内容.md 第 6 节（6.0a–6.0e）。
CREATE TABLE IF NOT EXISTS report_requisitions (
  id             SERIAL PRIMARY KEY,
  order_no       TEXT NOT NULL,                 -- OrderNumber（委托单号）
  sys_number     TEXT NOT NULL UNIQUE,          -- SysNumber（外部系统编号，幂等键；1.3 按它改号）
  report_number  TEXT NOT NULL,                 -- ReportNumber（报告编号，可被 1.3 SyncReportModifyInfo 改号）
  check_code     TEXT,                          -- CheckCode（检验码）
  language       TEXT,                          -- Language（中文/英文）
  sample_name    TEXT,                          -- 该报告主样品名（SampleName）
  issue_date     TEXT,                          -- SecondAuditeDate（签发日期）
  header_footer  JSONB,                         -- 页眉页脚全套（公司/客户/备注/资质 + 中英文）→ ReportMeta
  scope          JSONB,                         -- 解析后的报告范围（SampleList/TaskList，同 work_orders.payload.samples 结构）
  match_result   JSONB,                         -- 匹配引擎产物：[{sample_name,project_name,status,assignments:[...]}]
  report_id      INTEGER,                       -- 生成后回填 reports.id（NULL=未生成）
  status         TEXT NOT NULL DEFAULT 'pending', -- pending(待匹配/待生成) | generated
  stale          BOOLEAN NOT NULL DEFAULT FALSE,  -- 改号(1.3)后已生成报告需重渲染页眉
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_report_requisitions_order ON report_requisitions(order_no);
