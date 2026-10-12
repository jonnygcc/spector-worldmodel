type Severity = "high" | "medium" | "low";

interface ReportCardProps {
  title: string;
  description: string;
  severity: Severity;
  step: string;
}

const severityStyles: Record<Severity, { label: string; color: string; bg: string }> = {
  high: { label: "High", color: "text-red-400", bg: "bg-red-400/10" },
  medium: { label: "Medium", color: "text-yellow-400", bg: "bg-yellow-400/10" },
  low: { label: "Low", color: "text-green-400", bg: "bg-green-400/10" },
};

export default function ReportCard({ title, description, severity, step }: ReportCardProps) {
  const style = severityStyles[severity];

  return (
    <div className="rounded-lg border border-dark-border bg-dark-card p-6">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-gray-text">{step}</span>
        <span className={`text-xs font-medium px-2 py-1 rounded ${style.color} ${style.bg}`}>
          {style.label}
        </span>
      </div>
      <h3 className="font-heading text-lg font-semibold mb-2">{title}</h3>
      <p className="text-sm text-gray-text leading-relaxed">{description}</p>
    </div>
  );
}