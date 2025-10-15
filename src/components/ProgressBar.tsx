import { cn } from "@/lib/utils";

interface ProgressBarProps {
  percent: number;
  type: "budget" | "timeline";
  showLabel?: boolean;
  className?: string;
}

export function ProgressBar({ 
  percent, 
  type, 
  showLabel = true,
  className 
}: ProgressBarProps) {
  const getColor = () => {
    if (type === "budget") {
      if (percent > 100) return "bg-status-error";
      if (percent >= 91) return "bg-status-error";
      if (percent >= 76) return "bg-status-warning";
      return "bg-status-success";
    } else {
      // Timeline coloring is more complex, simplified here
      if (percent >= 91) return "bg-status-error";
      if (percent >= 76) return "bg-status-warning";
      return "bg-status-success";
    }
  };

  const getBgColor = () => {
    if (type === "budget") {
      if (percent > 100) return "bg-status-error-bg";
      if (percent >= 91) return "bg-status-error-bg";
      if (percent >= 76) return "bg-status-warning-bg";
      return "bg-status-success-bg";
    } else {
      if (percent >= 91) return "bg-status-error-bg";
      if (percent >= 76) return "bg-status-warning-bg";
      return "bg-status-success-bg";
    }
  };

  return (
    <div className={cn("space-y-1", className)}>
      <div className={cn("h-2 rounded-full overflow-hidden", getBgColor())}>
        <div
          className={cn("h-full transition-all duration-300", getColor())}
          style={{ width: `${Math.min(percent, 100)}%` }}
        />
      </div>
      {showLabel && (
        <p className="text-xs text-muted-foreground">
          {percent.toFixed(0)}% consumed
        </p>
      )}
    </div>
  );
}
