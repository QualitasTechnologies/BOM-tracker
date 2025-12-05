import { useMemo, useState } from 'react';
import { Package, Clock, AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, FileText, ExternalLink } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { BOMItem, BOMCategory, getInwardStatus, InwardStatus } from '@/types/bom';
import { ProjectDocument } from '@/types/projectDocument';

interface InwardTrackingProps {
  categories: BOMCategory[];
  documents: ProjectDocument[];
  onItemClick?: (item: BOMItem) => void;
  fullPage?: boolean; // When true, renders without collapsible wrapper for tab view
}

// Helper to format dates
const formatDate = (dateStr: string | undefined): string => {
  if (!dateStr) return '-';
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};

// Helper to calculate days difference
const getDaysFromToday = (dateStr: string | undefined): number | null => {
  if (!dateStr) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr);
  target.setHours(0, 0, 0, 0);
  return Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
};

// Status badge component for table
const StatusBadge = ({ status, days }: { status: InwardStatus; days: number | null }) => {
  const config: Record<InwardStatus, { icon: React.ReactNode; className: string; label: string }> = {
    'overdue': {
      icon: <AlertTriangle size={12} />,
      className: 'bg-red-100 text-red-700 border-red-200',
      label: days !== null ? `${Math.abs(days)}d late` : 'Late'
    },
    'arriving-soon': {
      icon: <Clock size={12} />,
      className: 'bg-amber-100 text-amber-700 border-amber-200',
      label: days !== null ? `${days}d` : 'Soon'
    },
    'on-track': {
      icon: <Package size={12} />,
      className: 'bg-gray-100 text-gray-700 border-gray-200',
      label: days !== null ? `${days}d` : 'On track'
    },
    'received': {
      icon: <CheckCircle2 size={12} />,
      className: 'bg-green-100 text-green-700 border-green-200',
      label: 'Received'
    },
    'not-ordered': {
      icon: null,
      className: 'bg-gray-100 text-gray-500',
      label: 'Not ordered'
    }
  };

  const c = config[status];
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${c.className}`}>
      {c.icon}
      {c.label}
    </span>
  );
};

const InwardTracking = ({ categories, documents, onItemClick, fullPage = false }: InwardTrackingProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [filterStatus, setFilterStatus] = useState<string>('all');

  // Get all component items (not services)
  const allItems = useMemo(() => {
    const items: BOMItem[] = [];
    categories.forEach(cat => {
      cat.items.forEach(item => {
        if (item.itemType !== 'service') {
          items.push(item);
        }
      });
    });
    return items;
  }, [categories]);

  // Calculate summary stats
  const stats = useMemo(() => {
    let ordered = 0;
    let arrivingSoon = 0;
    let overdue = 0;
    let received = 0;
    let notOrdered = 0;

    allItems.forEach(item => {
      const status = getInwardStatus(item);
      switch (status) {
        case 'overdue':
          overdue++;
          ordered++; // Also count as ordered
          break;
        case 'arriving-soon':
          arrivingSoon++;
          ordered++; // Also count as ordered
          break;
        case 'on-track':
          ordered++;
          break;
        case 'received':
          received++;
          break;
        case 'not-ordered':
          notOrdered++;
          break;
      }
    });

    return { ordered, arrivingSoon, overdue, received, notOrdered, total: allItems.length };
  }, [allItems]);

  // Filter items for table
  const filteredItems = useMemo(() => {
    // Only show items that have been ordered (status is ordered or received)
    let items = allItems.filter(item =>
      item.status === 'ordered' || item.status === 'received'
    );

    if (filterStatus !== 'all') {
      items = items.filter(item => {
        const status = getInwardStatus(item);
        return status === filterStatus;
      });
    }

    // Sort by expected arrival (overdue first, then by date)
    return items.sort((a, b) => {
      const statusA = getInwardStatus(a);
      const statusB = getInwardStatus(b);

      // Overdue items first
      if (statusA === 'overdue' && statusB !== 'overdue') return -1;
      if (statusB === 'overdue' && statusA !== 'overdue') return 1;

      // Then by expected arrival date
      if (a.expectedArrival && b.expectedArrival) {
        return new Date(a.expectedArrival).getTime() - new Date(b.expectedArrival).getTime();
      }
      if (a.expectedArrival) return -1;
      if (b.expectedArrival) return 1;
      return 0;
    });
  }, [allItems, filterStatus]);

  // Get linked document for an item
  const getLinkedDocument = (item: BOMItem): ProjectDocument | undefined => {
    if (!item.linkedPODocumentId) return undefined;
    return documents.find(d => d.id === item.linkedPODocumentId);
  };

  // If no ordered items, show empty state in full page mode
  if (stats.ordered + stats.received === 0) {
    if (fullPage) {
      return (
        <div className="flex flex-col items-center justify-center py-12 text-gray-500">
          <Package className="h-12 w-12 mb-4 text-gray-300" />
          <p className="text-lg font-medium">No items ordered yet</p>
          <p className="text-sm">Items will appear here once they're marked as ordered</p>
        </div>
      );
    }
    return null;
  }

  // Shared content (summary cards, filter, table)
  const TrackingContent = () => (
    <>
      {/* Summary Cards */}
      <div className={`grid grid-cols-4 gap-${fullPage ? '4' : '2'} mb-${fullPage ? '6' : '3'}`}>
        <div className={`bg-gray-50 rounded p-${fullPage ? '4' : '2'} text-center`}>
          <div className={`${fullPage ? 'text-2xl' : 'text-lg'} font-semibold text-gray-900`}>{stats.ordered}</div>
          <div className={`${fullPage ? 'text-sm' : 'text-xs'} text-gray-500`}>Ordered</div>
        </div>
        <div className={`bg-amber-50 rounded p-${fullPage ? '4' : '2'} text-center`}>
          <div className={`${fullPage ? 'text-2xl' : 'text-lg'} font-semibold text-amber-700`}>{stats.arrivingSoon}</div>
          <div className={`${fullPage ? 'text-sm' : 'text-xs'} text-amber-600`}>Soon (7d)</div>
        </div>
        <div className={`bg-red-50 rounded p-${fullPage ? '4' : '2'} text-center`}>
          <div className={`${fullPage ? 'text-2xl' : 'text-lg'} font-semibold text-red-700`}>{stats.overdue}</div>
          <div className={`${fullPage ? 'text-sm' : 'text-xs'} text-red-600`}>Overdue</div>
        </div>
        <div className={`bg-green-50 rounded p-${fullPage ? '4' : '2'} text-center`}>
          <div className={`${fullPage ? 'text-2xl' : 'text-lg'} font-semibold text-green-700`}>{stats.received}</div>
          <div className={`${fullPage ? 'text-sm' : 'text-xs'} text-green-600`}>Received</div>
        </div>
      </div>

      {/* Filter */}
      <div className={`flex items-center gap-2 mb-${fullPage ? '4' : '2'}`}>
        <span className={`${fullPage ? 'text-sm' : 'text-xs'} text-gray-500`}>Filter:</span>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className={`${fullPage ? 'h-9 w-40' : 'h-7 w-32'} text-xs`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="overdue">Overdue</SelectItem>
            <SelectItem value="arriving-soon">Arriving Soon</SelectItem>
            <SelectItem value="on-track">On Track</SelectItem>
            <SelectItem value="received">Received</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      {filteredItems.length > 0 ? (
        <div className="border rounded overflow-hidden">
          <table className={`w-full ${fullPage ? 'text-sm' : 'text-xs'}`}>
            <thead className="bg-gray-50">
              <tr>
                <th className={`text-left p-${fullPage ? '3' : '2'} font-medium text-gray-600`}>Item</th>
                <th className={`text-left p-${fullPage ? '3' : '2'} font-medium text-gray-600 hidden sm:table-cell`}>Vendor</th>
                <th className={`text-left p-${fullPage ? '3' : '2'} font-medium text-gray-600`}>PO #</th>
                <th className={`text-left p-${fullPage ? '3' : '2'} font-medium text-gray-600 hidden md:table-cell`}>Ordered</th>
                <th className={`text-left p-${fullPage ? '3' : '2'} font-medium text-gray-600`}>Expected</th>
                <th className={`text-left p-${fullPage ? '3' : '2'} font-medium text-gray-600`}>Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredItems.map((item) => {
                const status = getInwardStatus(item);
                const days = getDaysFromToday(item.expectedArrival);
                const linkedDoc = getLinkedDocument(item);

                return (
                  <tr
                    key={item.id}
                    className="hover:bg-gray-50 cursor-pointer"
                    onClick={() => onItemClick?.(item)}
                  >
                    <td className={`p-${fullPage ? '3' : '2'}`}>
                      <div className={`font-medium text-gray-900 truncate ${fullPage ? 'max-w-[250px]' : 'max-w-[150px]'}`}>
                        {item.name}
                      </div>
                      {linkedDoc && (
                        <a
                          href={linkedDoc.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 text-blue-600 hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <FileText size={fullPage ? 12 : 10} />
                          <span className={`truncate ${fullPage ? 'max-w-[150px]' : 'max-w-[100px]'}`}>{linkedDoc.name}</span>
                        </a>
                      )}
                    </td>
                    <td className={`p-${fullPage ? '3' : '2'} text-gray-600 hidden sm:table-cell`}>
                      {item.finalizedVendor?.name || item.vendors?.[0]?.name || '-'}
                    </td>
                    <td className={`p-${fullPage ? '3' : '2'} text-gray-600`}>
                      {item.poNumber || '-'}
                    </td>
                    <td className={`p-${fullPage ? '3' : '2'} text-gray-600 hidden md:table-cell`}>
                      {formatDate(item.orderDate)}
                    </td>
                    <td className={`p-${fullPage ? '3' : '2'} text-gray-600`}>
                      {formatDate(item.expectedArrival)}
                      {item.actualArrival && status === 'received' && (
                        <div className="text-green-600">
                          Rcvd: {formatDate(item.actualArrival)}
                        </div>
                      )}
                    </td>
                    <td className={`p-${fullPage ? '3' : '2'}`}>
                      <StatusBadge status={status} days={days} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className={`text-center py-${fullPage ? '8' : '4'} text-${fullPage ? 'base' : 'sm'} text-gray-500`}>
          No items match the selected filter
        </div>
      )}
    </>
  );

  // Full page mode - render content directly
  if (fullPage) {
    return (
      <div className="space-y-4">
        <TrackingContent />
      </div>
    );
  }

  // Collapsible mode (default)
  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <Card className="border-gray-200">
        <CollapsibleTrigger asChild>
          <div className="flex items-center justify-between p-3 cursor-pointer hover:bg-gray-50">
            <div className="flex items-center gap-3">
              <Package className="h-4 w-4 text-gray-600" />
              <span className="font-medium text-sm">Inward Tracking</span>
              {/* Summary badges */}
              <div className="flex items-center gap-2">
                {stats.overdue > 0 && (
                  <span className="flex items-center gap-1 px-1.5 py-0.5 bg-red-100 text-red-700 rounded text-xs font-medium">
                    <AlertTriangle size={10} />
                    {stats.overdue}
                  </span>
                )}
                {stats.arrivingSoon > 0 && (
                  <span className="flex items-center gap-1 px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded text-xs font-medium">
                    <Clock size={10} />
                    {stats.arrivingSoon}
                  </span>
                )}
                {stats.received > 0 && (
                  <span className="flex items-center gap-1 px-1.5 py-0.5 bg-green-100 text-green-700 rounded text-xs font-medium">
                    <CheckCircle2 size={10} />
                    {stats.received}
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">
                {stats.ordered} ordered, {stats.received} received
              </span>
              {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </div>
          </div>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <CardContent className="pt-0 pb-3 px-3">
            <TrackingContent />
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
};

export default InwardTracking;
