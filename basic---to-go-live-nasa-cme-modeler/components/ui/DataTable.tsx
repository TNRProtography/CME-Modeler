import React from 'react';
import { useTheme } from '../../theme';

export interface Column<T> {
  key: keyof T;
  label: string;
  render?: (row: T) => React.ReactNode;
}

interface DataTableProps<T> {
  data: T[];
  columns: Column<T>[];
  caption?: string;
}

function DataTable<T extends Record<string, any>>({ data, columns, caption }: DataTableProps<T>) {
  const { theme } = useTheme();
  return (
    <table
      style={{
        width: '100%',
        borderCollapse: 'collapse',
        fontFamily: theme.typography.fontFamily,
        color: theme.colors.text
      }}
    >
      {caption && <caption style={{ textAlign: 'left', marginBottom: theme.spacing.sm }}>{caption}</caption>}
      <thead>
        <tr>
          {columns.map((col) => (
            <th
              key={String(col.key)}
              style={{
                textAlign: 'left',
                padding: theme.spacing.sm,
                borderBottom: `1px solid ${theme.colors.border}`,
                background: theme.colors.surfaceMuted,
                position: 'sticky',
                top: 0,
                zIndex: theme.zIndex.base
              }}
              scope="col"
            >
              {col.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {data.map((row, idx) => (
          <tr key={idx}>
            {columns.map((col) => (
              <td
                key={String(col.key)}
                style={{ padding: theme.spacing.sm, borderBottom: `1px solid ${theme.colors.border}` }}
              >
                {col.render ? col.render(row) : String(row[col.key])}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default DataTable;
