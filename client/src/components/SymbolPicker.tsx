/**
 * 全局「单位 / 符号」选择器
 *
 * 痛点：单位（℃ µm mg/kg Ω…）和数学符号（± × ≤ √ ∑…）输入法难打。
 * 方案：一个常驻右下角的浮动按钮，点开后选符号 → 插入到【当前/最近聚焦的文本输入框】
 *       光标处（用原生 value setter + 派发 input 事件，受控的 Antd Input/TextArea 也能更新）。
 *       没有聚焦输入框时，复制到剪贴板兜底。
 * 全站可用（编辑器 / 录入 / 移动页都在），无需给每个输入框单独接线。
 */
import { useEffect, useRef, useState } from 'react';
import { Popover, Tabs, Button, Tooltip, message } from 'antd';
import { CloseOutlined, FunctionOutlined } from '@ant-design/icons';

const GROUPS: { key: string; label: string; items: string[] }[] = [
  {
    key: 'unit', label: '单位',
    items: ['℃', '℉', '%', '‰', '°', 'µ', 'µm', 'nm', 'mm', 'cm', 'm', 'µg', 'mg', 'g', 'kg', 't',
      'µL', 'mL', 'L', 'm³', 'cm³', 'mol', 'mmol', 'mol/L', 'mg/L', 'g/L', 'mg/kg', 'mg/m³',
      'ppm', 'ppb', 'Pa', 'kPa', 'MPa', 'N', 'Hz', 's', 'min', 'h', 'Ω', 'V', 'A', 'W', 'dB', 'pH'],
  },
  {
    key: 'math', label: '数学',
    items: ['±', '×', '÷', '·', '≈', '≠', '≡', '≤', '≥', '＜', '＞', '√', '∛', '∑', '∏', '∫', '∞',
      '∝', '∠', '⊥', '∥', '′', '″', '→', '←', '↑', '↓', '⇌', '∆', '∂', '∇', '∈', '∉', '∪', '∩',
      '∴', '∵', '½', '¼', '¾'],
  },
  {
    key: 'greek', label: '希腊',
    items: ['α', 'β', 'γ', 'δ', 'ε', 'ζ', 'η', 'θ', 'κ', 'λ', 'μ', 'ν', 'ξ', 'π', 'ρ', 'σ', 'τ', 'φ', 'χ', 'ψ', 'ω',
      'Γ', 'Δ', 'Θ', 'Λ', 'Ξ', 'Π', 'Σ', 'Φ', 'Ψ', 'Ω'],
  },
  {
    key: 'sup', label: '上下标',
    items: ['⁰', '¹', '²', '³', '⁴', '⁵', '⁶', '⁷', '⁸', '⁹', '⁺', '⁻', 'ⁿ',
      '₀', '₁', '₂', '₃', '₄', '₅', '₆', '₇', '₈', '₉'],
  },
];

function isTextInput(el: Element | null): el is HTMLInputElement | HTMLTextAreaElement {
  if (!el) return false;
  if (el.tagName === 'TEXTAREA') return true;
  if (el.tagName === 'INPUT') {
    const t = ((el as HTMLInputElement).type || 'text').toLowerCase();
    return ['text', 'search', 'url', 'tel', 'email', 'password', ''].includes(t);
  }
  return false;
}

