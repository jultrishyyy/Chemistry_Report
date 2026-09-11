/**
 * 整行可点击时，行内按钮、链接、输入控件和弹出菜单仍应只执行自身操作，
 * 不能继续冒泡触发“进入详情”。
 */
export function isInteractiveRowTarget(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest([
    'button',
    'a',
    'input',
    'textarea',
    'select',
    '[role="button"]',
    '[role="menuitem"]',
    '.ant-dropdown',
    '.ant-select',
    '.ant-checkbox-wrapper',
  ].join(','));
}
