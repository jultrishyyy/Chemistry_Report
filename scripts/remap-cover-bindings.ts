/**
 * 非破坏性迁移：把现有【首页模板(cover)】当前生效版本的字段绑定改为接口源（不删数据/不动报告）。
 *
 * 背景：Gap A/B 已把 order/sample/test/report_meta 全字段做成可绑来源，但旧首页模板的
 * 报告编号还绑在 order.order_no（委托单号）、委托方地址等是 literal 占位。本脚本按【字段 code】
 * 重绑到正确的接口字段，并补一个「检验码」字段（若缺）。
 *
 * 运行：pnpm tsx scripts/remap-cover-bindings.ts
 */
import pg from 'pg';
import { dbConfig } from '../config/index.js';

const { Pool } = pg;
const pool = new Pool({
  host: dbConfig.host, port: Number(dbConfig.port), database: dbConfig.database,
  user: dbConfig.user, password: dbConfig.password || undefined,
});

/** 按字段 code 重绑（仅改这些；其余保持原样，如商标/生产日期/供应商/签字仍手填）。
 *  含两套 code：seed 模板（cover_no/report_no/…）与现网模板 #9（unit_addr/issue_date_body）。
 *  注：组合型字段（如"报告备注\n资质备注"）不自动重绑，避免丢内容——交文员手填。 */
const REBIND: Record<string, any> = {
  // seed 首页模板
  cover_no:        { source: 'report_meta', key: 'cover_report_no' }, // 首页报告编号 ← 取号
  report_no:       { source: 'report_meta', key: 'report_no' },       // 报告编号 ← 取号
  cust_addr:       { source: 'order', key: 'company_address' },        // 委托方地址 ← 接口 1.1
  report_date:     { source: 'report_meta', key: 'issue_date' },       // 报告日期/签发 ← 取号
  // 现网首页模板（基本信息/签字栏）
  unit_addr:       { source: 'order', key: 'company_address' },        // 委托方单位地址 ← 接口 1.1
  issue_date_body: { source: 'report_meta', key: 'issue_date' },       // 签发日期 ← 取号
};

async function main() {
  const covers = await pool.query(
    `SELECT t.id, t.name, t.current_version_id, cv.field_definitions
     FROM report_templates t
     JOIN report_template_versions cv ON cv.id = t.current_version_id
     WHERE t.template_kind = 'cover' AND t.archived_at IS NULL`
  );
  let changedTemplates = 0;
  for (const row of covers.rows) {
    const groups: any[] = Array.isArray(row.field_definitions) ? row.field_definitions : [];
    let touched = false;
    let hasVerify = false;
    for (const g of groups) {
      for (const f of (g.fields || [])) {
        if (f.code === 'verify_code') hasVerify = true;
        if (REBIND[f.code]) {
          const next = REBIND[f.code];
          if (JSON.stringify(f.binding) !== JSON.stringify(next)) { f.binding = next; touched = true; }
        }
      }
    }
    // 补「检验码」字段：插在含 report_no 的分组里、report_no 之后（若整模板都没有 verify_code）。
    if (!hasVerify) {
      for (const g of groups) {
        const idx = (g.fields || []).findIndex((f: any) => f.code === 'report_no');
        if (idx >= 0) {
          g.fields.splice(idx + 1, 0, {
            id: `cf_verify_${row.id}`, code: 'verify_code', label: '检验码', type: 'text',
            binding: { source: 'report_meta', key: 'verify_code' },
          });
          touched = true;
          break;
        }
      }
    }
    if (touched) {
      await pool.query(
        'UPDATE report_template_versions SET field_definitions = $1::jsonb WHERE id = $2',
        [JSON.stringify(groups), row.current_version_id]
      );
      changedTemplates++;
      console.log(`[remap] 首页模板 #${row.id}「${row.name}」已更新绑定（版本 ${row.current_version_id}）`);
    } else {
      console.log(`[skip]  首页模板 #${row.id}「${row.name}」无需改动`);
    }
  }
  console.log(`[done] 共更新 ${changedTemplates} / ${covers.rows.length} 个首页模板。`);
  await pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });
