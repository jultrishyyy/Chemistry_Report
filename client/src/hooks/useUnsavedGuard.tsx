/**
 * useUnsavedGuard — 未保存改动守卫（模板编辑器用）。
 *
 * 编辑页面另有定时草稿保存；本守卫只负责自动保存尚未完成或保存失败时仍存在的真实改动。
 *
 * 覆盖两个出口：
 *  - 刷新 / 关标签页：beforeunload 原生确认框；
 *  - 应用内「返回」按钮：confirmLeave() 弹三选一（保存并离开 / 不保存离开 / 留在本页）。
 * （编辑器页隐藏了全局导航，应用内出口只有返回按钮；浏览器后退属于 beforeunload 不覆盖的
 *  SPA 行为，BrowserRouter 下无 useBlocker，属已知边界。）
 */
import { useEffect, useRef } from 'react';
import { Modal, Button } from 'antd';

export function useUnsavedGuard(isDirty: () => boolean) {
  const dirtyRef = useRef(isDirty);
  dirtyRef.current = isDirty;

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current()) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  /**
   * 包装离开动作：无改动直接走；有改动弹三选一。
   * @param leave 离开动作（如 navigate）
   * @param save  保存动作，resolve false 表示保存失败（留在本页）
   */
  const confirmLeave = (leave: () => void, save?: () => Promise<boolean | void> | boolean | void) => {
    if (!dirtyRef.current()) { leave(); return; }
    const modal = Modal.confirm({
      title: '有未保存的修改',
      content: '离开后未保存的修改将丢失。',
      okText: save ? '保存并离开' : '直接离开',
      cancelText: '留在本页',
      onOk: async () => {
        if (save) {
          const ok = await save();
          if (ok === false) return; // 保存失败（如校验不过），留在本页
        }
        leave();
      },
      footer: (_, { OkBtn, CancelBtn }) => (
        <>
          {save && (
            <Button danger onClick={() => { modal.destroy(); leave(); }}>不保存离开</Button>
          )}
          <CancelBtn />
          <OkBtn />
        </>
      ),
    });
  };

  return { confirmLeave };
}
