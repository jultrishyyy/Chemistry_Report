import { readFileSync, existsSync } from 'fs';
import { resolve, dirname, isAbsolute } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadJson(filename: string): Record<string, any> {
  const filepath = resolve(__dirname, filename);
  if (!existsSync(filepath)) return {};
  return JSON.parse(readFileSync(filepath, 'utf-8'));
}

function mergeWithEnv(base: Record<string, any>, prefix: string): Record<string, any> {
  const result = { ...base };
  for (const key of Object.keys(result)) {
    const envKey = `${prefix}_${key.toUpperCase()}`;
    if (process.env[envKey] !== undefined) {
      result[key] = process.env[envKey];
    }
  }
  return result;
}

const dbBase = loadJson('database.json');
const dbLocal = loadJson('database.local.json');
export const dbConfig = mergeWithEnv({ ...dbBase, ...dbLocal }, 'DB');

const typstBase = loadJson('typst.json');
export const typstConfig = mergeWithEnv(typstBase, 'TYPST');

// 外部 OA 登录（接口 5.1 commonLogin/login）：auth.json(基础) + auth.local.json(部署填真实值) + AUTH_* 环境变量
const authBase = loadJson('auth.json');
const authLocal = loadJson('auth.local.json');
export const authConfig = mergeWithEnv({ ...authBase, ...authLocal }, 'AUTH');

// 接口 1.4 报告回传（AcceptReportFromDiGui，SOAP）：report-delivery.json + .local.json + DELIVERY_* 环境变量
const deliveryBase = loadJson('report-delivery.json');
const deliveryLocal = loadJson('report-delivery.local.json');
export const deliveryConfig = mergeWithEnv({ ...deliveryBase, ...deliveryLocal }, 'DELIVERY');

// 上传文件（图片 / Excel 附件）存储根目录：storage.json + storage.local.json + STORAGE_UPLOADS_DIR 环境变量。
//   - uploads_dir 留空 → 默认【项目目录的上一级】data（resolve(项目根, '../data')），在代码目录之外，整包覆盖代码不影响。
//   - 填【绝对路径】（如 /data）→ 直接用。
//   - 填相对路径 → 相对仓库根解析。
// 目录结构：<根>/<订单号>/<样品名_测试项目名>/<字段名|附件名>（首页图片在 <根>/<订单号>/_首页/<字段名>）。
const storageBase = loadJson('storage.json');
const storageLocal = loadJson('storage.local.json');
export const storageConfig = mergeWithEnv({ ...storageBase, ...storageLocal }, 'STORAGE');

/** 上传文件根目录的绝对路径。默认＝项目目录的上一级 data（__dirname=仓库/config → 仓库上一级=../.. → ../../data）。 */
export const uploadsDir: string = (() => {
  const v = String(storageConfig.uploads_dir || '').trim();
  if (!v) return resolve(__dirname, '../../data');          // 默认：项目目录的上一级 /data
  return isAbsolute(v) ? v : resolve(__dirname, '..', v);   // 自定义：绝对路径直接用，相对路径相对仓库根
})();

/** 历史扁平上传目录（旧数据兼容）：早期图片在 server/uploads/images、附件在 server/uploads 下。 */
export const legacyUploadsDir: string = resolve(__dirname, '../server/uploads');

// 报告页眉页脚【默认】版式 + 取号前示例数据（header-footer.json，随代码部署；.local.json 可覆盖）。
// 改这里即改所有报告页眉页脚默认；报告模板自配的 layout_options.header_footer 仍优先于此。
const hfBase = loadJson('header-footer.json');
const hfLocal = loadJson('header-footer.local.json');
export const headerFooterConfig: Record<string, any> = {
  ...hfBase, ...hfLocal,
  apply_to: { ...(hfBase.apply_to || {}), ...(hfLocal.apply_to || {}) },
  settings: { ...(hfBase.settings || {}), ...(hfLocal.settings || {}) },
  sample_meta: { ...(hfBase.sample_meta || {}), ...(hfLocal.sample_meta || {}) },
};

export function printConfig() {
  console.log('[config] DB host=%s database=%s', dbConfig.host, dbConfig.database);
  console.log('[config] Typst binary=%s', typstConfig.binary);
  console.log('[config] OA 登录=%s', authConfig.common_login_url ? `真实(${authConfig.common_login_url}, appId=${authConfig.app_id})` : 'mock(未配 common_login_url，任意账号登录)');
  console.log('[config] 报告回传(1.4)=%s', deliveryConfig.soap_endpoint ? `SOAP(${deliveryConfig.soap_endpoint})` : 'mock(未配 soap_endpoint)');
  console.log('[config] 上传目录=%s', uploadsDir);
  const hfKeys = Object.keys(headerFooterConfig.settings || {}).filter(k => !k.startsWith('_')).length;
  console.log('[config] 页眉页脚默认=%s（分割线 header_rule=%s）', hfKeys ? `header-footer.json(${hfKeys} 项)` : '未配(用主题默认)', headerFooterConfig.settings?.header_rule);
}
