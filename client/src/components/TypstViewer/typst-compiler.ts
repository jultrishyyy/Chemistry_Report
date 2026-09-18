import axios from 'axios';
import { ByteLru } from '../../../../shared/byte-lru';

const API_BASE = '';
// Cache bytes, never a URL owned (and revoked) by a preview or download.
const cache = new ByteLru<Blob>(50, 32 * 1024 * 1024, (blob, source) => blob.size + source.length * 2);

export async function compileTypst(source: string, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted();
  const cached = cache.get(source);
  if (cached) {
    return URL.createObjectURL(cached);
  }

  let response;
  try {
    response = await axios.post(
      `${API_BASE}/api/typst/compile`,
      { source },
      { responseType: 'blob', signal, ...(signal ? { headers: { 'X-Preview-Request': '1' } } : {}) }
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

  signal?.throwIfAborted();
  const blob = new Blob([response.data], { type: 'application/pdf' });

  cache.set(source, blob);

  return URL.createObjectURL(blob);
}

export function clearCompileCache() {
  cache.clear();
}
