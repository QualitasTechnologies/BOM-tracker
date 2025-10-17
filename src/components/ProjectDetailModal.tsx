import { Project } from "@/types/project";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ProgressBar } from "./ProgressBar";
import { format } from "date-fns";

interface ProjectDetailModalProps {
  project: Project | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ProjectDetailModal({
  project,
  open,
  onOpenChange,
}: ProjectDetailModalProps) {
  if (!project) return null;

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const getDelayAttributionColor = (attribution: string) => {
    if (attribution.startsWith("External")) {
      return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300";
    }
    return "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300";
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="text-2xl">{project.name}</DialogTitle>
          <DialogDescription>
            Project Owner: {project.owner} • {project.category} Project
          </DialogDescription>
        </DialogHeader>
        
        <ScrollArea className="h-[calc(90vh-120px)] pr-4">
          <div className="space-y-6">
            {/* Budget Analysis */}
            <Card>
              <CardHeader>
                <CardTitle>Budget Analysis</CardTitle>
                <CardDescription>
                  Time and material cost breakdown with burn rate
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Total Budget</p>
                    <p className="text-2xl font-bold">{formatCurrency(project.budgeted)}</p>
                    <div className="text-xs text-muted-foreground mt-1 space-y-0.5">
                      <div>Time: {formatCurrency(project.budgetedTime)}</div>
                      <div>Material: {formatCurrency(project.budgetedMaterial)}</div>
                    </div>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Spent to Date</p>
                    <p className="text-2xl font-bold">{formatCurrency(project.spent)}</p>
                    <div className="text-xs text-muted-foreground mt-1 space-y-0.5">
                      <div>Time: {formatCurrency(project.spentTime)}</div>
                      <div>Material: {formatCurrency(project.spentMaterial)}</div>
                    </div>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Remaining</p>
                    <p className="text-2xl font-bold text-status-success">
                      {formatCurrency(project.budgeted - project.spent)}
                    </p>
                    <div className="text-xs text-muted-foreground mt-1 space-y-0.5">
                      <div>Time: {formatCurrency(project.budgetedTime - project.spentTime)}</div>
                      <div>Material: {formatCurrency(project.budgetedMaterial - project.spentMaterial)}</div>
                    </div>
                  </div>
                </div>
                
                <Separator />
                
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground mb-2">Time Cost</p>
                    <ProgressBar 
                      percent={(project.spentTime / project.budgetedTime) * 100} 
                      type="timeline"
                      showLabel={true}
                    />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground mb-2">Material Cost</p>
                    <ProgressBar 
                      percent={(project.spentMaterial / project.budgetedMaterial) * 100} 
                      type="budget"
                      showLabel={true}
                    />
                  </div>
                </div>
                
                <div className="bg-muted p-3 rounded-lg">
                  <p className="text-sm">
                    Daily burn rate: <span className="font-bold">{formatCurrency(project.spent / project.daysElapsed)}</span>
                    {" "}• Budget exhausted in{" "}
                    <span className="font-bold">
                      {Math.floor((project.budgeted - project.spent) / (project.spent / project.daysElapsed))} days
                    </span>
                    {" "}(Project has {project.totalDays - project.daysElapsed} days remaining)
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* Weekly Activity */}
            {project.weeklyActivities.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Weekly Activity Log</CardTitle>
                  <CardDescription>
                    Week-by-week progress with running totals and deltas
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {project.weeklyActivities.map((week, index) => {
                      const prevWeek = index > 0 ? project.weeklyActivities[index - 1] : null;
                      const budgetDelta = prevWeek ? week.weekSpent - prevWeek.weekSpent : 0;
                      const timeDelta = prevWeek ? week.weekTimeCost - prevWeek.weekTimeCost : 0;
                      const materialDelta = prevWeek ? week.weekMaterialCost - prevWeek.weekMaterialCost : 0;
                      const daysDelta = prevWeek ? week.weekDaysElapsed - prevWeek.weekDaysElapsed : 0;
                      
                      return (
                        <div key={week.id} className="border rounded-lg p-4 space-y-3">
                          <div className="flex items-start justify-between">
                            <div>
                              <h5 className="font-semibold">Week {week.weekNumber}</h5>
                              <p className="text-sm text-muted-foreground">
                                {format(week.weekStartDate, "MMM d")} - {format(week.weekEndDate, "MMM d, yyyy")}
                              </p>
                            </div>
                            {prevWeek && (
                              <Badge variant="outline" className={
                                budgetDelta > prevWeek.weekSpent * 0.2
                                  ? "bg-status-error-bg text-status-error border-status-error/20"
                                  : budgetDelta > prevWeek.weekSpent * 0.1
                                  ? "bg-status-warning-bg text-status-warning border-status-warning/20"
                                  : "bg-status-success-bg text-status-success border-status-success/20"
                              }>
                                {budgetDelta > 0 ? "+" : ""}{formatCurrency(budgetDelta)} vs prev
                              </Badge>
                            )}
                          </div>
                          
                          <div className="space-y-1">
                            {week.activities.map((activity, i) => (
                              <p key={i} className="text-sm">• {activity}</p>
                            ))}
                          </div>
                          
                          <Separator />
                          
                          <div className="grid grid-cols-2 gap-4 text-sm">
                            <div>
                              <p className="text-muted-foreground mb-1">This Week</p>
                              <div className="space-y-0.5">
                                <div className="flex justify-between">
                                  <span>Total:</span>
                                  <span className="font-semibold">{formatCurrency(week.weekSpent)}</span>
                                </div>
                                <div className="flex justify-between text-xs">
                                  <span>Time:</span>
                                  <span>{formatCurrency(week.weekTimeCost)}</span>
                                </div>
                                <div className="flex justify-between text-xs">
                                  <span>Material:</span>
                                  <span>{formatCurrency(week.weekMaterialCost)}</span>
                                </div>
                                <div className="flex justify-between">
                                  <span>Days:</span>
                                  <span className="font-semibold">{week.weekDaysElapsed}</span>
                                </div>
                              </div>
                            </div>
                            
                            <div>
                              <p className="text-muted-foreground mb-1">Running Total</p>
                              <div className="space-y-0.5">
                                <div className="flex justify-between">
                                  <span>Total:</span>
                                  <span className="font-semibold">{formatCurrency(week.runningBudgetSpent)}</span>
                                </div>
                                <div className="flex justify-between text-xs">
                                  <span>Time:</span>
                                  <span>{formatCurrency(week.runningTimeCost)}</span>
                                </div>
                                <div className="flex justify-between text-xs">
                                  <span>Material:</span>
                                  <span>{formatCurrency(week.runningMaterialCost)}</span>
                                </div>
                                <div className="flex justify-between">
                                  <span>Days:</span>
                                  <span className="font-semibold">{week.runningDaysElapsed}</span>
                                </div>
                              </div>
                            </div>
                          </div>
                          
                          {prevWeek && (
                            <div className="bg-muted p-2 rounded text-xs space-y-1">
                              <p className="font-medium">Week-over-Week Changes:</p>
                              <div className="grid grid-cols-2 gap-2">
                                <div>Budget: <span className={budgetDelta > 0 ? "text-status-error" : "text-status-success"}>{budgetDelta > 0 ? "+" : ""}{formatCurrency(budgetDelta)}</span></div>
                                <div>Time: <span className={timeDelta > 0 ? "text-status-error" : "text-status-success"}>{timeDelta > 0 ? "+" : ""}{formatCurrency(timeDelta)}</span></div>
                                <div>Material: <span className={materialDelta > 0 ? "text-status-error" : "text-status-success"}>{materialDelta > 0 ? "+" : ""}{formatCurrency(materialDelta)}</span></div>
                                <div>Days: <span className={daysDelta !== 0 ? "text-status-warning" : ""}>{daysDelta > 0 ? "+" : ""}{daysDelta}</span></div>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Timeline & Delay History */}
            <Card>
              <CardHeader>
                <CardTitle>Timeline & Delay History</CardTitle>
                <CardDescription>
                  Chronological history of all delays and their attributions
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Original End Date</p>
                    <p className="font-semibold">{format(project.originalTargetEnd, "MMM d, yyyy")}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Current End Date</p>
                    <p className="font-semibold">{format(project.currentTargetEnd, "MMM d, yyyy")}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Total Delay</p>
                    <p className="font-bold text-status-error">{project.cumulativeDelay} days</p>
                  </div>
                </div>

                <Separator />

                {project.delayLogs.length > 0 ? (
                  <div className="space-y-4">
                    <h4 className="font-semibold">Delay Timeline</h4>
                    {project.delayLogs.map((log) => (
                      <div key={log.id} className="border-l-2 border-primary pl-4 py-2 space-y-2">
                        <div className="flex items-start justify-between">
                          <div>
                            <p className="font-semibold">
                              {format(log.date, "MMM d, yyyy")} - {log.milestoneName}
                            </p>
                            <p className="text-sm text-muted-foreground">
                              Delay: <span className="text-status-error font-semibold">+{log.delayDays} days</span>
                            </p>
                          </div>
                          <Badge className={getDelayAttributionColor(log.attribution)}>
                            {log.attribution}
                          </Badge>
                        </div>
                        <p className="text-sm leading-relaxed">{log.reason}</p>
                        <p className="text-xs text-muted-foreground">
                          Logged by: {log.loggedBy} • Cumulative impact: {log.cumulativeDelay} days total delay
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground italic">No delays logged for this project</p>
                )}

                {project.delayLogs.length > 0 && (
                  <>
                    <Separator />
                    <div className="bg-muted p-4 rounded-lg space-y-2">
                      <h4 className="font-semibold text-sm">Delay Summary</h4>
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div>
                          <span className="text-muted-foreground">Client-caused:</span>
                          <span className="ml-2 font-semibold">
                            {project.delayLogs
                              .filter(log => log.attribution === "External-Client")
                              .reduce((sum, log) => sum + log.delayDays, 0)} days
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Internal:</span>
                          <span className="ml-2 font-semibold">
                            {project.delayLogs
                              .filter(log => log.attribution.startsWith("Internal"))
                              .reduce((sum, log) => sum + log.delayDays, 0)} days
                          </span>
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            {/* Milestone Breakdown */}
            {project.milestones.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Milestone Progress</CardTitle>
                  <CardDescription>
                    Status and estimation accuracy for each milestone
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {project.milestones.map((milestone) => {
                      const variance = milestone.actualDays 
                        ? ((milestone.actualDays - milestone.estimatedDays) / milestone.estimatedDays) * 100
                        : null;
                      
                      return (
                        <div key={milestone.id} className="border rounded-lg p-4 space-y-2">
                          <div className="flex items-start justify-between">
                            <div>
                              <h5 className="font-semibold">{milestone.name}</h5>
                              <p className="text-sm text-muted-foreground">
                                {format(milestone.originalPlannedStart, "MMM d")} - {format(milestone.currentPlannedEnd, "MMM d, yyyy")}
                              </p>
                            </div>
                            <Badge
                              variant="outline"
                              className={
                                milestone.status === "completed"
                                  ? "bg-status-success-bg text-status-success"
                                  : milestone.status === "in-progress"
                                  ? "bg-status-info-bg text-status-info"
                                  : "bg-secondary"
                              }
                            >
                              {milestone.status}
                            </Badge>
                          </div>
                          
                          {milestone.status !== "not-started" && (
                            <div className="grid grid-cols-3 gap-2 text-sm">
                              <div>
                                <span className="text-muted-foreground">Estimated:</span>
                                <span className="ml-1 font-semibold">{milestone.estimatedDays}d</span>
                              </div>
                              {milestone.actualDays && (
                                <>
                                  <div>
                                    <span className="text-muted-foreground">Actual:</span>
                                    <span className="ml-1 font-semibold">{milestone.actualDays}d</span>
                                  </div>
                                  <div>
                                    <span className="text-muted-foreground">Variance:</span>
                                    <span className={`ml-1 font-semibold ${
                                      variance && variance > 50 ? "text-status-error" : "text-status-success"
                                    }`}>
                                      {variance ? `${variance > 0 ? "+" : ""}${variance.toFixed(0)}%` : "-"}
                                    </span>
                                  </div>
                                </>
                              )}
                            </div>
                          )}
                          
                          {milestone.status === "in-progress" && (
                            <ProgressBar 
                              percent={milestone.progress} 
                              type="timeline"
                              showLabel={false}
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Red Flags */}
            {project.redFlags.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Active Alerts</CardTitle>
                  <CardDescription>
                    Issues requiring attention
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {project.redFlags.map((flag) => (
                      <div
                        key={flag.id}
                        className={`p-3 rounded-lg border ${
                          flag.severity === "critical"
                            ? "bg-status-error-bg border-status-error/20"
                            : "bg-status-warning-bg border-status-warning/20"
                        }`}
                      >
                        <p className="text-sm font-medium">
                          {flag.severity === "critical" ? "🔴" : "⚠️"} {flag.description}
                        </p>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
