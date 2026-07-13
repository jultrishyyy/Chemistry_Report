import axios from 'axios';
import { useEffect, useState } from 'react';
import type { RecordTemplate } from '../../../shared/types';

const API = '/api';

/**
 * 设备名称反查（原始记录「测试设备」device_ref 字段显示「设备名称：管理编号」用）。
 * 录入端只把设备的【管理编号】存进 record_data（数组），名称在设备库里。渲染期（generateTypstWithData /
 * flattenDataForDisplay）需要一份「管理编号 → 名称」映射才能显示成「名称：编号」。此工具集中提供该映射。
 */

/** 从录入数据里收集所有 device_ref 字段引用的设备管理编号（去重）。值可能是编号字符串或 {code} 对象。 */
export function collectDeviceCodes(template: RecordTemplate | null | undefined, data: Record<string, any> | null | undefined): string[] {
  if (!template || !data) return [];
  const set = new Set<string>();
  for (const g of template.groups || []) {
    for (const f of g.fields || []) {
      if (f.type !== 'device_ref') continue;
      const v = data[f.code];
      if (!Array.isArray(v)) continue;
      for (const d of v) {
        const c = d && typeof d === 'object' ? (d.code ?? d.asset_code) : d;
        if (c) set.add(String(c));
      }
    }
  }
  return [...set];
}

/** 批量反查设备管理编号 → {name,model}（设备库 GET /api/equipment/lookup）。空/失败返回 {}（渲染退回只显编号）。 */
export async function fetchDeviceMap(codes: string[]): Promise<Record<string, { name?: string; model?: string }>> {
  if (!codes.length) return {};
  try {
    const res = await axios.get(`${API}/equipment/lookup`, { params: { codes: codes.join(',') } });
    const map: Record<string, { name?: string; model?: string }> = {};
    for (const r of res.data || []) map[r.asset_code] = { name: r.name, model: r.model };
    return map;
  } catch { return {}; }
}

/**
 * React hook：随录入数据里的设备编号变化异步拉取「编号→名称」映射，
 * 传给 generateTypstWithData(tmpl, data, { deviceMap }) 即可显示「设备名称：管理编号」。
 */
export function useDeviceMap(template: RecordTemplate | null | undefined, data: Record<string, any> | null | undefined): Record<string, { name?: string }> {
  const [map, setMap] = useState<Record<string, { name?: string }>>({});
  const key = collectDeviceCodes(template, data).sort().join(',');
  useEffect(() => {
    if (!key) { setMap({}); return; }
    let alive = true;
    fetchDeviceMap(key.split(',')).then(m => { if (alive) setMap(m); });
    return () => { alive = false; };
  }, [key]);
  return map;
}
