import { useState } from 'react';
import type { ComponentProps } from 'react';
import AutoGrowTextArea from './AutoGrowTextArea';

/** Show formatted values at rest, but edit the full precision source without rounding each keystroke. */
export default function FreeGridNumberInput({ value, displayValue, ...props }: ComponentProps<typeof AutoGrowTextArea> & { displayValue: string }) {
  const [editing, setEditing] = useState(false);
  return <AutoGrowTextArea {...props} value={editing ? value : displayValue}
    onFocus={event => { setEditing(true); props.onFocus?.(event); }}
    onBlur={event => { setEditing(false); props.onBlur?.(event); }} />;
}
