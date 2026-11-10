export default function PriceSummary({ rows = [], total, totalLabel = 'الإجمالي', note, children }) {
  return (
    <div className="summary-rows">
      {rows.map((row) => (
        <div key={row.label}>
          <span>{row.label}</span>
          <b>{row.value}</b>
        </div>
      ))}
      <div className="summary-total">
        <span>{totalLabel}</span>
        <b>{total}</b>
      </div>
      {note || null}
      {children || null}
    </div>
  );
}
