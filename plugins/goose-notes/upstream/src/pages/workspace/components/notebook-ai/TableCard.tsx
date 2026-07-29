/**
 * showTable 工具的输出渲染卡片
 */
interface TableCardProps {
  title?: string;
  columns: string[];
  rows: string[][];
}

export function TableCard({ title, columns, rows }: TableCardProps) {
  return (
    <div className="my-2 overflow-hidden rounded-[8px] bg-[var(--goose-interactive-hover)]">
      {title && (
        <div className="px-3 py-2 text-xs font-medium text-foreground">
          {title}
        </div>
      )}
      <div className="overflow-x-auto bg-background/40">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-[var(--goose-interactive-hover)]">
              {columns.map((col, i) => (
                <th
                  key={i}
                  className="px-3 py-2 text-left font-medium text-muted-foreground"
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr
                key={ri}
                className="transition-colors odd:bg-transparent even:bg-[var(--goose-interactive-hover)]/40 hover:bg-[var(--goose-interactive-hover)]"
              >
                {row.map((cell, ci) => (
                  <td
                    key={ci}
                    className="px-3 py-2 text-foreground"
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
