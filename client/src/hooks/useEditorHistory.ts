import { useCallback, useState, type SetStateAction } from 'react';

const cloneFromSnapshot = <T,>(snapshot: string): T => JSON.parse(snapshot) as T;

interface HistoryState<T> {
  value: T;
  baseline: string;
  past: string[];
  future: string[];
  lastChangeAt: number;
  groupStartedAt: number;
}

/**
 * 编辑器级 JSON 快照历史。模板与报告实例本身就是可持久化 JSON，使用与保存口径一致的
 * 快照可同时覆盖字段、表格、映射、格式和版式，不需要各子编辑器维护互相冲突的历史栈。
 */
export function useEditorHistory<T>(initialValue: T, maxSteps = 50) {
  const [history, setHistory] = useState<HistoryState<T>>(() => ({
    value: initialValue,
    baseline: JSON.stringify(initialValue),
    past: [],
    future: [],
    lastChangeAt: 0,
    groupStartedAt: 0,
  }));

  const setValue = useCallback((action: SetStateAction<T>) => {
    setHistory(previous => {
      const next = typeof action === 'function'
        ? (action as (current: T) => T)(previous.value)
        : action;
      const previousSnapshot = JSON.stringify(previous.value);
      const nextSnapshot = JSON.stringify(next);
      if (previousSnapshot === nextSnapshot) return previous;

      const now = Date.now();
      // 文本输入、颜色滑动和宽高拖动等连续事件合并，撤回时回到本次连续操作开始前。
      const merge = previous.lastChangeAt !== 0 && now - previous.lastChangeAt < 400 && now - previous.groupStartedAt < 1500 && previous.past.length > 0;
      const past = merge
        ? previous.past
        : [...previous.past, previousSnapshot].slice(-maxSteps);
      return { ...previous, value: next, past, future: [], lastChangeAt: now, groupStartedAt: merge ? previous.groupStartedAt : now };
    });
  }, [maxSteps]);

  /** Pointer/focus changes delimit operations, without modifying data or history. */
  const closeGroup = useCallback(() => {
    setHistory(previous => previous.lastChangeAt ? { ...previous, lastChangeAt: 0, groupStartedAt: 0 } : previous);
  }, []);

  /** Saving acknowledges persistence, not a new editing session. Ignore stale responses. */
  const acceptSavedValue = useCallback((submitted: T, saved: T) => {
    const submittedSnapshot = JSON.stringify(submitted);
    setHistory(previous => {
      if (JSON.stringify(previous.value) !== submittedSnapshot) return previous;
      return { ...previous, value: JSON.stringify(saved) === submittedSnapshot ? previous.value : saved,
        lastChangeAt: 0, groupStartedAt: 0 };
    });
  }, []);

  /** One explicit user operation, isolated from nearby typing/spinner history. */
  const setValueTransaction = useCallback((action: SetStateAction<T>) => {
    setHistory(previous => {
      const next = typeof action === 'function' ? (action as (value: T) => T)(previous.value) : action;
      const snapshot = JSON.stringify(previous.value);
      if (JSON.stringify(next) === snapshot) return previous;
      return { ...previous, value: next, past: [...previous.past, snapshot].slice(-maxSteps), future: [], lastChangeAt: 0, groupStartedAt: 0 };
    });
  }, [maxSteps]);

  /** 异步加载或自动初始化完成后，以该值重新建立“进入编辑器时”的基线。 */
  const replaceBaseline = useCallback((action: SetStateAction<T>) => {
    setHistory(previous => {
      const next = typeof action === 'function'
        ? (action as (current: T) => T)(previous.value)
        : action;
      return {
        value: next,
        baseline: JSON.stringify(next),
        past: [],
        future: [],
        lastChangeAt: 0,
        groupStartedAt: 0,
      };
    });
  }, []);

  const undo = useCallback(() => {
    setHistory(previous => {
      const previousSnapshot = previous.past[previous.past.length - 1];
      if (!previousSnapshot) return previous;
      return {
        ...previous,
        value: cloneFromSnapshot<T>(previousSnapshot),
        past: previous.past.slice(0, -1),
        future: [JSON.stringify(previous.value), ...previous.future].slice(0, maxSteps),
        lastChangeAt: 0,
      };
    });
  }, [maxSteps]);

  const redo = useCallback(() => {
    setHistory(previous => {
      const nextSnapshot = previous.future[0];
      if (!nextSnapshot) return previous;
      return {
        ...previous,
        value: cloneFromSnapshot<T>(nextSnapshot),
        past: [...previous.past, JSON.stringify(previous.value)].slice(-maxSteps),
        future: previous.future.slice(1),
        lastChangeAt: 0,
      };
    });
  }, [maxSteps]);

  const reset = useCallback(() => {
    setHistory(previous => {
      const currentSnapshot = JSON.stringify(previous.value);
      if (currentSnapshot === previous.baseline) return previous;
      return {
        ...previous,
        value: cloneFromSnapshot<T>(previous.baseline),
        past: [...previous.past, currentSnapshot].slice(-maxSteps),
        future: [],
        lastChangeAt: 0,
      };
    });
  }, [maxSteps]);

  return {
    value: history.value,
    setValue,
    setValueTransaction,
    closeGroup,
    acceptSavedValue,
    replaceBaseline,
    undo,
    redo,
    reset,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    canReset: JSON.stringify(history.value) !== history.baseline,
  };
}
