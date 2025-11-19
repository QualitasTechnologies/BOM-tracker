
import { ChevronDown, ChevronRight, Package, Trash2, Pencil, FileText } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import BOMPartRow from './BOMPartRow';
import BOMPartDetails from './BOMPartDetails';
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
  vendors: Array<{
    name: string;
    price: number;
    leadTime: string;
    availability: string;
    documents?: DocumentInfo[];
  }>;
  status: 'not-ordered' | 'ordered' | 'received' | 'approved';
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
  selectedPart?: BOMItem | null;
  onToggle: () => void;
  onPartClick: (part: BOMItem) => void;
  onQuantityChange?: (itemId: string, newQuantity: number) => void;
  onDeletePart?: (itemId: string) => void;
  onDeleteCategory?: (categoryName: string) => void;
  onEditCategory?: (oldName: string, newName: string) => void;
  onStatusChange?: (itemId: string, newStatus: string) => void;
  onEditPart?: (itemId: string, updates: Partial<BOMItem>) => void;
  onPartCategoryChange?: (itemId: string, newCategory: string) => void;
  availableCategories?: string[];
  onUpdatePart?: (updated: BOMItem) => void;
  onCloseDetails?: () => void;
}

const BOMCategoryCard = ({ category, selectedPart, onToggle, onPartClick, onQuantityChange, onDeletePart, onDeleteCategory, onEditCategory, onStatusChange, onEditPart, onPartCategoryChange, availableCategories = [], onUpdatePart, onCloseDetails }: BOMCategoryCardProps) => {
  const [showConfirm, setShowConfirm] = useState<false | 'warning' | 'confirm'>(false);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(category.name);

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

  return (
    <Card className="relative">
      <Collapsible open={category.isExpanded} onOpenChange={onToggle}>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer hover:bg-gray-50 transition-colors relative py-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {category.isExpanded ? (
                  <ChevronDown className="text-gray-500" size={20} />
                ) : (
                  <ChevronRight className="text-gray-500" size={20} />
                )}
                <Package className="text-blue-500" size={20} />
                <div>
                  <div className="flex items-center gap-1">
                    {editing ? (
                      <input
                        className="text-lg font-semibold text-gray-900 border-b border-blue-400 bg-transparent outline-none px-1 w-40"
                        value={editName}
                        autoFocus
                        onChange={e => setEditName(e.target.value)}
                        onBlur={() => {
                          setEditing(false);
                          if (editName.trim() && editName !== category.name && onEditCategory) {
                            onEditCategory(category.name, editName.trim());
                          } else {
                            setEditName(category.name);
                          }
                        }}
                        onKeyDown={e => {
                          if (e.key === 'Enter') {
                            setEditing(false);
                            if (editName.trim() && editName !== category.name && onEditCategory) {
                              onEditCategory(category.name, editName.trim());
                            } else {
                              setEditName(category.name);
                            }
                          } else if (e.key === 'Escape') {
                            setEditing(false);
                            setEditName(category.name);
                          }
                        }}
                      />
                    ) : (
                      <>
                        <h3 className="text-lg font-semibold text-gray-900">{category.name}</h3>
                        <button className="ml-1 p-1 text-gray-500 hover:text-blue-600 align-middle" aria-label="Edit category name" onClick={e => { e.stopPropagation(); setEditing(true); }}>
                          <Pencil size={16} />
                        </button>
                      </>
                    )}
                  </div>
                  <p className="text-sm text-gray-600">{category.items.length} parts</p>
                </div>
              </div>
              <div className="flex gap-2 items-center">
                <Badge variant="outline" className="text-blue-600 border-blue-200">
                  {getStatusCount('approved')} Approved
                </Badge>
                <Badge variant="outline" className="text-green-600 border-green-200">
                  {getStatusCount('received')} received
                </Badge>
                <Badge variant="outline" className="text-amber-600 border-amber-200">
                  {getStatusCount('ordered')} ordered
                </Badge>
                <Badge variant="outline" className="text-red-600 border-red-200">
                  {getStatusCount('not-ordered')} Not Ordered
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
                <div key={item.id}>
                  <BOMPartRow
                    part={item}
                    onClick={() => onPartClick(item)}
                    onQuantityChange={onQuantityChange}
                    onDelete={onDeletePart}
                    onStatusChange={onStatusChange}
                    onEdit={onEditPart}
                    onCategoryChange={onPartCategoryChange}
                    availableCategories={availableCategories}
                  />
                  {/* Show details inline below the selected part */}
                  {selectedPart?.id === item.id && (
                    <div className="mt-3 ml-4 border-l-4 border-blue-400 pl-4">
                      <BOMPartDetails
                        part={selectedPart}
                        onClose={onCloseDetails || (() => {})}
                        onUpdatePart={onUpdatePart}
                        onDeletePart={onDeletePart}
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
};

export default BOMCategoryCard;
