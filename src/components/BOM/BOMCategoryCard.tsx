
import { ChevronDown, ChevronRight, Package, Trash2 } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import BOMPartRow from './BOMPartRow';
import { useState } from 'react';

interface DocumentInfo {
  name: string;
  url: string;
}

interface BOMItem {
  id: string;
  name: string;
  description: string;
  category: string;
  quantity: number;
  price?: number;
  make?: string;
  sku?: string;
  vendors: Array<{
    name: string;
    price: number;
    leadTime: string;
    availability: string;
    documents?: DocumentInfo[];
  }>;
  status: 'not-ordered' | 'ordered' | 'received';
  expectedDelivery?: string;
  poNumber?: string;
}

interface BOMCategory {
  name: string;
  items: BOMItem[];
  isExpanded: boolean;
}

interface BOMCategoryCardProps {
  category: BOMCategory;
  onToggle: () => void;
  onQuantityChange?: (itemId: string, newQuantity: number) => void;
  onDeletePart?: (itemId: string) => void;
  onDeleteCategory?: (categoryName: string) => void;
  onStatusChange?: (itemId: string, newStatus: string) => void;
  onEditPart?: (itemId: string, updates: Partial<BOMItem>) => void;
  onPartCategoryChange?: (itemId: string, newCategory: string) => void;
  availableCategories?: string[];
  onUpdatePart?: (updated: BOMItem) => void;
  getDocumentCount?: (itemId: string) => number;
}

const formatCurrency = (value: number) => {
  return `₹${value.toLocaleString('en-IN')}`;
};

const BOMCategoryCard = ({ category, onToggle, onQuantityChange, onDeletePart, onDeleteCategory, onStatusChange, onEditPart, onPartCategoryChange, availableCategories = [], onUpdatePart, getDocumentCount }: BOMCategoryCardProps) => {
  const [showConfirm, setShowConfirm] = useState<false | 'warning' | 'confirm'>(false);

  const getStatusCount = (status: string) => {
    return category.items.filter(item => item.status === status).length;
  };

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (category.items.length > 0) {
      // Show warning for non-empty category
      setShowConfirm('warning');
    } else {
      // Direct confirmation for empty category
      setShowConfirm('confirm');
    }
  };

  const handleConfirmDelete = () => {
    setShowConfirm(false);
    onDeleteCategory?.(category.name);
  };

  const handleMoveItemsAndDelete = () => {
    // Move all items to "Uncategorized" category first
    if (category.items.length > 0 && onPartCategoryChange) {
      category.items.forEach(item => {
        onPartCategoryChange(item.id, 'Uncategorized');
      });
      // Small delay to allow category change to complete, then delete
      setTimeout(() => {
        onDeleteCategory?.(category.name);
      }, 500);
    } else {
      onDeleteCategory?.(category.name);
    }
    setShowConfirm(false);
  };

  const handleCancelDelete = () => {
    setShowConfirm(false);
  };

  const categoryTotal = category.items.reduce((sum, item) => {
    if (!item.price) return sum;
    return sum + item.price * (item.quantity || 1);
  }, 0);

  return (
    <Card className="relative">
      <Collapsible open={category.isExpanded} onOpenChange={onToggle}>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer hover:bg-gray-50 transition-colors relative py-3">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-3">
                {category.isExpanded ? (
                  <ChevronDown className="text-gray-500" size={20} />
                ) : (
                  <ChevronRight className="text-gray-500" size={20} />
                )}
                <Package className="text-blue-500" size={20} />
                <div className="flex flex-wrap items-center gap-2 text-gray-600">
                  <h3 className="text-lg font-semibold text-gray-900">{category.name}</h3>
                  <span className="text-gray-300">•</span>
                  <span className="text-sm">{category.items.length} parts</span>
                </div>
              </div>
              <div className="flex gap-2 items-center flex-wrap justify-end text-sm">
                <span className="font-semibold text-gray-900 whitespace-nowrap">
                  Total: {formatCurrency(categoryTotal)}
                </span>
                <Badge variant="outline" className="text-red-600 border-red-200">
                  {getStatusCount('not-ordered')} Not Ordered
                </Badge>
                <Badge variant="outline" className="text-amber-600 border-amber-200">
                  {getStatusCount('ordered')} Ordered
                </Badge>
                <Badge variant="outline" className="text-green-600 border-green-200">
                  {getStatusCount('received')} Received
                </Badge>
                {/* Trash icon button */}
                <button
                  onClick={handleDeleteClick}
                  className="ml-2 p-1 bg-transparent border-none outline-none text-red-500 hover:bg-red-50 rounded-full"
                  style={{ appearance: 'none', boxShadow: 'none' }}
                  aria-label="Delete category"
                  tabIndex={-1}
                >
                  <Trash2 size={18} />
                </button>
              </div>
            </div>
            {/* Confirmation popup */}
            {showConfirm === 'confirm' && (
              <div className="absolute right-2 top-10 z-50 mt-2 bg-white border border-gray-300 rounded shadow p-3 text-xs flex flex-col min-w-[200px]">
                <div className="mb-3 font-medium">Delete empty category?</div>
                <div className="flex gap-2 justify-end">
                  <button onClick={handleConfirmDelete} className="px-3 py-1 bg-red-500 text-white rounded text-xs hover:bg-red-600">Delete</button>
                  <button onClick={handleCancelDelete} className="px-3 py-1 bg-gray-200 text-gray-700 rounded text-xs hover:bg-gray-300">Cancel</button>
                </div>
              </div>
            )}
            
            {/* Warning popup for non-empty categories */}
            {showConfirm === 'warning' && (
              <div className="absolute right-2 top-10 z-50 mt-2 bg-white border border-red-300 rounded shadow p-3 text-xs min-w-[250px]">
                <div className="mb-2 font-medium text-red-800">⚠️ Category contains {category.items.length} items</div>
                <div className="mb-3 text-gray-600">Choose an action:</div>
                <div className="flex flex-col gap-2">
                  <button 
                    onClick={handleMoveItemsAndDelete} 
                    className="px-3 py-1 bg-orange-500 text-white rounded text-xs hover:bg-orange-600"
                  >
                    Move items to "Uncategorized" & Delete
                  </button>
                  <button onClick={handleCancelDelete} className="px-3 py-1 bg-gray-200 text-gray-700 rounded text-xs hover:bg-gray-300">Cancel</button>
                </div>
              </div>
            )}
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="pt-0 pb-3">
            <div className="space-y-2">
              {category.items.map((item) => (
                <BOMPartRow
                  key={item.id}
                  part={item}
                  onClick={() => {}}
                  onQuantityChange={onQuantityChange}
                  onDelete={onDeletePart}
                  onStatusChange={onStatusChange}
                  onEdit={onEditPart}
                  onCategoryChange={onPartCategoryChange}
                  availableCategories={availableCategories}
                  linkedDocumentsCount={getDocumentCount ? getDocumentCount(item.id) : 0}
                />
              ))}
            </div>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
};

export default BOMCategoryCard;
