import { useMemo } from 'react';
import { MoreVertical, Edit2, Trash2, CheckCircle, PlayCircle, AlertCircle, PauseCircle, Check, ArrowRight } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { Milestone, MilestoneStatus } from '@/types/milestone';
import type { Project } from '@/utils/projectFirestore';

interface MilestoneTableViewProps {
  milestones: Milestone[];
  project: Project | null;
  isBaselined: boolean;
  onEdit?: (milestone: Milestone) => void;
  onStatusChange?: (milestoneId: string, status: MilestoneStatus) => void;
  onDelete?: (milestoneId: string) => void;
}

const MilestoneTableView = ({
  milestones,
  project,
  isBaselined,
  onEdit,
  onStatusChange,
  onDelete,
}: MilestoneTableViewProps) => {
  // Sort milestones chronologically by target date, then calculate slip
  const milestonesWithSlip = useMemo(() => {
    // First sort by currentPlannedEndDate
    const sorted = [...milestones].sort((a, b) => {
      const dateA = a.currentPlannedEndDate ? new Date(a.currentPlannedEndDate).getTime() : 0;
      const dateB = b.currentPlannedEndDate ? new Date(b.currentPlannedEndDate).getTime() : 0;
      return dateA - dateB;
    });

    // Then calculate slip and cascade risk
    let maxSlipSoFar = 0;
    return sorted.map((m) => {
      let slip = 0;
      if (m.originalPlannedEndDate && m.currentPlannedEndDate) {
        const original = new Date(m.originalPlannedEndDate);
        const current = new Date(m.currentPlannedEndDate);
        slip = Math.round((current.getTime() - original.getTime()) / (1000 * 60 * 60 * 24));
      }
      // Track cascade risk: if previous milestones slipped, downstream are at risk
      const cascadeRisk = slip === 0 && maxSlipSoFar > 0 ? maxSlipSoFar : 0;
      maxSlipSoFar = Math.max(maxSlipSoFar, slip);
      return { ...m, slip, cascadeRisk };
    });
  }, [milestones]);

  // Calculate totals
  const stats = useMemo(() => {
    const totalSlip = milestonesWithSlip.reduce((max, m) => Math.max(max, m.slip), 0);

    // Get baseline end from last milestone or project original deadline
    const lastMilestone = milestonesWithSlip[milestonesWithSlip.length - 1];
    const baselineEnd = project?.originalDeadline || lastMilestone?.originalPlannedEndDate;

    // Calculate projected end = baseline + total slip (FIX: was showing same as baseline)
    let projectedEnd = baselineEnd;
    if (baselineEnd && totalSlip > 0) {
      const baseDate = new Date(baselineEnd);
      baseDate.setDate(baseDate.getDate() + totalSlip);
      projectedEnd = baseDate.toISOString().split('T')[0];
    }

    return {
      totalSlip,
      baselineEnd,
      projectedEnd,
    };
  }, [milestonesWithSlip, project]);

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
  };

  const formatFullDate = (dateStr?: string) => {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return '🟢';
      case 'in-progress':
        return '🟡';
      case 'blocked':
        return '🔴';
      default:
        return '⚪';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'completed':
        return 'Done';
      case 'in-progress':
        return 'In Progress';
      case 'blocked':
        return 'Blocked';
      default:
        return 'Not Started';
    }
  };

  // Updated slip display: checkmark for on-track, cascade risk in gray
  const getSlipDisplay = (slip: number, cascadeRisk: number) => {
    if (slip > 0) return <span className="text-red-600 font-medium">+{slip}</span>;
    if (slip < 0) return <span className="text-green-600 font-medium">{slip}</span>;
    // slip === 0
    if (cascadeRisk > 0) {
      // Downstream milestone at risk from upstream delay
      return <span className="text-gray-400" title={`At risk: upstream slipped +${cascadeRisk} days`}>(+{cascadeRisk})</span>;
    }
    return <span className="text-green-500"><Check className="h-4 w-4 inline" /></span>;
  };

  return (
    <Card>
      <CardContent className="p-0">
        {/* Table Header */}
        <div className="grid grid-cols-12 gap-2 px-4 py-3 bg-gray-50 border-b text-xs font-medium text-gray-500 uppercase tracking-wide">
          <div className="col-span-1">#</div>
          <div className="col-span-3">Milestone</div>
          <div className="col-span-4 text-center">Target Date</div>
          <div className="col-span-1 text-center">Slip</div>
          <div className="col-span-2">Status</div>
          <div className="col-span-1"></div>
        </div>

        {/* Milestone Rows */}
        <div className="divide-y">
          {milestonesWithSlip.map((milestone, index) => {
            const hasDateChange = isBaselined && milestone.originalPlannedEndDate !== milestone.currentPlannedEndDate;
            return (
            <div
              key={milestone.id}
              className={`grid grid-cols-12 gap-2 px-4 py-3 items-center hover:bg-gray-50 ${
                milestone.status === 'blocked' ? 'bg-red-50/50' :
                milestone.status === 'in-progress' ? 'bg-blue-50/50 border-l-4 border-l-blue-500' : ''
              }`}
            >
              <div className="col-span-1 text-gray-400 font-medium">{index + 1}</div>
              <div className="col-span-3">
                <div className="font-medium text-gray-900 truncate">{milestone.name}</div>
                {milestone.description && (
                  <div className="text-xs text-gray-500 truncate">{milestone.description}</div>
                )}
              </div>
              {/* Combined Baseline → Current column with arrow when dates differ */}
              <div className="col-span-4 text-center text-sm">
                {isBaselined ? (
                  hasDateChange ? (
                    <span className="inline-flex items-center gap-1">
                      <span className="text-gray-400 line-through">{formatDate(milestone.originalPlannedEndDate)}</span>
                      <ArrowRight className="h-3 w-3 text-red-400" />
                      <span className="text-red-600 font-medium">{formatDate(milestone.currentPlannedEndDate)}</span>
                    </span>
                  ) : (
                    <span className="text-gray-600">{formatDate(milestone.currentPlannedEndDate)}</span>
                  )
                ) : (
                  <span className="text-gray-600">{formatDate(milestone.currentPlannedEndDate)}</span>
                )}
              </div>
              <div className="col-span-1 text-center text-sm">
                {isBaselined ? getSlipDisplay(milestone.slip, milestone.cascadeRisk) : '—'}
              </div>
              <div className="col-span-2 flex items-center gap-2">
                <span>{getStatusIcon(milestone.status)}</span>
                <span className="text-sm text-gray-700">{getStatusLabel(milestone.status)}</span>
              </div>
              <div className="col-span-1 flex justify-end">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8">
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {milestone.status !== 'in-progress' && onStatusChange && (
                      <DropdownMenuItem onClick={() => onStatusChange(milestone.id, 'in-progress')}>
                        <PlayCircle className="h-4 w-4 mr-2 text-blue-600" />
                        Mark In Progress
                      </DropdownMenuItem>
                    )}
                    {milestone.status !== 'completed' && onStatusChange && (
                      <DropdownMenuItem onClick={() => onStatusChange(milestone.id, 'completed')}>
                        <CheckCircle className="h-4 w-4 mr-2 text-green-600" />
                        Mark Completed
                      </DropdownMenuItem>
                    )}
                    {milestone.status !== 'blocked' && onStatusChange && (
                      <DropdownMenuItem onClick={() => onStatusChange(milestone.id, 'blocked')}>
                        <AlertCircle className="h-4 w-4 mr-2 text-red-600" />
                        Mark Blocked
                      </DropdownMenuItem>
                    )}
                    {milestone.status !== 'not-started' && onStatusChange && (
                      <DropdownMenuItem onClick={() => onStatusChange(milestone.id, 'not-started')}>
                        <PauseCircle className="h-4 w-4 mr-2 text-gray-400" />
                        Mark Not Started
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                    {onEdit && (
                      <DropdownMenuItem onClick={() => onEdit(milestone)}>
                        <Edit2 className="h-4 w-4 mr-2" />
                        Edit
                      </DropdownMenuItem>
                    )}
                    {onDelete && (
                      <DropdownMenuItem onClick={() => onDelete(milestone.id)} className="text-red-600">
                        <Trash2 className="h-4 w-4 mr-2" />
                        Delete
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
            );
          })}
        </div>

        {/* Summary Footer */}
        {isBaselined && (
          <div className="border-t-2 border-gray-200 bg-gray-50 px-4 py-4 space-y-3">
            {/* Total Slip Header */}
            <div className="flex justify-between items-start">
              <div>
                <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">Total Slip</div>
                <div className="text-sm mt-1">
                  <span className="text-gray-500">BASELINE END:</span>
                  <span className="ml-2 font-medium">{formatFullDate(stats.baselineEnd)}</span>
                </div>
              </div>
              <div className="text-right">
                <div className={`text-3xl font-bold ${stats.totalSlip > 0 ? 'text-red-500' : stats.totalSlip < 0 ? 'text-green-500' : 'text-gray-500'}`}>
                  {stats.totalSlip > 0 ? `+${stats.totalSlip}` : stats.totalSlip} days
                </div>
                <div className="text-sm mt-1">
                  <span className="text-gray-500">PROJECTED END:</span>
                  <span className={`ml-2 font-medium ${stats.totalSlip > 0 ? 'text-red-500' : ''}`}>
                    {formatFullDate(stats.projectedEnd)}
                  </span>
                </div>
              </div>
            </div>

            {/* Milestone Timeline Bar - Date-based with tick marks */}
            {milestonesWithSlip.length > 0 && stats.baselineEnd && (
              <div className="space-y-1 mt-2">
                <div className="text-xs text-gray-400 font-medium">Timeline</div>
                {(() => {
                  // Calculate timeline range using earliest milestone and latest end date
                  const earliestMilestoneDate = milestonesWithSlip.reduce((min, m) => {
                    if (!m.currentPlannedEndDate) return min;
                    const mDate = new Date(m.currentPlannedEndDate);
                    return mDate < min ? mDate : min;
                  }, new Date(milestonesWithSlip[0]?.currentPlannedEndDate || Date.now()));

                  const today = new Date();
                  // Start from the earlier of: earliest milestone or today
                  const startDate = earliestMilestoneDate < today ? earliestMilestoneDate : today;

                  const endDate = stats.projectedEnd
                    ? new Date(stats.projectedEnd)
                    : new Date(stats.baselineEnd!);

                  const totalMs = endDate.getTime() - startDate.getTime();
                  const totalDays = totalMs / (1000 * 60 * 60 * 24);

                  // Generate tick marks - weekly if < 60 days, monthly otherwise
                  const useWeekly = totalDays < 60;
                  const ticks: { date: Date; label: string; position: number }[] = [];

                  // Start from the beginning of the next week/month after start
                  const tickStart = new Date(startDate);
                  if (useWeekly) {
                    // Move to next Monday
                    tickStart.setDate(tickStart.getDate() + (7 - tickStart.getDay()) % 7);
                  } else {
                    // Move to first of next month
                    tickStart.setMonth(tickStart.getMonth() + 1, 1);
                  }

                  let tickDate = new Date(tickStart);
                  while (tickDate < endDate) {
                    const position = ((tickDate.getTime() - startDate.getTime()) / totalMs) * 100;
                    if (position > 0 && position < 100) {
                      ticks.push({
                        date: new Date(tickDate),
                        label: useWeekly
                          ? `${tickDate.getDate()}`
                          : tickDate.toLocaleDateString('en-US', { month: 'short' }),
                        position,
                      });
                    }
                    if (useWeekly) {
                      tickDate.setDate(tickDate.getDate() + 7);
                    } else {
                      tickDate.setMonth(tickDate.getMonth() + 1);
                    }
                  }

                  // Calculate TODAY position
                  const todayPosition = Math.max(0, Math.min(100,
                    ((today.getTime() - startDate.getTime()) / totalMs) * 100
                  ));

                  // Calculate milestone positions based on dates
                  const milestonePositions = milestonesWithSlip.map(m => {
                    if (!m.currentPlannedEndDate) return 50;
                    const mDate = new Date(m.currentPlannedEndDate);
                    return Math.max(5, Math.min(95,
                      ((mDate.getTime() - startDate.getTime()) / totalMs) * 100
                    ));
                  });

                  return (
                    <>
                      {/* Timeline container with axis */}
                      <div className="relative pt-6 pb-8">
                        {/* Date axis line */}
                        <div className="relative h-3 bg-gray-200 rounded-full">
                          {/* Tick marks */}
                          {ticks.map((tick, i) => (
                            <div
                              key={i}
                              className="absolute top-0 h-full flex flex-col items-center"
                              style={{ left: `${tick.position}%` }}
                            >
                              <div className="w-px h-3 bg-gray-400" />
                            </div>
                          ))}

                          {/* TODAY marker */}
                          <div
                            className="absolute flex flex-col items-center z-20"
                            style={{ left: `${todayPosition}%`, top: '-24px', bottom: '-32px' }}
                          >
                            <div className="bg-orange-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap shadow">
                              TODAY
                            </div>
                            <div className="w-0.5 flex-1 bg-orange-500" />
                            <div className="w-0 h-0 border-l-[5px] border-l-transparent border-r-[5px] border-r-transparent border-t-[6px] border-t-orange-500" />
                          </div>

                          {/* Milestone markers */}
                          {milestonesWithSlip.map((m, index) => {
                            const statusColor = m.status === 'completed' ? 'bg-green-500'
                              : m.status === 'in-progress' ? 'bg-blue-500'
                              : m.status === 'blocked' ? 'bg-red-500'
                              : 'bg-gray-400';
                            const statusRing = m.status === 'in-progress' ? 'ring-2 ring-blue-300 ring-offset-1' : '';
                            return (
                              <div
                                key={m.id}
                                className="absolute top-1/2 -translate-y-1/2"
                                style={{ left: `${milestonePositions[index]}%`, transform: 'translateX(-50%) translateY(-50%)' }}
                              >
                                <div className={`w-5 h-5 rounded-full ${statusColor} ${statusRing} border-2 border-white shadow`} />
                              </div>
                            );
                          })}
                        </div>

                        {/* Tick labels below axis */}
                        <div className="relative h-4 mt-1">
                          {/* Start date */}
                          <div className="absolute left-0 text-[10px] text-gray-500 font-medium">
                            {formatDate(startDate.toISOString().split('T')[0])}
                          </div>
                          {/* Tick labels */}
                          {ticks.map((tick, i) => (
                            <div
                              key={i}
                              className="absolute text-[10px] text-gray-400 -translate-x-1/2"
                              style={{ left: `${tick.position}%` }}
                            >
                              {tick.label}
                            </div>
                          ))}
                          {/* End date */}
                          <div className="absolute right-0 text-[10px] text-red-500 font-medium">
                            {formatDate(stats.projectedEnd)}
                          </div>
                        </div>

                        {/* Milestone labels */}
                        <div className="relative h-5 mt-1">
                          {milestonesWithSlip.map((m, index) => (
                            <div
                              key={m.id}
                              className="absolute text-[10px] text-gray-600 whitespace-nowrap"
                              style={{
                                left: `${milestonePositions[index]}%`,
                                transform: 'translateX(-50%)',
                              }}
                            >
                              <div className="truncate max-w-[80px] text-center" title={m.name}>
                                {m.name.length > 12 ? m.name.slice(0, 10) + '...' : m.name}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </>
                  );
                })()}
              </div>
            )}
          </div>
        )}

        {/* Not Baselined Message */}
        {!isBaselined && milestones.length > 0 && (
          <div className="border-t bg-amber-50 px-4 py-3 text-sm text-amber-700">
            Lock baseline to track slip and delays
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default MilestoneTableView;
