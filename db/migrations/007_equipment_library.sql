-- 007: 设备库
CREATE TABLE IF NOT EXISTS equipment_library (
  id SERIAL PRIMARY KEY,
  asset_code TEXT UNIQUE NOT NULL,        -- "管理编号"，如 HX2007-G025
  name TEXT NOT NULL,                     -- "仪器名称"
  model TEXT,                             -- "仪器型号"
  factory_serial TEXT,                    -- "出厂编号"
  cert_no TEXT,                           -- "证书编号"
  trace_date DATE,                        -- "溯源日期"
  expire_date DATE,                       -- "到期日期"
  status TEXT,                            -- "状态"（合格/已超期 等）
  category TEXT,                          -- "设备类别"
  department TEXT,                        -- "所属部门"
  raw_payload JSONB,                      -- 原始 Excel 行
  imported_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_equipment_asset_code ON equipment_library(asset_code);
CREATE INDEX IF NOT EXISTS idx_equipment_name ON equipment_library(name);
CREATE INDEX IF NOT EXISTS idx_equipment_status ON equipment_library(status);
