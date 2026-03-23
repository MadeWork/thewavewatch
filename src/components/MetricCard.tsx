interface MetricCardProps {
  label: string;
  value: number | string;
  subtitle?: string;
}

export default function MetricCard({ label, value, subtitle }: MetricCardProps) {
  return (
    <div className="monitor-card">
      <p className="section-label mb-3">{label}</p>
      <p className="metric-value text-3xl">{value}</p>
      {subtitle && <p className="text-xs text-text-muted mt-1">{subtitle}</p>}
    </div>
  );
}
