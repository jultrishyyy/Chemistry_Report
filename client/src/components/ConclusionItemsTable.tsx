import type { ReactNode } from 'react';
import type { FieldDefinition, FieldGroup } from '../../../shared/types';
import { CONCLUSION_COLUMNS } from '../../../shared/conclusion-table-layout';

export default function ConclusionItemsTable({ groups, renderCell, renderActions }: {
  groups: FieldGroup[];
  renderCell: (field: FieldDefinition, group: FieldGroup) => ReactNode;
  renderActions?: (group: FieldGroup) => ReactNode;
}) {
  if (!groups.length) return null;
  return <div className="conclusion-items-table" style={{ overflowX: 'auto', marginBlock: 12 }}>
    <table aria-label="子项目结论" style={{ width: '100%', minWidth: 540, borderCollapse: 'collapse', tableLayout: 'fixed' }}>
      <thead><tr>{CONCLUSION_COLUMNS.map(column => <th key={column.role}>{column.label}</th>)}
        {renderActions && <th style={{ width: 65 }}>操作</th>}</tr></thead>
      <tbody>{groups.map(group => <tr key={group.id}>{CONCLUSION_COLUMNS.map(column => {
        const field = group.fields.find(candidate => candidate.conclusion_role === column.role);
        return <td key={column.role}>{field ? renderCell(field, group) : '—'}</td>;
      })}{renderActions && <td>{renderActions(group)}</td>}</tr>)}</tbody>
    </table>
  </div>;
}
