import { Input } from 'antd';
import type { ComponentProps } from 'react';

type TextAreaProps = ComponentProps<typeof Input.TextArea>;

/**
 * 用于名称、标题、表格单元格等短文本：
 * 一行起步，按内容自动增高，最多同时显示三行，更多内容在框内滚动。
 */
export default function AutoGrowTextArea({
  autoSize,
  style,
  ...props
}: TextAreaProps) {
  return (
    <Input.TextArea
      {...props}
      autoSize={autoSize ?? { minRows: 1, maxRows: 3 }}
      style={{
        resize: 'none',
        overflowWrap: 'anywhere',
        overflowY: 'auto',
        ...style,
      }}
    />
  );
}
