-- 021: 原始记录模板版本的"受控信息"（受控号 / 颁布日期 / 实施日期）
--
-- 原始记录顶部要印一行受控文件信息（对齐参考 .xls）：
--   GRGJL.WI-HX-06-471(1.7)    颁布日期：2025/8/20    实施日期：2025/8/20
--
-- 这是【原始记录模板版本】的属性（同一模板出的所有记录共用），不是每条记录各填。
-- 来源：模板受控环节登记（接口⑦回传，或外部不可用时手动应急录入）。
-- 存在版本行上 → 随版本快照冻结，历史记录按其锁定版本回放对应的受控号（版本锁定回放，合规）。
-- 日期用 TEXT 原样存（如 "2025/8/20"），保留展示格式、不做日期解析。

ALTER TABLE record_template_versions
  ADD COLUMN IF NOT EXISTS controlled_no             TEXT,   -- 受控号 / 文件编号（含版本，如 GRGJL.WI-HX-06-471(1.7)）
  ADD COLUMN IF NOT EXISTS controlled_issue_date     TEXT,   -- 颁布日期
  ADD COLUMN IF NOT EXISTS controlled_effective_date TEXT;   -- 实施日期
