import { useState, useEffect, useMemo } from 'react';
import {
  Clock,
  FileText,
  ChevronDown,
  ChevronUp,
  Filter,
  Download,
  Loader2,
  Calendar,
  User,
  AlertCircle,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { subscribeToProjectActivities } from '@/utils/transcriptFirestore';
import { generateStatusUpdate } from '@/utils/transcriptService';
import type { TranscriptActivity, ActivityType } from '@/types/transcript';
import {
  ACTIVITY_TYPE_LABELS,
  ACTIVITY_TYPE_COLORS,
  ACTIVITY_TYPE_ICONS,
  formatMeetingDate,
  groupActivitiesByDate,
} from '@/types/transcript';

interface ProjectActivityTimelineProps {
  projectId: string;
  projectName: string;
}

const ProjectActivityTimeline = ({
  projectId,
  projectName,
}: ProjectActivityTimelineProps) => {
  const [activities, setActivities] = useState<TranscriptActivity[]>([]);
  const [isOpen, setIsOpen] = useState(true);
  const [filterType, setFilterType] = useState<ActivityType | 'all'>('all');

  // Status update dialog state
  const [statusDialogOpen, setStatusDialogOpen] = useState(false);
  const [startDate, setStartDate] = useState(() => {
    const date = new Date();
    date.setDate(date.getDate() - 7);
    return date.toISOString().split('T')[0];
  });
  const [endDate, setEndDate] = useState(() => {
    return new Date().toISOString().split('T')[0];
  });
  const [generatedUpdate, setGeneratedUpdate] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  // Subscribe to activities
  useEffect(() => {
    const unsubscribe = subscribeToProjectActivities(projectId, (data) => {
      setActivities(data);
    });

    return () => unsubscribe();
  }, [projectId]);

  // Filter activities
  const filteredActivities = useMemo(() => {
    if (filterType === 'all') return activities;
    return activities.filter((a) => a.type === filterType);
  }, [activities, filterType]);

  // Group by date
  const groupedActivities = useMemo(() => {
    const grouped = groupActivitiesByDate(filteredActivities);
    return Array.from(grouped.entries()).map(([date, items]) => ({
      date,
      formattedDate: formatMeetingDate(date),
      activities: items,
    }));
  }, [filteredActivities]);

  // Count by type
  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = { all: activities.length };
    activities.forEach((a) => {
      counts[a.type] = (counts[a.type] || 0) + 1;
    });
    return counts;
  }, [activities]);

  // Get activities for status update (within date range)
  const getActivitiesForStatusUpdate = () => {
    return activities.filter((a) => {
      return a.meetingDate >= startDate && a.meetingDate <= endDate;
    });
  };

  const handleGenerateStatusUpdate = async () => {
    setIsGenerating(true);
    setGenerateError(null);

    try {
      const relevantActivities = getActivitiesForStatusUpdate();

      if (relevantActivities.length === 0) {
        setGenerateError('No activities found in the selected date range');
        setIsGenerating(false);
        return;
      }

      const result = await generateStatusUpdate({
        projectName,
        activities: relevantActivities.map((a) => ({
          type: a.type,
          summary: a.summary,
        })),
        dateRange: { start: startDate, end: endDate },
      });

      setGeneratedUpdate(result.statusUpdate);
    } catch (err: any) {
      setGenerateError(err.message || 'Failed to generate status update');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCopyToClipboard = () => {
    navigator.clipboard.writeText(generatedUpdate);
  };

  if (activities.length === 0) {
    return null; // Don't show if no activities
  }

  return (
    <>
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <Card>
          <CollapsibleTrigger asChild>
            <CardHeader className="cursor-pointer hover:bg-gray-50 transition-colors py-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Clock className="h-5 w-5 text-gray-500" />
                  <CardTitle className="text-base">Activity Timeline</CardTitle>
                  <Badge variant="outline">
                    {activities.length} {activities.length === 1 ? 'activity' : 'activities'}
                  </Badge>
                </div>
                <div className="flex items-center gap-2">
                  {isOpen ? (
                    <ChevronUp className="h-4 w-4" />
                  ) : (
                    <ChevronDown className="h-4 w-4" />
                  )}
                </div>
              </div>
            </CardHeader>
          </CollapsibleTrigger>

          <CollapsibleContent>
            <CardContent className="pt-0">
              {/* Filter buttons and actions */}
              <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                <div className="flex flex-wrap gap-1">
                  <Button
                    variant={filterType === 'all' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setFilterType('all')}
                    className="text-xs h-7"
                  >
                    All ({typeCounts.all || 0})
                  </Button>
                  {(['progress', 'blocker', 'decision', 'action', 'note'] as ActivityType[]).map(
                    (type) =>
                      (typeCounts[type] || 0) > 0 && (
                        <Button
                          key={type}
                          variant={filterType === type ? 'default' : 'outline'}
                          size="sm"
                          onClick={() => setFilterType(type)}
                          className="text-xs h-7"
                        >
                          {ACTIVITY_TYPE_ICONS[type]} {ACTIVITY_TYPE_LABELS[type]} (
                          {typeCounts[type]})
                        </Button>
                      )
                  )}
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setStatusDialogOpen(true)}
                  className="gap-1"
                >
                  <FileText className="h-4 w-4" />
                  Generate Status Update
                </Button>
              </div>

              {/* Grouped activities */}
              <div className="space-y-4">
                {groupedActivities.map((group) => (
                  <div key={group.date} className="border-l-2 border-gray-200 pl-4">
                    {/* Date header */}
                    <div className="flex items-center gap-2 mb-2">
                      <Calendar className="h-4 w-4 text-gray-400" />
                      <span className="text-sm font-medium text-gray-700">
                        {group.formattedDate}
                      </span>
                      <span className="text-xs text-gray-400">
                        ({group.activities.length}{' '}
                        {group.activities.length === 1 ? 'item' : 'items'})
                      </span>
                    </div>

                    {/* Activities for this date */}
                    <div className="space-y-2">
                      {group.activities.map((activity) => (
                        <div
                          key={activity.id}
                          className="bg-gray-50 rounded-lg p-3 text-sm"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-1">
                                <Badge
                                  variant="outline"
                                  className={`text-[10px] ${ACTIVITY_TYPE_COLORS[activity.type]}`}
                                >
                                  {ACTIVITY_TYPE_ICONS[activity.type]}{' '}
                                  {ACTIVITY_TYPE_LABELS[activity.type]}
                                </Badge>
                                {activity.speaker && (
                                  <span className="text-xs text-gray-500 flex items-center gap-1">
                                    <User className="h-3 w-3" />
                                    {activity.speaker}
                                  </span>
                                )}
                              </div>
                              <p className="text-gray-900">{activity.summary}</p>
                            </div>
                            {activity.timestamp && (
                              <span className="text-xs text-gray-400">
                                {activity.timestamp}
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}

                {filteredActivities.length === 0 && (
                  <div className="text-center py-4 text-gray-500 text-sm">
                    No {filterType === 'all' ? '' : filterType} activities found
                  </div>
                )}
              </div>
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      {/* Generate Status Update Dialog */}
      <Dialog open={statusDialogOpen} onOpenChange={setStatusDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Generate Status Update</DialogTitle>
            <DialogDescription>
              Select a date range to generate a client-ready status update for{' '}
              {projectName}.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Date range */}
            <div className="flex gap-4">
              <div className="flex-1 space-y-2">
                <Label htmlFor="startDate">From</Label>
                <Input
                  id="startDate"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>
              <div className="flex-1 space-y-2">
                <Label htmlFor="endDate">To</Label>
                <Input
                  id="endDate"
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </div>
            </div>

            <div className="text-sm text-muted-foreground">
              {getActivitiesForStatusUpdate().length} activities in selected range
            </div>

            {generateError && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{generateError}</AlertDescription>
              </Alert>
            )}

            {/* Generated update */}
            {generatedUpdate && (
              <div className="space-y-2">
                <Label>Generated Status Update</Label>
                <Textarea
                  value={generatedUpdate}
                  onChange={(e) => setGeneratedUpdate(e.target.value)}
                  className="min-h-[200px]"
                />
                <p className="text-xs text-muted-foreground">
                  You can edit the text above before copying.
                </p>
              </div>
            )}
          </div>

          <DialogFooter>
            {!generatedUpdate ? (
              <>
                <Button
                  variant="outline"
                  onClick={() => setStatusDialogOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleGenerateStatusUpdate}
                  disabled={isGenerating || getActivitiesForStatusUpdate().length === 0}
                >
                  {isGenerating ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    'Generate'
                  )}
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="outline"
                  onClick={() => {
                    setGeneratedUpdate('');
                    setGenerateError(null);
                  }}
                >
                  Regenerate
                </Button>
                <Button onClick={handleCopyToClipboard}>
                  <Download className="mr-2 h-4 w-4" />
                  Copy to Clipboard
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default ProjectActivityTimeline;
