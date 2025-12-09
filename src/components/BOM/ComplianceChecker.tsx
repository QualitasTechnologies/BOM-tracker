import React, { useState, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Info,
  Loader2,
  Search,
  Filter,
  RefreshCw,
  FileCheck,
  Clock,
  BarChart3
} from 'lucide-react';
import { BOMCategory, BOMItem } from '@/types/bom';
import { ProjectDocument } from '@/types/projectDocument';
import { ComplianceReport, ComplianceIssue, getIssueTypeLabel } from '@/types/compliance';
import { GroupedIssuesCard, groupIssues } from './compliance/IssueCard';
import {
  runComplianceCheck,
  calculateComplianceScore,
  getComplianceScoreColor,
  filterIssues,
  formatProcessingTime
} from '@/utils/complianceService';
import { useToast } from '@/hooks/use-toast';

interface ComplianceCheckerProps {
  projectId: string;
  categories: BOMCategory[];
  vendorQuotes: ProjectDocument[];
  existingMakes?: string[];
  existingCategories?: string[];
  onFixApplied: (itemId: string, updates: Partial<BOMItem>) => Promise<void>;
  onNavigateToItem?: (itemId: string) => void;
}

export function ComplianceChecker({
  projectId,
  categories,
  vendorQuotes,
  existingMakes = [],
  existingCategories = [],
  onFixApplied,
  onNavigateToItem
}: ComplianceCheckerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [report, setReport] = useState<ComplianceReport | null>(null);
  const [applyingFixId, setApplyingFixId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [severityFilter, setSeverityFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const { toast } = useToast();

  // Run compliance check
  const handleRunCheck = async () => {
    setIsChecking(true);
    setReport(null);

    try {
      const response = await runComplianceCheck(
        projectId,
        categories,
        vendorQuotes,
        { existingMakes, existingCategories }
      );

      if (response.success && response.report) {
        setReport(response.report);
        toast({
          title: 'Compliance Check Complete',
          description: `Found ${response.report.totalIssues} issues in ${response.report.totalItemsChecked} items.`
        });
      } else {
        throw new Error('Invalid response from compliance check');
      }
    } catch (error) {
      console.error('Compliance check error:', error);
      toast({
        variant: 'destructive',
        title: 'Compliance Check Failed',
        description: error instanceof Error ? error.message : 'An error occurred'
      });
    } finally {
      setIsChecking(false);
    }
  };

  // Apply a fix to an item
  const handleApplyFix = async (issue: ComplianceIssue) => {
    if (!issue.suggestedFix || !issue.suggestedFix.field) return;

    setApplyingFixId(issue.id);

    try {
      await onFixApplied(issue.bomItemId, {
        [issue.suggestedFix.field]: issue.suggestedFix.suggestedValue
      });

      // Remove the fixed issue from the report
      if (report) {
        const updatedIssues = report.issues.filter(i => i.id !== issue.id);
        setReport({
          ...report,
          issues: updatedIssues,
          totalIssues: updatedIssues.length,
          itemsWithIssues: new Set(updatedIssues.map(i => i.bomItemId)).size
        });
      }

      toast({
        title: 'Fix Applied',
        description: `Updated ${issue.suggestedFix.field} for ${issue.bomItemName}`
      });
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Failed to Apply Fix',
        description: error instanceof Error ? error.message : 'An error occurred'
      });
    } finally {
      setApplyingFixId(null);
    }
  };

  // Filter issues based on current filters
  const filteredIssues = useMemo(() => {
    if (!report) return [];

    return filterIssues(report.issues, {
      types: typeFilter !== 'all' ? [typeFilter] : undefined,
      severities: severityFilter !== 'all' ? [severityFilter] : undefined,
      searchQuery: searchQuery || undefined
    });
  }, [report, searchQuery, severityFilter, typeFilter]);

  // Get unique issue types for filter
  const issueTypes = useMemo(() => {
    if (!report) return [];
    const types = new Set(report.issues.map(i => i.issueType));
    return Array.from(types);
  }, [report]);

  // Calculate compliance score
  const complianceScore = report ? calculateComplianceScore(report) : 0;
  const scoreColor = getComplianceScoreColor(complianceScore);

  // Get total items count
  const totalItems = categories.reduce((sum, cat) => sum + cat.items.length, 0);

  return (
    <>
      {/* Trigger Button */}
      <Button
        variant="outline"
        onClick={() => setIsOpen(true)}
        className="gap-2"
      >
        <FileCheck className="h-4 w-4" />
        Compliance Check
      </Button>

      {/* Dialog */}
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader className="flex-shrink-0">
            <DialogTitle className="flex items-center gap-2">
              <FileCheck className="h-5 w-5" />
              AI Compliance Checker
            </DialogTitle>
            <DialogDescription>
              Validate BOM data quality, check SKU formats, and match vendor quotes.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 overflow-y-auto flex-1 pr-2">
            {/* Summary Cards */}
            <div className="grid grid-cols-4 gap-4">
              {/* Items Checked */}
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">Items</p>
                      <p className="text-2xl font-bold">
                        {report ? report.totalItemsChecked : totalItems}
                      </p>
                    </div>
                    <BarChart3 className="h-8 w-8 text-muted-foreground" />
                  </div>
                </CardContent>
              </Card>

              {/* Issues Found */}
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">Issues</p>
                      <p className="text-2xl font-bold">
                        {report ? report.totalIssues : '-'}
                      </p>
                    </div>
                    <AlertTriangle className="h-8 w-8 text-yellow-500" />
                  </div>
                </CardContent>
              </Card>

              {/* Compliance Score */}
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">Score</p>
                      <p className={`text-2xl font-bold ${scoreColor}`}>
                        {report ? `${complianceScore}%` : '-'}
                      </p>
                    </div>
                    <CheckCircle2 className={`h-8 w-8 ${report ? scoreColor : 'text-muted-foreground'}`} />
                  </div>
                </CardContent>
              </Card>

              {/* Processing Time */}
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">Time</p>
                      <p className="text-2xl font-bold">
                        {report?.processingTimeMs ? formatProcessingTime(report.processingTimeMs) : '-'}
                      </p>
                    </div>
                    <Clock className="h-8 w-8 text-muted-foreground" />
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Issue Breakdown */}
            {report && report.totalIssues > 0 && (
              <div className="flex items-center gap-4 flex-wrap">
                <span className="text-sm text-muted-foreground">By severity:</span>
                <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">
                  <AlertCircle className="h-3 w-3 mr-1" />
                  {report.issuesBySeverity.error || 0} Errors
                </Badge>
                <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-200">
                  <AlertTriangle className="h-3 w-3 mr-1" />
                  {report.issuesBySeverity.warning || 0} Warnings
                </Badge>
                <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
                  <Info className="h-3 w-3 mr-1" />
                  {report.issuesBySeverity.info || 0} Info
                </Badge>
              </div>
            )}

            {/* Run Check Button */}
            <div className="flex items-center gap-4">
              <Button
                onClick={handleRunCheck}
                disabled={isChecking || totalItems === 0}
                className="gap-2"
              >
                {isChecking ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Analyzing...
                  </>
                ) : (
                  <>
                    <RefreshCw className="h-4 w-4" />
                    {report ? 'Re-run Check' : 'Run Compliance Check'}
                  </>
                )}
              </Button>
              {totalItems === 0 && (
                <span className="text-sm text-muted-foreground">
                  Add items to the BOM to run compliance check
                </span>
              )}
            </div>

            {/* Results */}
            {report && (
              <Tabs defaultValue="all" className="w-full">
                <div className="flex items-center justify-between mb-4">
                  <TabsList>
                    <TabsTrigger value="all">
                      All Issues ({report.totalIssues})
                    </TabsTrigger>
                    <TabsTrigger value="errors">
                      Errors ({report.issuesBySeverity.error || 0})
                    </TabsTrigger>
                    <TabsTrigger value="warnings">
                      Warnings ({report.issuesBySeverity.warning || 0})
                    </TabsTrigger>
                    <TabsTrigger value="info">
                      Info ({report.issuesBySeverity.info || 0})
                    </TabsTrigger>
                  </TabsList>

                  {/* Filters */}
                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                      <Input
                        placeholder="Search issues..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-8 w-48"
                      />
                    </div>
                    <Select value={typeFilter} onValueChange={setTypeFilter}>
                      <SelectTrigger className="w-40">
                        <Filter className="h-4 w-4 mr-2" />
                        <SelectValue placeholder="Type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Types</SelectItem>
                        {issueTypes.map(type => (
                          <SelectItem key={type} value={type}>
                            {getIssueTypeLabel(type)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <TabsContent value="all" className="mt-0">
                  <IssuesList
                    issues={filteredIssues}
                    onNavigateToItem={onNavigateToItem}
                  />
                </TabsContent>

                <TabsContent value="errors" className="mt-0">
                  <IssuesList
                    issues={filteredIssues.filter(i => i.severity === 'error')}
                    onNavigateToItem={onNavigateToItem}
                  />
                </TabsContent>

                <TabsContent value="warnings" className="mt-0">
                  <IssuesList
                    issues={filteredIssues.filter(i => i.severity === 'warning')}
                    onNavigateToItem={onNavigateToItem}
                  />
                </TabsContent>

                <TabsContent value="info" className="mt-0">
                  <IssuesList
                    issues={filteredIssues.filter(i => i.severity === 'info')}
                    onNavigateToItem={onNavigateToItem}
                  />
                </TabsContent>
              </Tabs>
            )}

            {/* No issues state */}
            {report && report.totalIssues === 0 && (
              <Card className="border-green-200 bg-green-50">
                <CardContent className="p-6 text-center">
                  <CheckCircle2 className="h-12 w-12 text-green-500 mx-auto mb-4" />
                  <h3 className="text-lg font-semibold text-green-700">All Clear!</h3>
                  <p className="text-sm text-green-600">
                    No compliance issues found in your BOM.
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// Issues list component - now uses grouped view
function IssuesList({
  issues,
  onNavigateToItem
}: {
  issues: ComplianceIssue[];
  onNavigateToItem?: (itemId: string) => void;
}) {
  if (issues.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        No issues match your filters
      </div>
    );
  }

  const groupedIssues = groupIssues(issues);

  return (
    <ScrollArea className="h-[350px] pr-4">
      {groupedIssues.map(group => (
        <GroupedIssuesCard
          key={group.key}
          issueType={group.issueType}
          severity={group.severity}
          issues={group.issues}
          onNavigateToItem={onNavigateToItem}
        />
      ))}
    </ScrollArea>
  );
}

export default ComplianceChecker;
