import type { ReactNode } from 'react';
import { ConfigProvider } from 'antd';

/** 禁用表单控件以及自由表格的原生鼠标/键盘入口；权限切换时销毁旧弹层状态。 */
export default function ReadOnlyEditorContent({ readOnly, children }: { readOnly: boolean; children: ReactNode }) {
  return <ConfigProvider componentDisabled={readOnly}>
    <div key={readOnly ? 'view' : 'edit'} inert={readOnly || undefined}>
      {children}
    </div>
  </ConfigProvider>;
}
