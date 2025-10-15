import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

interface StatusBadgeProps {
  status: "critical" | "warning" | "on-track" | "Customer" | "Internal";
  variant?: "default" | "small";
}

export function StatusBadge({ status, variant = "default" }: StatusBadgeProps) {
  const getStyles = () => {
    switch (status) {
      case "critical":
        return "bg-status-error-bg text-status-error border-status-error/20";
      case "warning":
        return "bg-status-warning-bg text-status-warning border-status-warning/20";
      case "on-track":
        return "bg-status-success-bg text-status-success border-status-success/20";
      case "Customer":
        return "bg-status-info-bg text-status-info border-status-info/20";
      case "Internal":
        return "bg-secondary text-secondary-foreground border-border";
      default:
        return "";
    }
  };

  const getLabel = () => {
    switch (status) {
      case "critical":
        return "🔴 Critical";
      case "warning":
        return "⚠️ Warning";
      case "on-track":
        return "✓ On Track";
      default:
        return status;
    }
  };

  return (
    <Badge
      variant="outline"
      className={cn(
        getStyles(),
        variant === "small" ? "text-xs px-2 py-0" : "px-3 py-1"
      )}
    >
      {getLabel()}
    </Badge>
  );
}
