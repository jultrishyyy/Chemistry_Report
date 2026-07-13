/**
 * 全局 UI 主题（Antd ConfigProvider）——"专业蓝·检测机构感"。
 * 一处定义、全站生效：主色 / 圆角 / 字体 / 控件密度 / 表格·卡片·菜单 token。
 * 想换风格只改这里（颜色/圆角/密度），不用动各页面。
 */
import type { ThemeConfig } from 'antd';

/** 品牌主色：稳重专业蓝（贴近报告机构标识） */
export const BRAND = '#1366d9';
/** 页面底色（白卡片浮在浅灰上，更有"产品感"） */
export const APP_BG = '#f4f6fa';

export const appTheme: ThemeConfig = {
  token: {
    colorPrimary: BRAND,
    colorInfo: BRAND,
    colorLink: BRAND,
    borderRadius: 8,
    fontSize: 14,
    fontFamily:
      "'PingFang SC', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Microsoft YaHei', Roboto, Helvetica, Arial, sans-serif",
    colorBgLayout: APP_BG,
    colorTextHeading: '#1f2733',
    wireframe: false,
  },
  components: {
    Menu: {
      itemHeight: 48,
      horizontalItemSelectedColor: BRAND,
      horizontalItemHoverColor: BRAND,
      fontSize: 14,
    },
    Table: {
      headerBg: '#f2f5fb',
      headerColor: '#26334d',
      headerSplitColor: 'transparent',
      borderColor: '#eef1f6',
      rowHoverBg: '#f5f9ff',
      cellPaddingBlock: 11,
      headerBorderRadius: 8,
    },
    Card: { borderRadiusLG: 10, headerFontSize: 15 },
    Button: { controlHeight: 34, fontWeight: 500, primaryShadow: '0 2px 0 rgba(19,102,217,0.10)' },
    Input: { controlHeight: 34 },
    Select: { controlHeight: 34 },
    Tag: { borderRadiusSM: 6 },
    Modal: { borderRadiusLG: 12 },
    Drawer: {},
    Segmented: { borderRadius: 8 },
    Tabs: { titleFontSize: 14 },
  },
};
