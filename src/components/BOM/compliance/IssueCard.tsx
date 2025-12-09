import React, { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  AlertCircle,
  AlertTriangle,
  Info,
  ChevronDown,
  ChevronRight,
  FileX,
  Tag,
  Hash,
  Package
} from 'lucide-react';
import { ComplianceIssue, ComplianceIssueType, ComplianceSeverity, getIssueTypeLabel } from '@/types/compliance';

interface IssueCardProps {
  issue: ComplianceIssue;
  onApplyFix?: (issue: ComplianceIssue) => Promise<void>;
  onNavigateToItem?: (itemId: string) => void;
  isApplying?: boolean;
}

// Single issue card (kept for backwards compatibility but simplified)
export function IssueCard({
  issue,
  onApplyFix,
  onNavigateToItem,
  isApplying = false
}: IssueCardProps) {
  const getSeverityIcon = () => {
    switch (issue.severity) {
      case 'error':
        return <AlertCircle className="h-4 w-4 text-red-500" />;
      case 'warning':
        return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
      case 'info':
        return <Info className="h-4 w-4 text-blue-500" />;
      default:
        return <Info className="h-4 w-4 text-gray-500" />;
    }
  };

  return (
    <div className="flex items-center gap-2 py-1.5 px-2 hover:bg-muted/50 rounded text-sm">
      {getSeverityIcon()}
      <span
        className="font-medium cursor-pointer hover:underline truncate flex-1"
        onClick={() => onNavigateToItem?.(issue.bomItemId)}
      >
        {issue.bomItemName}
      </span>
      {issue.category && (
        <Badge variant="outline" className="text-xs">{issue.category}</Badge>
      )}
    </div>
  );
}

// Props for grouped issues view
interface GroupedIssuesCardProps {
  issueType: ComplianceIssueType;
  severity: ComplianceSeverity;
  issues: ComplianceIssue[];
  onNavigateToItem?: (itemId: string) => void;
}

// Grouped issues card - shows one issue type with all affected items
export function GroupedIssuesCard({
  issueType,
  severity,
  issues,
  onNavigateToItem
}: GroupedIssuesCardProps) {
  const [isExpanded, setIsExpanded] = useState(issues.length <= 5);

  const getSeverityIcon = () => {
    switch (severity) {
      case 'error':
        return <AlertCircle className="h-4 w-4 text-red-500" />;
      case 'warning':
        return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
      case 'info':
        return <Info className="h-4 w-4 text-blue-500" />;
      default:
        return <Info className="h-4 w-4 text-gray-500" />;
    }
  };

  const getSeverityBadgeClass = () => {
    switch (severity) {
      case 'error':
        return 'bg-red-100 text-red-700 border-red-200';
      case 'warning':
        return 'bg-yellow-100 text-yellow-700 border-yellow-200';
      case 'info':
        return 'bg-blue-100 text-blue-700 border-blue-200';
      default:
        return 'bg-gray-100 text-gray-700 border-gray-200';
    }
  };

  const getTypeIcon = () => {
    switch (issueType) {
      case 'missing-quote':
        return <FileX className="h-4 w-4" />;
      case 'missing-field':
        return <AlertCircle className="h-4 w-4" />;
      case 'invalid-sku':
        return <Hash className="h-4 w-4" />;
      default:
        return <Package className="h-4 w-4" />;
    }
  };

  // Use the actual message from the first issue - it's already specific
  const getMessage = () => {
    // The backend provides specific messages like "Manufacturer/Make is required"
    return issues[0]?.message || getIssueTypeLabel(issueType);
  };

  const getDescription = () => {
    // Use the details from the first issue
    return issues[0]?.details || '';
  };

  // Group items by category for better organization
  const itemsByCategory = issues.reduce((acc, issue) => {
    const cat = issue.category || 'Uncategorized';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(issue);
    return acc;
  }, {} as Record<string, ComplianceIssue[]>);

  const categories = Object.keys(itemsByCategory).sort();

  return (
    <Card className="mb-3">
      <CardContent className="p-3">
        {/* Header row */}
        <div
          className="flex items-center gap-2 cursor-pointer"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          {getSeverityIcon()}
          <span className="font-medium flex-1">{getMessage()}</span>
          <Badge variant="outline" className={`text-xs ${getSeverityBadgeClass()}`}>
            {severity}
          </Badge>
          <Badge variant="secondary" className="text-xs">
            {getIssueTypeLabel(issueType)}
          </Badge>
          <Badge className="bg-gray-100 text-gray-700 hover:bg-gray-100">
            {issues.length} item{issues.length !== 1 ? 's' : ''}
          </Badge>
          {isExpanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
        </div>

        {/* Description */}
        <p className="text-xs text-muted-foreground mt-1 ml-6">
          {getDescription()}
        </p>

        {/* Expanded items list */}
        {isExpanded && (
          <div className="mt-3 ml-6 border-l-2 border-muted pl-3">
            {categories.map(category => (
              <div key={category} className="mb-2">
                {categories.length > 1 && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
                    <Tag className="h-3 w-3" />
                    {category}
                  </div>
                )}
                <div className="flex flex-wrap gap-1">
                  {itemsByCategory[category].map(issue => (
                    <Badge
                      key={issue.id}
                      variant="outline"
                      className="text-xs cursor-pointer hover:bg-muted"
                      onClick={(e) => {
                        e.stopPropagation();
                        onNavigateToItem?.(issue.bomItemId);
                      }}
                    >
                      {issue.bomItemName}
                    </Badge>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Helper to group issues by type, severity, and message
export function groupIssues(issues: ComplianceIssue[]): {
  key: string;
  issueType: ComplianceIssueType;
  severity: ComplianceSeverity;
  issues: ComplianceIssue[];
}[] {
  const grouped = new Map<string, ComplianceIssue[]>();

  issues.forEach(issue => {
    // Group by type, severity, AND message to keep specific issues separate
    // e.g., "Missing Make" and "Missing SKU" should be separate groups
    const key = `${issue.issueType}-${issue.severity}-${issue.message}`;

    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key)!.push(issue);
  });

  return Array.from(grouped.entries())
    .map(([key, issues]) => ({
      key,
      issueType: issues[0].issueType,
      severity: issues[0].severity,
      issues
    }))
    .sort((a, b) => {
      // Sort by severity (error > warning > info), then by count
      const severityOrder = { error: 0, warning: 1, info: 2 };
      const sevDiff = severityOrder[a.severity] - severityOrder[b.severity];
      if (sevDiff !== 0) return sevDiff;
      return b.issues.length - a.issues.length;
    });
}

export default IssueCard;