export default function SymbolPicker() {
  const [open, setOpen] = useState(false);
  // 最近聚焦的文本输入框 + 光标位置（focusin 记元素、focusout 兜底记光标）
  const target = useRef<{ el: HTMLInputElement | HTMLTextAreaElement; start: number; end: number } | null>(null);

  useEffect(() => {
    const record = (e: FocusEvent) => {
      const el = e.target as Element;
      if (isTextInput(el)) {
        target.current = {
          el,
          start: el.selectionStart ?? el.value.length,
          end: el.selectionEnd ?? el.value.length,
        };
      }
    };
    // 同时监听 focusin/focusout：因为面板用 mousedown preventDefault 保持输入框焦点，
    // 点符号时不会触发 focusout，需要 focusin 也记录目标。
    document.addEventListener('focusin', record, true);
    document.addEventListener('focusout', record, true);
    return () => {
      document.removeEventListener('focusin', record, true);
      document.removeEventListener('focusout', record, true);
    };
  }, []);

  // 打开时支持 Esc 收起（取消了"点输入框自动收起"，保留快捷关闭途径）
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const insert = (text: string) => {
    // 优先用"当前仍聚焦"的输入框（面板 mousedown preventDefault 保住了焦点），读实时光标；
    // 否则回退到最近记录的目标。
    const ae = document.activeElement;
    let el: HTMLInputElement | HTMLTextAreaElement | null = null;
    let start = 0, end = 0;
    if (isTextInput(ae)) {
      el = ae; start = ae.selectionStart ?? ae.value.length; end = ae.selectionEnd ?? ae.value.length;
    } else if (target.current && target.current.el.isConnected && isTextInput(target.current.el)) {
      el = target.current.el; start = target.current.start; end = target.current.end;
    }
    if (el) {
      const proto = el.tagName === 'TEXTAREA'
        ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      const next = el.value.slice(0, start) + text + el.value.slice(end);
      setter?.call(el, next);
      el.dispatchEvent(new Event('input', { bubbles: true })); // 触发 React onChange
      const pos = start + text.length;
      target.current = { el, start: pos, end: pos }; // 链式连续插入
      requestAnimationFrame(() => { el!.focus(); el!.setSelectionRange?.(pos, pos); });
    } else {
      navigator.clipboard?.writeText(text).then(
        () => message.info(`已复制 “${text}”，可粘贴到输入框`),
        () => message.warning('请先点中一个输入框'),
      );
    }
  };

  const content = (
    // mousedown preventDefault：点面板（含符号、Tab）不抢走输入框焦点 ——
    // ① 修复点符号时目标输入框失焦；② 修复带 tags 的「可选备注」在点面板时把未输完的文字误提交成选项。
    <div style={{ width: 320 }} onMouseDown={(e) => e.preventDefault()}>
      <Tabs
        size="small"
        items={GROUPS.map(g => ({
          key: g.key,
          label: g.label,
          children: (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 200, overflowY: 'auto' }}>
              {g.items.map((sym, i) => (
                <Button
                  key={`${g.key}-${i}`} size="small"
                  style={{ minWidth: 34, padding: '0 6px', fontFamily: "'PingFang SC', serif" }}
                  onClick={() => insert(sym)}
                >
                  {sym}
                </Button>
              ))}
            </div>
          ),
        }))}
      />
      <div style={{ fontSize: 11, color: '#9aa6b8', paddingTop: 4 }}>
        先点中输入框，再点符号即插入到光标处；未选中输入框则复制到剪贴板。
      </div>
    </div>
  );

  return (
    <Popover
      // 完全受控：只由 fx 按钮开关（trigger={[]} + 无 onOpenChange），点输入框/外部不收起；
      // 这样选完一个符号还能继续点输入框、再点符号，直到再次点 fx（或 Esc）才收起。
      open={open}
      trigger={[]}
      placement="topRight"
      content={content}
      title={
        <div style={{ minWidth: 180, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ flex: 1, fontWeight: 600 }}>单位 / 符号</span>
          <Button type="text" size="small" icon={<CloseOutlined />} aria-label="关闭单位与符号选择器" title="关闭"
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => { e.stopPropagation(); setOpen(false); }}
            style={{ marginRight: -6, color: '#8a94a6' }} />
        </div>
      }
    >
      <Tooltip title="单位 / 符号选择器（点 fx 固定/收起）" placement="left">
        <Button
          shape="circle"
          type={open ? 'primary' : 'default'}
          icon={<FunctionOutlined />}
          // mousedown preventDefault：点 fx 不抢走当前输入框焦点（否则会触发 tags 备注误提交）
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setOpen(o => !o)}
          style={{
            position: 'fixed', right: 22, bottom: 22, zIndex: 1000,
            width: 42, height: 42, boxShadow: '0 4px 12px rgba(16,24,40,0.18)',
          }}
        />
      </Tooltip>
    </Popover>
  );
}
