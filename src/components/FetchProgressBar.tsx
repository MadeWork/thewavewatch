import { useFetch } from "@/hooks/useFetchContext";

export default function FetchProgressBar() {
  const { fetching, progress, stage } = useFetch();

  if (!fetching && progress === 0) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-50">
      {/* Track */}
      <div className="h-1 w-full bg-primary/10">
        <div
          className="h-full bg-primary transition-all duration-500 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>
      {/* Label */}
      {stage && fetching && (
        <div className="flex justify-center">
          <span className="mt-1 px-3 py-0.5 rounded-b-lg bg-primary/15 text-primary text-[10px] font-medium backdrop-blur-sm">
            {stage.label}
          </span>
        </div>
      )}
    </div>
  );
}
