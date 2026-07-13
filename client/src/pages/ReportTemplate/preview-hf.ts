/**
 * 报告模板编辑器预览用的页眉页脚【版式默认 + 示例数据】（Cover/Project 编辑器共用）。
 *
 * ✅ 单一事实来源：本文件【直接派生自 `config/header-footer.json`】——它同时是【真实报告】页眉页脚
 *    的默认来源（服务端 `buildHeaderFooterConfig` 读 `headerFooterConfig.settings`）。所以编辑器预览
 *    与最终报告**天然同步**，不再需要手工维护两份。改默认只改 `config/header-footer.json` 一处即可
 *    （改完前端需 `pnpm build` 重新构建，预览才更新；真实报告是运行时读取、重启即可）。
 *
 * 注：服务端会再叠加 `config/header-footer.local.json` 覆盖；前端只内置 base（`header-footer.json`）。
 *    若用 `.local.json` 做了部署级覆盖，真实报告会反映、编辑器预览不会（属可接受的边缘情况）。
 */
import hfConfig from '../../../../config/header-footer.json';

/** 去掉以 `_` 开头的文档说明键（如 `_说明` / `_键说明`）——它们只是注释、不是真正的版式/数据键。 */
function stripDocKeys(o: Record<string, unknown> | undefined): Record<string, any> {
  return Object.fromEntries(Object.entries(o || {}).filter(([k]) => !k.startsWith('_')));
}

const _hf = hfConfig as { settings?: Record<string, unknown>; sample_meta?: Record<string, unknown> };

/**
 * 页眉页脚【版式默认】——取自 `config/header-footer.json` 的 `settings`（与真实报告同源）。
 * 含 title_size/title_tracking/header_rule/页面几何/字体 等。CoverEditor 预览以它为基底，
 * 模板自配的 `header_footer` 键覆盖之。ProjectEditor 拉不到首页时也回退它。
 */
export const STANDARD_HF_LAYOUT = stripDocKeys(_hf.settings);

/**
 * 页眉页脚【示例数据值】——公司名/地址/电话等取自 `config/header-footer.json` 的 `sample_meta`；
 * 另补充取号前没有、出报告时由接口 1.2 回填的【报告编号 / 校验码】示例，让编辑器预览能看到这两行。
 */
export const PREVIEW_HF_VALUES = {
  ...stripDocKeys(_hf.sample_meta),
  // 取号前没有真实报告号/校验码（出报告由接口 1.2 的 ReportNumber/CheckCode 回填）——预览给个样例
  report_no: 'C202604102938',
  cover_report_no: 'C202604102938',
  verify_code: '456582',
};
