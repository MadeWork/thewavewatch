import { Inbox } from "lucide-react";

export default function EmptyState({ message = "No data yet" }: { message?: string }) {
  return (
    <div className="monitor-card flex flex-col items-center justify-center py-12 text-text-muted">
      <Inbox className="w-10 h-10 mb-3 opacity-40" />
      <p className="text-sm">{message}</p>
    </div>
  );
}
