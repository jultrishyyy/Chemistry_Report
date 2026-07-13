/**
 * migrate-sample-desc.ts — 把已生成报告/首页草稿的「样品照片」分区按 v6 结构补上独立「样品描述」字段。
 *
 * 背景：旧结构里样品照片分区只有 1 个 image 字段(标签="样品描述：见原样照片")；v6 拆成
 *   text「样品描述」(字面量"见原始样本照片。") + image「原样照片」。本脚本对存量报告/草稿做同样的拆分，
 *   **保留已上传的照片**(image_photos)与文员设的图片排版，仅重渲 final_typst，不动其它字段。
 *
 * 模板 v6（id=24）的字段定义作为模板来源，按 group.id='f100' 定位。幂等：已含 text 字段的分区跳过。
 *
 * 用法：
 *   pnpm tsx scripts/migrate-sample-desc.ts [order_no] --dry-run   # 预览
 *   pnpm tsx scripts/migrate-sample-desc.ts [order_no]            # 写库 + 重渲
 */
import { pool } from '../server/src/db.js';
import { renderContentDoc } from '../shared/typst-generator.js';

const V6_VERSION_ID = 24;          // 模板 9 的 v6（含独立样品描述）
const SAMPLE_PHOTO_GROUP_ID = 'f100';
// 从旧 image 字段保留到新 image 字段的键（照片 + 文员排版设置）
const PRESERVE_IMG_KEYS = ['image_photos', 'image_cols', 'image_size', 'image_title_mode', 'image_items',
  'image_solo', 'image_seamless', 'image_header_follow', 'image_table_style', 'image_layout', 'image_row_ratio'];

const clone = (x: any) => JSON.parse(JSON.stringify(x));

async function loadV6Template() {
  const v = await pool.query('SELECT field_definitions FROM report_template_versions WHERE id=$1', [V6_VERSION_ID]);
  const grp = (v.rows[0]?.field_definitions || []).find((g: any) => g.id === SAMPLE_PHOTO_GROUP_ID);
  if (!grp) throw new Error('v6 模板里找不到样品照片分区 ' + SAMPLE_PHOTO_GROUP_ID);
  const text = (grp.fields || []).find((f: any) => f.type === 'text');
  const img = (grp.fields || []).find((f: any) => f.type === 'image');
  if (!text || !img) throw new Error('v6 样品照片分区缺 text/image 字段');
  return { grp, text, img };
}

/** 就地把一个 content_doc 的样品照片分区迁移到 v6 结构。返回是否改动。 */
function migrateDoc(doc: any, v6: { grp: any; text: any; img: any }): boolean {
  if (!doc?.cover?.groups) return false;
  const grp = doc.cover.groups.find((g: any) => g.id === SAMPLE_PHOTO_GROUP_ID)
    || doc.cover.groups.find((g: any) => g.section_role === 'images' && (g.label || '').includes('照片'));
  if (!grp) return false;
  if ((grp.fields || []).some((f: any) => f.type === 'text')) return false;  // 幂等：已迁移
  const oldImg = (grp.fields || []).find((f: any) => f.type === 'image');
  if (!oldImg) return false;

  const newText = clone(v6.text);
  const newImg = clone(v6.img);
  for (const k of PRESERVE_IMG_KEYS) if (oldImg[k] !== undefined) newImg[k] = clone(oldImg[k]);
  newImg.id = oldImg.id; newImg.code = oldImg.code;   // 沿用原 image 字段 id/code（照片落盘路径关联）

  grp.fields = [newText, newImg];
  if (v6.grp.label_width !== undefined) grp.label_width = v6.grp.label_width;
  if (v6.grp.style) grp.style = { ...(grp.style || {}), ...v6.grp.style };
  return true;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const orderNo = args.find(a => !a.startsWith('--')) || null;
  const v6 = await loadV6Template();

  const where = ['content_doc IS NOT NULL'];
  const params: any[] = [];
  if (orderNo) { params.push(orderNo); where.push(`order_no = $${params.length}`); }
  const { rows } = await pool.query(
    `SELECT id, report_no, is_cover_draft, content_doc, content_doc_original FROM reports WHERE ${where.join(' AND ')} ORDER BY id`, params);

  console.log(`[migrate] 命中 ${rows.length} 份(报告+草稿)${orderNo ? `（订单 ${orderNo}）` : ''}${dryRun ? '（dry-run）' : ''}`);
  let done = 0, skipped = 0, failed = 0;
  for (const r of rows) {
    const tag = r.report_no || `#${r.id}`;
    try {
      const doc = r.content_doc, orig = r.content_doc_original;
      const c1 = migrateDoc(doc, v6);
      const c2 = orig ? migrateDoc(orig, v6) : false;
      if (!c1 && !c2) { skipped++; continue; }
      const finalTypst = renderContentDoc(doc);
      console.log(`  ${dryRun ? '· 待迁' : '✓ 迁移'} ${tag}${r.is_cover_draft ? '（草稿）' : ''}：样品照片 → [样品描述(text) + 原样照片(image，保留照片)]`);
      if (!dryRun) {
        await pool.query(
          `UPDATE reports SET content_doc=$1::jsonb, content_doc_original=$2::jsonb, final_typst=$3 WHERE id=$4`,
          [JSON.stringify(doc), JSON.stringify(orig ?? doc), finalTypst, r.id]);
      }
      done++;
    } catch (e: any) {
      console.log(`  ✗ 失败 ${tag}：${(e?.message || e).toString().split('\n')[0]}`); failed++;
    }
  }
  console.log(`[migrate] 完成：${dryRun ? '待迁' : '已迁'} ${done}，跳过 ${skipped}，失败 ${failed}`);
  await pool.end();
  process.exit(failed ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
