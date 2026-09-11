import { createElement, useCallback, useEffect, useState } from 'react';
import { Select, Space } from 'antd';
import type { TablePaginationConfig } from 'antd';

/**
 * 列表统一分页偏好。条数是用户的阅读习惯，而不是某一台显示器的固定参数：
 * 所有业务列表共用一份选择，并保存在当前浏览器中。
 */
const STORAGE_KEY = 'cdr.list-page-size.v1';
export const LIST_PAGE_SIZE_OPTIONS = [10, 20, 30, 50, 100];
const DEFAULT_PAGE_SIZE = 20;

function readPageSize() {
  if (typeof window === 'undefined') return DEFAULT_PAGE_SIZE;
  const value = Number(window.localStorage.getItem(STORAGE_KEY));
  return LIST_PAGE_SIZE_OPTIONS.includes(value) ? value : DEFAULT_PAGE_SIZE;
}

/** 放在筛选栏里的显式入口；不依赖表格底部是否显示分页，所有列表页都能调整。 */
export function ListPageSizeControl({ value, onChange }: { value: number; onChange: (size: number) => void }) {
  return createElement(Space, { size: 6, style: { marginLeft: 'auto', whiteSpace: 'nowrap' } }, [
    createElement('span', { key: 'label', style: { color: '#667085', fontSize: 13 } }, '每页显示'),
    createElement(Select, {
      key: 'select', size: 'small', value, style: { width: 92 },
      options: LIST_PAGE_SIZE_OPTIONS.map(size => ({ value: size, label: `${size} 条` })),
      onChange: (next: unknown) => onChange(Number(next)),
    }),
  ]);
}

export function useListPagination(resetKey?: unknown) {
  const [current, setCurrent] = useState(1);
  const [pageSize, setPageSize] = useState(readPageSize);

  // 筛选条件、列表类型切换后从第一页开始，避免落在不存在的页码上。
  useEffect(() => { setCurrent(1); }, [resetKey]);

  const changePageSize = useCallback((nextPageSize: number) => {
    if (!LIST_PAGE_SIZE_OPTIONS.includes(nextPageSize)) return;
    setPageSize(nextPageSize);
    setCurrent(1);
    window.localStorage.setItem(STORAGE_KEY, String(nextPageSize));
  }, []);

  const onChange = useCallback((nextPage: number, nextPageSize: number) => {
    if (nextPageSize !== pageSize) changePageSize(nextPageSize);
    else setCurrent(nextPage);
  }, [changePageSize, pageSize]);

  const pagination: TablePaginationConfig = {
    current,
    pageSize,
    showSizeChanger: true,
    pageSizeOptions: LIST_PAGE_SIZE_OPTIONS,
    showQuickJumper: true,
    showTotal: (total, range) => `第 ${range[0]}–${range[1]} 条，共 ${total} 条`,
    // 即使当前数据不足一页，也保留「每页条数」入口；否则小列表的用户无法
    // 预先把 20 条改成 30/50 条，且会误以为系统没有提供此功能。
    hideOnSinglePage: false,
    onChange,
  };

  return { pagination, current, setCurrent, pageSize, setPageSize: changePageSize, resetPage: () => setCurrent(1) };
}
