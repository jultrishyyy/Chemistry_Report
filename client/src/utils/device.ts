/** 是否触摸设备（手机 / 平板）。桌面浏览器的 <input capture> 不会唤起相机，
 *  会回退成文件选择，所以"拍照"按钮只在触摸设备显示。 */
export const IS_TOUCH =
  typeof navigator !== 'undefined' &&
  (navigator.maxTouchPoints > 0 ||
    (typeof window !== 'undefined' && typeof window.matchMedia === 'function' &&
      window.matchMedia('(pointer: coarse)').matches));
