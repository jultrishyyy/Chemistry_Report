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

// 所有外部接口统一由 interfaces.{demo|server}.json 管理。
// 未设 INTEGRATIONS_PROFILE 时安全地使用 demo（OA / SOAP 都不会真实调用）。
const requestedProfile = String(process.env.INTEGRATIONS_PROFILE || 'demo').trim().toLowerCase();
if (requestedProfile !== 'demo' && requestedProfile !== 'server') {
  throw new Error(`[config] INTEGRATIONS_PROFILE 只能是 demo 或 server（当前：${requestedProfile || '(空)'}）`);
}
export const integrationsProfile = requestedProfile === 'server' ? 'server' : 'demo';
const interfacesProfile = loadJson(`interfaces.${integrationsProfile}.json`);
if (integrationsProfile === 'server' && Object.keys(interfacesProfile).length === 0) {
  throw new Error('[config] server 模式缺少 config/interfaces.server.json；拒绝回退到 mock，请复制 interfaces.server.json.example 后填写真实值。');
}
const interfaceConfig = integrationsProfile === 'server'
  ? interfacesProfile
  : (Object.keys(interfacesProfile).length ? interfacesProfile : loadJson('interfaces.demo.json'));

// 本地认证/RBAC 策略仍在 auth.json；外部 OA 端点来自统一接口配置。
const authBase = loadJson('auth.json');
export const authConfig = mergeWithEnv({ ...authBase, ...(interfaceConfig.auth || {}) }, 'AUTH');

// 接口 1.4 / 1.5 / 1.6（SOAP）：报告回传、撤回送审、材料任务状态通知共用配置。
export const deliveryConfig = mergeWithEnv({ ...(interfaceConfig.report_delivery || {}) }, 'DELIVERY');
/** PDF 中附件超链接使用的外部系统地址；PUBLIC_BASE_URL 可临时覆盖配置。 */
export const publicBaseUrl = String(process.env.PUBLIC_BASE_URL ?? interfaceConfig.public_base_url ?? '').trim().replace(/\/$/, '');

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
  console.log('[config] 外部接口配置=%s (config/interfaces.%s.json)', integrationsProfile, integrationsProfile);
  console.log('[config] 报告取号(1.2)页眉页脚=%s', integrationsProfile === 'server' ? '严格使用 POST /api/external/reports 推送值（不回退示例）' : 'mock 示例值');
  console.log('[config] DB host=%s database=%s', dbConfig.host, dbConfig.database);
  console.log('[config] Typst binary=%s', typstConfig.binary);
  console.log('[config] OA 登录=%s', authConfig.common_login_url ? `真实(${authConfig.common_login_url}, appId=${authConfig.app_id})` : 'mock(未配 common_login_url，任意账号登录)');
  console.log('[config] 业务系统 SOAP(1.4/1.5/1.6)=%s', deliveryConfig.soap_endpoint ? `SOAP(${deliveryConfig.soap_endpoint})` : 'mock(未配 soap_endpoint)');
  console.log('[config] PDF 附件公开地址=%s', publicBaseUrl || '未配置（本机演示会使用当前服务地址）');
  console.log('[config] 上传目录=%s', uploadsDir);
  const hfKeys = Object.keys(headerFooterConfig.settings || {}).filter(k => !k.startsWith('_')).length;
  console.log('[config] 页眉页脚默认=%s（分割线 header_rule=%s）', hfKeys ? `header-footer.json(${hfKeys} 项)` : '未配(用主题默认)', headerFooterConfig.settings?.header_rule);
}
