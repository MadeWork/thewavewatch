export default function SkeletonCard({ className = "" }: { className?: string }) {
  return (
    <div className={`monitor-card animate-pulse ${className}`}>
      <div className="h-3 w-20 bg-bg-subtle rounded mb-4" />
      <div className="h-8 w-24 bg-bg-subtle rounded mb-2" />
      <div className="h-3 w-32 bg-bg-subtle rounded" />
    </div>
  );
}
