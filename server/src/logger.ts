/**
 * 极简结构化日志（零依赖，内网友好）。
 *
 * 单行输出便于 journalctl / grep / 日志切割工具消费：
 *   2026-06-26T10:00:00.000Z INFO req method=GET path=/api/reports status=200 ms=12
 * 比散落的 console.log 多了「时间戳 + 级别 + 结构化字段」，排查问题/接日志系统都更省事。
 * 现有各处 console.* 可按需逐步迁移到这里，不强求一次性替换。
 */
type Fields = Record<string, unknown>;

function emit(level: 'INFO' | 'WARN' | 'ERROR', msg: string, fields?: Fields): void {
  const parts: string[] = [new Date().toISOString(), level, msg];
  if (fields) {
    for (const [k, v] of Object.entries(fields)) {
      parts.push(`${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`);
    }
  }
  const line = parts.join(' ');
  if (level === 'ERROR') console.error(line);
  else if (level === 'WARN') console.warn(line);
  else console.log(line);
}

export const log = {
  info: (msg: string, fields?: Fields) => emit('INFO', msg, fields),
  warn: (msg: string, fields?: Fields) => emit('WARN', msg, fields),
  error: (msg: string, fields?: Fields) => emit('ERROR', msg, fields),
};
