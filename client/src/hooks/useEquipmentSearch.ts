import { useEffect, useState } from 'react';

export type EquipmentSearchItem = { asset_code: string; name: string; model?: string; status?: string; expire_date?: string | null };
/** Replace results per query; abort and ignore stale requests, including after clearing input. */
export function useEquipmentSearch() {
  const [keyword, setKeyword] = useState('');
  const [state, setState] = useState<{ keyword: string; items: EquipmentSearchItem[]; loading: boolean; error: string }>({ keyword: '', items: [], loading: false, error: '' });
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    if (!keyword.trim()) { setState({ keyword, items: [], loading: false, error: '' }); return; }
    setState({ keyword, items: [], loading: true, error: '' });
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/equipment?keyword=${encodeURIComponent(keyword.trim())}&limit=30`, { signal: controller.signal });
        if (!response.ok) throw Error('设备查询失败，请重试');
        const result = await response.json();
        if (!Array.isArray(result.items)) throw Error('设备查询结果异常，请重试');
        const items = result.items.filter((item: any) => typeof item?.asset_code === 'string' && typeof item?.name === 'string');
        if (active) setState({ keyword, items, loading: false, error: '' });
      } catch {
        if (active) setState({ keyword, items: [], loading: false, error: '设备查询失败，请重新搜索' });
      }
    }, 300);
    return () => { active = false; clearTimeout(timer); controller.abort(); };
  }, [keyword]);
  const current = state.keyword === keyword;
  return { keyword, setKeyword, items: current ? state.items : [], loading: !!keyword.trim() && (!current || state.loading), error: current ? state.error : '' };
}
