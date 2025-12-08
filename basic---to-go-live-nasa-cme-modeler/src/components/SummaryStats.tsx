interface StatCardProps {
  label: string;
  value: string;
  detail?: string;
}

function StatCard({ label, value, detail }: StatCardProps) {
  return (
    <div className="stat-card ribbon">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {detail && <div className="helper" style={{ marginTop: 4 }}>{detail}</div>}
    </div>
  );
}

interface SummaryStatsProps {
  stats: StatCardProps[];
}

export function SummaryStats({ stats }: SummaryStatsProps) {
  const [primary, ...rest] = stats;

  return (
    <div className="stat-stack">
      {primary && (
        <div className="stat-primary">
          <div className="stack-heading">Arrival window</div>
          <StatCard {...primary} />
        </div>
      )}
      <div className="stack-grid">
        {rest.map((stat) => (
          <StatCard key={stat.label} {...stat} />
        ))}
      </div>
    </div>
  );
}
