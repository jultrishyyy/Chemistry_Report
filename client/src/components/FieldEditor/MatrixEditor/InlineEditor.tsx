/**
 * InlineEditor — 双击后出现的行内编辑 Input
 * 按 Enter 或失焦提交；按 Escape 取消
 */
import { useState, useRef, useEffect } from 'react';
import AutoGrowTextArea from '../../AutoGrowTextArea';

interface Props {
  value: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
  style?: React.CSSProperties;
  placeholder?: string;
  /** 允许提交空值（如左上角表头显式留空）；缺省空值=取消 */
  allowEmpty?: boolean;
}

export default function InlineEditor({ value, onCommit, onCancel, style, placeholder, allowEmpty }: Props) {
  const [draft, setDraft] = useState(value);
  const ref = useRef<any>(null);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  const commit = () => {
    const trimmed = draft.trim();
    if ((trimmed || allowEmpty) && trimmed !== value) onCommit(trimmed);
    else onCancel();
  };

  return (
    <AutoGrowTextArea
      ref={ref}
      size="small"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commit(); }
        if (e.key === 'Escape') { e.stopPropagation(); onCancel(); }
      }}
      placeholder={placeholder}
      style={{ width: '100%', minWidth: 60, ...style }}
    />
  );
}
