import { useState, useEffect, useMemo } from 'react';
import { Clock, ArrowRight, User, Filter, ChevronDown, ChevronUp, AlertTriangle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { subscribeToDelayLogs, getDelayStats } from '@/utils/delayLogFirestore';
import type { DelayLog, DelayAttribution } from '@/types/milestone';

interface DelayHistoryViewProps {
  projectId: string;
  isBaselined: boolean;
}

const ATTRIBUTION_LABELS: Record<DelayAttribution, string> = {
  'internal-team': 'Internal - Team',
  'internal-process': 'Internal - Process',
  'external-client': 'External - Client',
  'external-vendor': 'External - Vendor',
  'external-other': 'External - Other',
};

const ATTRIBUTION_COLORS: Record<DelayAttribution, string> = {
  'internal-team': 'bg-amber-100 text-amber-800 border-amber-200',
  'internal-process': 'bg-orange-100 text-orange-800 border-orange-200',
  'external-client': 'bg-blue-100 text-blue-800 border-blue-200',
  'external-vendor': 'bg-purple-100 text-purple-800 border-purple-200',
  'external-other': 'bg-gray-100 text-gray-800 border-gray-200',
};

const DelayHistoryView = ({ projectId, isBaselined }: DelayHistoryViewProps) => {
  const [delayLogs, setDelayLogs] = useState<DelayLog[]>([]);
  const [isOpen, setIsOpen] = useState(true);
  const [filterAttribution, setFilterAttribution] = useState<'all' | 'internal' | 'external'>('all');
  const [stats, setStats] = useState<{
    totalDelayDays: number;
    internalDays: number;
    externalDays: number;
    delayCount: number;
  } | null>(null);

  // Subscribe to delay logs
  useEffect(() => {
    const unsubscribe = subscribeToDelayLogs(projectId, (logs) => {
      setDelayLogs(logs);
    });
    return () => unsubscribe();
  }, [projectId]);

  // Load stats
  useEffect(() => {
    const loadStats = async () => {
      const s = await getDelayStats(projectId);
      setStats({
        totalDelayDays: s.totalDelayDays,
        internalDays: s.internalDays,
        externalDays: s.externalDays,
        delayCount: s.delayCount,
      });
    };
    loadStats();
  }, [projectId, delayLogs]);

  // Filter logs
  const filteredLogs = useMemo(() => {
    if (filterAttribution === 'all') return delayLogs;
    return delayLogs.filter(log => {
      if (filterAttribution === 'internal') {
        return log.attribution.startsWith('internal');
      }
      return log.attribution.startsWith('external');
    });
  }, [delayLogs, filterAttribution]);

  // Group logs by date
  const groupedLogs = useMemo(() => {
    const groups: Record<string, DelayLog[]> = {};
    filteredLogs.forEach(log => {
      const dateKey = log.loggedAt.split('T')[0];
      if (!groups[dateKey]) {
        groups[dateKey] = [];
      }
      groups[dateKey].push(log);
    });

    return Object.entries(groups)
      .map(([date, logs]) => ({
        date,
        formattedDate: new Date(date).toLocaleDateString('en-US', {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        }),
        logs,
        totalDays: logs.reduce((sum, l) => sum + l.delayDays, 0),
      }))
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [filteredLogs]);

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
  };

  if (!isBaselined) {
    return null;
  }

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <Card>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer hover:bg-gray-50 transition-colors py-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Clock className="h-5 w-5 text-gray-500" />
                <CardTitle className="text-base">Delay History</CardTitle>
                {stats && stats.delayCount > 0 && (
                  <Badge variant="outline" className="text-red-600 border-red-200">
                    {stats.delayCount} {stats.delayCount === 1 ? 'delay' : 'delays'} • +{stats.totalDelayDays} days
                  </Badge>
                )}
                {stats && stats.delayCount === 0 && (
                  <Badge variant="outline" className="text-green-600 border-green-200">
                    No delays
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-2">
                {stats && stats.delayCount > 0 && (
                  <div className="flex gap-1 text-xs">
                    <span className="text-amber-600">Int: {stats.internalDays}d</span>
                    <span className="text-gray-400">|</span>
                    <span className="text-blue-600">Ext: {stats.externalDays}d</span>
                  </div>
                )}
                {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </div>
            </div>
          </CardHeader>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <CardContent className="pt-0">
            {delayLogs.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <AlertTriangle className="h-8 w-8 mx-auto mb-2 text-gray-300" />
                <p>No delays logged yet</p>
                <p className="text-xs mt-1">Delays are automatically logged when milestone dates change</p>
              </div>
            ) : (
              <>
                {/* Filter buttons */}
                <div className="flex gap-2 mb-4">
                  <Button
                    variant={filterAttribution === 'all' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setFilterAttribution('all')}
                    className="text-xs h-7"
                  >
                    All ({delayLogs.length})
                  </Button>
                  <Button
                    variant={filterAttribution === 'internal' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setFilterAttribution('internal')}
                    className="text-xs h-7"
                  >
                    Internal ({delayLogs.filter(l => l.attribution.startsWith('internal')).length})
                  </Button>
                  <Button
                    variant={filterAttribution === 'external' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setFilterAttribution('external')}
                    className="text-xs h-7"
                  >
                    External ({delayLogs.filter(l => l.attribution.startsWith('external')).length})
                  </Button>
                </div>

                {/* Grouped delay entries */}
                <div className="space-y-4">
                  {groupedLogs.map((group) => (
                    <div key={group.date} className="border-l-2 border-gray-200 pl-4">
                      {/* Date header */}
                      <div className="flex items-center justify-between mb-2">
                        <div className="text-sm font-medium text-gray-700">
                          {group.formattedDate}
                        </div>
                        <div className={`text-xs font-medium ${group.totalDays > 0 ? 'text-red-600' : 'text-green-600'}`}>
                          {group.totalDays > 0 ? `+${group.totalDays}` : group.totalDays} days
                        </div>
                      </div>

                      {/* Log entries for this date */}
                      <div className="space-y-3">
                        {group.logs.map((log) => (
                          <div
                            key={log.id}
                            className="bg-gray-50 rounded-lg p-3 text-sm"
                          >
                            {/* Header row */}
                            <div className="flex items-start justify-between gap-2 mb-2">
                              <div className="font-medium text-gray-900">
                                {log.entityName}
                              </div>
                              <Badge
                                variant="outline"
                                className={`text-[10px] ${ATTRIBUTION_COLORS[log.attribution]}`}
                              >
                                {ATTRIBUTION_LABELS[log.attribution]}
                              </Badge>
                            </div>

                            {/* Date change */}
                            <div className="flex items-center gap-2 text-gray-600 mb-2">
                              <span className="text-gray-400 line-through">{formatDate(log.previousDate)}</span>
                              <ArrowRight className="h-3 w-3 text-red-400" />
                              <span className="text-red-600 font-medium">{formatDate(log.newDate)}</span>
                              <span className={`font-medium ${log.delayDays > 0 ? 'text-red-600' : 'text-green-600'}`}>
                                ({log.delayDays > 0 ? `+${log.delayDays}` : log.delayDays} days)
                              </span>
                            </div>

                            {/* Reason */}
                            <div className="text-gray-600 italic border-l-2 border-gray-300 pl-2">
                              "{log.reason}"
                            </div>

                            {/* Footer */}
                            <div className="flex items-center gap-2 mt-2 text-xs text-gray-400">
                              <User className="h-3 w-3" />
                              <span>{log.loggedByName || 'Unknown'}</span>
                              <span>•</span>
                              <span>
                                {new Date(log.loggedAt).toLocaleTimeString('en-US', {
                                  hour: 'numeric',
                                  minute: '2-digit',
                                })}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>

                {filteredLogs.length === 0 && delayLogs.length > 0 && (
                  <div className="text-center py-4 text-gray-500 text-sm">
                    No {filterAttribution} delays found
                  </div>
                )}
              </>
            )}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
};

export default DelayHistoryView;
