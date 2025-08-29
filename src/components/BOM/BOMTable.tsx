import { ChevronDown, ChevronRight, MoreHorizontal, Trash2, Edit3 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { BOMCategory, BOMItem, BOMStatus } from '@/types/bom';
import QuantityControl from './QuantityControl';

interface BOMTableProps {
  categories: BOMCategory[];
  onToggle: (categoryName: string) => void;
  onPartClick: (part: BOMItem) => void;
  onQuantityChange: (itemId: string, newQuantity: number) => void;
  onDeletePart: (itemId: string) => void;
  onDeleteCategory: (categoryName: string) => void;
  onEditCategory: (oldName: string, newName: string) => void;
  onStatusChange: (itemId: string, newStatus: BOMStatus) => void;
  onEditPart: (itemId: string, updates: Partial<BOMItem>) => void;
  onPartCategoryChange: (itemId: string, newCategory: string) => void;
  availableCategories: string[];
  selectedPart: BOMItem | null;
}

const BOMTable = ({
  categories,
  onToggle,
  onPartClick,
  onQuantityChange,
  onDeletePart,
  onDeleteCategory,
  onEditCategory,
  onStatusChange,
  onEditPart,
  onPartCategoryChange,
  availableCategories,
  selectedPart
}: BOMTableProps) => {
  const getStatusColor = (status: BOMStatus) => {
    switch (status) {
      case 'received': return 'bg-green-100 text-green-800 border-green-200';
      case 'ordered': return 'bg-amber-100 text-amber-800 border-amber-200';
      case 'approved': return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'not-ordered': return 'bg-red-100 text-red-800 border-red-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const getStatusText = (status: BOMStatus) => {
    switch (status) {
      case 'received': return 'Received';
      case 'ordered': return 'Ordered';
      case 'approved': return 'Approved';
      case 'not-ordered': return 'Not Ordered';
      default: return status;
    }
  };

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden bg-white">
      {/* Table Header */}
      <div className="bg-gray-50 border-b border-gray-200">
        <div className="grid grid-cols-12 gap-4 px-4 py-3 text-sm font-medium text-gray-700">
          <div className="col-span-4">Part Name</div>
          <div className="col-span-2">Category</div>
          <div className="col-span-2">Quantity</div>
          <div className="col-span-2">Status</div>
          <div className="col-span-2">Actions</div>
        </div>
      </div>

      {/* Table Body */}
      <div className="divide-y divide-gray-200">
        {categories.map((category) => (
          <div key={category.name} className="bg-white">
            {/* Category Header Row */}
            <div 
              className="grid grid-cols-12 gap-4 px-4 py-2 bg-gray-50 hover:bg-gray-100 cursor-pointer border-b border-gray-200"
              onClick={() => onToggle(category.name)}
            >
              <div className="col-span-4 flex items-center gap-2">
                {category.isExpanded ? (
                  <ChevronDown className="h-4 w-4 text-gray-500" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-gray-500" />
                )}
                <span className="font-medium text-gray-900">{category.name}</span>
                <Badge variant="outline" className="text-xs">
                  {category.items.length} parts
                </Badge>
              </div>
              <div className="col-span-2 text-gray-500">-</div>
              <div className="col-span-2 text-gray-500">-</div>
              <div className="col-span-2 text-gray-500">-</div>
              <div className="col-span-2 flex items-center justify-end gap-2">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onEditCategory(category.name, category.name); }}>
                      <Edit3 className="mr-2 h-4 w-4" />
                      Edit Category
                    </DropdownMenuItem>
                    <DropdownMenuItem 
                      onClick={(e) => { e.stopPropagation(); onDeleteCategory(category.name); }}
                      className="text-red-600"
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Delete Category
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

            {/* Parts Rows */}
            {category.isExpanded && (
              <div className="divide-y divide-gray-100">
                {category.items.map((part) => (
                  <div 
                    key={part.id}
                    className={`grid grid-cols-12 gap-4 px-4 py-2 hover:bg-gray-50 cursor-pointer ${
                      selectedPart?.id === part.id ? 'bg-blue-50 border-l-2 border-l-blue-500' : ''
                    }`}
                    onClick={() => onPartClick(part)}
                  >
                    <div className="col-span-4">
                      <div className="font-medium text-gray-900">{part.name}</div>
                      {part.description && (
                        <div className="text-xs text-gray-500 mt-1 line-clamp-2">
                          {part.description}
                        </div>
                      )}
                    </div>
                    <div className="col-span-2 text-sm text-gray-600">
                      {part.category}
                    </div>
                    <div className="col-span-2">
                      <QuantityControl
                        quantity={part.quantity}
                        onChange={(newQuantity) => onQuantityChange(part.id, newQuantity)}
                        compact={true}
                      />
                    </div>
                    <div className="col-span-2">
                      <Badge 
                        className={`text-xs px-2 py-1 border ${getStatusColor(part.status)}`}
                      >
                        {getStatusText(part.status)}
                      </Badge>
                    </div>
                    <div className="col-span-2 flex items-center justify-end gap-1">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => onEditPart(part.id, {})}>
                            <Edit3 className="mr-2 h-4 w-4" />
                            Edit Part
                          </DropdownMenuItem>
                          <DropdownMenuItem 
                            onClick={() => onDeletePart(part.id)}
                            className="text-red-600"
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            Delete Part
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {categories.length === 0 && (
        <div className="px-4 py-8 text-center text-gray-500">
          No parts found. Add some parts to get started.
        </div>
      )}
    </div>
  );
};

export default BOMTable;
