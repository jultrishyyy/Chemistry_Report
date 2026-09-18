/** 保存返回期间的新输入优先，包括嵌套表格里的修改和删除。只合并不同于发送快照的部分。 */
export function rebaseRecordSave(sent: any, current: any, saved: any): any {
  if (JSON.stringify(sent) === JSON.stringify(current)) return saved;
  const object = (value: any) => value != null && typeof value === 'object' && !Array.isArray(value);
  if (!object(sent) || !object(current) || !object(saved)) return current;
  const next = { ...saved };
  for (const key of new Set([...Object.keys(sent), ...Object.keys(current)])) {
    if (JSON.stringify(sent[key]) === JSON.stringify(current[key])) continue;
    if (!Object.prototype.hasOwnProperty.call(current, key)) delete next[key];
    else next[key] = rebaseRecordSave(sent[key], current[key], saved[key]);
  }
  return next;
}
