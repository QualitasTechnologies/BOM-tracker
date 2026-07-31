import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { CoverageType, SupportPriority, SupportTicketStatus } from '@/types/support';
import {
  COVERAGE_LABELS,
  SUPPORT_PRIORITY_LABELS,
  SUPPORT_STATUS_LABELS,
} from '@/utils/supportLogic';

const statusClasses: Record<SupportTicketStatus, string> = {
  open: 'border-blue-200 bg-blue-50 text-blue-700',
  waiting: 'border-amber-200 bg-amber-50 text-amber-700',
  'in-progress': 'border-indigo-200 bg-indigo-50 text-indigo-700',
  resolved: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  closed: 'border-slate-200 bg-slate-100 text-slate-700',
  cancelled: 'border-slate-200 bg-slate-50 text-slate-500',
};

const priorityClasses: Record<SupportPriority, string> = {
  critical: 'border-red-200 bg-red-50 text-red-700',
  high: 'border-orange-200 bg-orange-50 text-orange-700',
  medium: 'border-blue-200 bg-blue-50 text-blue-700',
  low: 'border-slate-200 bg-slate-50 text-slate-600',
};

const coverageClasses: Record<CoverageType, string> = {
  warranty: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  amc: 'border-teal-200 bg-teal-50 text-teal-700',
  chargeable: 'border-amber-200 bg-amber-50 text-amber-700',
  goodwill: 'border-purple-200 bg-purple-50 text-purple-700',
  undetermined: 'border-slate-200 bg-slate-50 text-slate-600',
};

export function StatusBadge({
  status,
  className,
}: {
  status: SupportTicketStatus;
  className?: string;
}) {
  return (
    <Badge variant="outline" className={cn(statusClasses[status], className)}>
      {SUPPORT_STATUS_LABELS[status]}
    </Badge>
  );
}

export function PriorityBadge({ priority }: { priority: SupportPriority }) {
  return (
    <Badge variant="outline" className={priorityClasses[priority]}>
      {SUPPORT_PRIORITY_LABELS[priority]}
    </Badge>
  );
}

export function CoverageBadge({ coverage }: { coverage: CoverageType }) {
  return (
    <Badge variant="outline" className={coverageClasses[coverage]}>
      {COVERAGE_LABELS[coverage]}
    </Badge>
  );
}

