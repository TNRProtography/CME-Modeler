interface StatCardProps {
  label: string;
  value: string;
  detail?: string;
}

function StatCard({ label, value, detail }: StatCardProps) {
  return (
    <div className="stat-card">
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
  return (
    <div className="panel">
      <h2>Forecast summary</h2>
      <div className="card-grid">
        {stats.map((stat) => (
          <StatCard key={stat.label} {...stat} />
        ))}
      </div>
    </div>
  );
}
