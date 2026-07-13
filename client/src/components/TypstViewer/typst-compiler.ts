import axios from 'axios';

const API_BASE = '';
const cache = new Map<string, string>();

export async function compileTypst(source: string): Promise<string> {
  if (cache.has(source)) {
    return cache.get(source)!;
  }

  let response;
  try {
    response = await axios.post(
      `${API_BASE}/api/typst/compile`,
      { source },
      { responseType: 'blob' }
    );
  } catch (err: any) {
    // 编译失败（422）时响应体是 blob（JSON），responseType:'blob' 让 axios 不解析它——
    // 手动把 blob 读成文本取真正的 typst 报错，否则只剩 "Request failed with status code 422"。
    const data = err?.response?.data;
    if (data instanceof Blob) {
      try {
        const text = await data.text();
        const parsed = JSON.parse(text);
        const detail = parsed?.message || parsed?.error;
        if (detail) throw new Error(detail);
      } catch (inner: any) {
        if (inner instanceof Error && inner.message && !/JSON/.test(inner.message)) throw inner;
      }
    }
    throw err;
  }

  const blob = new Blob([response.data], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);

  if (cache.size >= 50) {
    const firstKey = cache.keys().next().value!;
    const oldUrl = cache.get(firstKey)!;
    URL.revokeObjectURL(oldUrl);
    cache.delete(firstKey);
  }
  cache.set(source, url);

  return url;
}

export function clearCompileCache() {
  for (const url of cache.values()) {
    URL.revokeObjectURL(url);
  }
  cache.clear();
}
