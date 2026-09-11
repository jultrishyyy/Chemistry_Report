-- 测试方法模板管理 + 多原始记录录入批次。
-- 设计原则：不同方法仍使用独立原始记录模板；项目族负责归类，批次负责公共数据和一次审核。

CREATE TABLE test_template_groups (
  id                  SERIAL PRIMARY KEY,
  code                TEXT NOT NULL UNIQUE,
  name                TEXT NOT NULL,
  description         TEXT,
  shared_profile_code TEXT NOT NULL DEFAULT 'default',
  enabled             BOOLEAN NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE test_method_schemes (
  id                         SERIAL PRIMARY KEY,
  group_id                   INTEGER NOT NULL REFERENCES test_template_groups(id) ON DELETE CASCADE,
  method_code                TEXT NOT NULL,
  method_name                TEXT NOT NULL,
  standard                   TEXT,
  record_template_id         INTEGER REFERENCES record_templates(id) ON DELETE SET NULL,
  report_project_template_id INTEGER REFERENCES report_templates(id) ON DELETE SET NULL,
  report_project_name        TEXT NOT NULL,
  recommended                BOOLEAN NOT NULL DEFAULT FALSE,
  enabled                    BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order                 INTEGER NOT NULL DEFAULT 0,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (group_id, method_code),
  UNIQUE (record_template_id)
);

CREATE INDEX idx_test_method_schemes_group ON test_method_schemes(group_id, sort_order, id);
CREATE INDEX idx_test_method_schemes_report_template ON test_method_schemes(report_project_template_id);

CREATE TABLE record_batches (
  id                    SERIAL PRIMARY KEY,
  order_no              TEXT NOT NULL,
  sample_external_id    TEXT NOT NULL,
  test_item_name        TEXT NOT NULL,
  template_group_id     INTEGER REFERENCES test_template_groups(id) ON DELETE SET NULL,
  shared_profile_code   TEXT NOT NULL DEFAULT 'default',
  shared_data           JSONB NOT NULL DEFAULT '{}'::jsonb,
  audit_status          TEXT NOT NULL DEFAULT 'draft'
                        CHECK (audit_status IN ('draft','pending','reviewed','rejected')),
  tester_name           TEXT,
  tested_at             TIMESTAMPTZ,
  submitted_by_name     TEXT,
  submitted_by_job_no   TEXT,
  submitted_at          TIMESTAMPTZ,
  reviewer_name         TEXT,
  reviewed_at           TIMESTAMPTZ,
  reject_note           TEXT,
  current_version       INTEGER NOT NULL DEFAULT 1,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_record_batches_order ON record_batches(order_no, sample_external_id, test_item_name);
CREATE INDEX idx_record_batches_status ON record_batches(audit_status, updated_at DESC);

CREATE TABLE record_batch_items (
  id                SERIAL PRIMARY KEY,
  batch_id          INTEGER NOT NULL REFERENCES record_batches(id) ON DELETE CASCADE,
  method_scheme_id  INTEGER REFERENCES test_method_schemes(id) ON DELETE SET NULL,
  record_data_id    INTEGER NOT NULL REFERENCES record_data(id) ON DELETE RESTRICT,
  sort_order        INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (batch_id, record_data_id),
  UNIQUE (record_data_id)
);

CREATE INDEX idx_record_batch_items_batch ON record_batch_items(batch_id, sort_order, id);

-- 公共字段不复制到每份记录；模板字段用 data_scope='batch_shared' 声明后，录入/渲染从批次 shared_data 读取。
-- 为快速按记录回查批次，保留冗余外键（item 表仍是方法方案/排序的权威关系）。
ALTER TABLE record_data
  ADD COLUMN record_batch_id INTEGER REFERENCES record_batches(id) ON DELETE SET NULL;

CREATE INDEX idx_record_data_batch ON record_data(record_batch_id);
