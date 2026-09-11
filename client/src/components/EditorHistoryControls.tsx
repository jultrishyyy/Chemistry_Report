import { Button, Modal, Tooltip } from 'antd';
import { RedoOutlined, ReloadOutlined, UndoOutlined } from '@ant-design/icons';

interface Props {
  canUndo: boolean;
  canRedo: boolean;
  canReset: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onReset: () => void;
  disabled?: boolean;
  shortcutHints?: boolean;
}

/** 四类编辑器共用的紧凑历史按钮组。 */
export default function EditorHistoryControls({ canUndo, canRedo, canReset, onUndo, onRedo, onReset, disabled, shortcutHints }: Props) {
  const confirmReset = () => Modal.confirm({
    title: '重置到进入编辑器时的状态？',
    content: '进入页面后所做的全部修改都会被恢复。重置完成后仍可点击“撤回”找回修改。',
    okText: '确认重置',
    cancelText: '取消',
    okButtonProps: { danger: true },
    onOk: onReset,
  });

  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
      <Tooltip title={canUndo ? `撤回上一步${shortcutHints ? '（Ctrl / ⌘ Z）' : ''}` : '暂无可撤回操作'}>
        <Button size="small" type="text" aria-label="撤回" icon={<UndoOutlined />} disabled={disabled || !canUndo} onClick={onUndo} />
      </Tooltip>
      <Tooltip title={canRedo ? `重做下一步${shortcutHints ? '（Ctrl / ⌘ Shift Z）' : ''}` : '暂无可重做操作'}>
        <Button size="small" type="text" aria-label="重做" icon={<RedoOutlined />} disabled={disabled || !canRedo} onClick={onRedo} />
      </Tooltip>
      <Tooltip title="重置到本次进入编辑器时的状态">
        <Button size="small" type="text" aria-label="重置到进入时状态" icon={<ReloadOutlined />} disabled={disabled || !canReset} onClick={confirmReset} />
      </Tooltip>
    </div>
  );
}
