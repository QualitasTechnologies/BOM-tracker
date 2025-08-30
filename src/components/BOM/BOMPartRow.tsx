
import { Calendar, ChevronDown, Building2, Link as LinkIcon, MoreHorizontal, Trash2, Edit, Check, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useState, useEffect } from 'react';
import { getVendors, Vendor } from '@/utils/settingsFirestore';
import QuantityControl from './QuantityControl';

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
  }>;
  status: 'not-ordered' | 'ordered' | 'received' | 'approved';
  expectedDelivery?: string;
  poNumber?: string;
  finalizedVendor?: { name: string; price: number; leadTime: string; availability: string };
}

interface BOMPartRowProps {
  part: BOMItem;
  onClick: () => void;
  onQuantityChange?: (itemId: string, newQuantity: number) => void;
  allVendors?: Array<{ name: string; price: number; leadTime: string; availability: string }>;
  onDelete?: (itemId: string) => void;
  onStatusChange?: (itemId: string, newStatus: string) => void;
  onEdit?: (itemId: string, updates: Partial<BOMItem>) => void;
  onCategoryChange?: (itemId: string, newCategory: string) => void;
  availableCategories?: string[];
}

const BOMPartRow = ({ part, onClick, onQuantityChange, allVendors = [], onDelete, onStatusChange, onEdit, onCategoryChange, availableCategories = [] }: BOMPartRowProps) => {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [vendors, setVendors] = useState(part.vendors);
  const [form, setForm] = useState({ name: '', price: 0, leadTime: '', availability: '' });
  const [selectedVendorIdx, setSelectedVendorIdx] = useState<number | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [showDeleteConfirmIdx, setShowDeleteConfirmIdx] = useState<number | null>(null);
  const [addPrevVendorIdx, setAddPrevVendorIdx] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const [availableMakes, setAvailableMakes] = useState<string[]>([]);
  const [editForm, setEditForm] = useState({ 
    name: part.name, 
    make: part.make || '', 
    description: part.description, 
    sku: part.sku || '', 
    quantity: part.quantity, 
    category: part.category 
  });
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Load vendors and extract makes
  useEffect(() => {
    const loadVendors = async () => {
      try {
        const vendorsData = await getVendors();
        
        // Extract vendor company names as makes/brands
        const companyNames = vendorsData
          .map(vendor => vendor.company)
          .filter(company => company && company.trim() !== '') // Ensure company exists and is not empty
          .map(company => company.trim()); // Trim whitespace
        
        // Remove duplicates and sort
        const uniqueMakes = [...new Set(companyNames)].sort();
        setAvailableMakes(uniqueMakes);
      } catch (error) {
        console.error('Error loading vendors:', error);
      }
    };

    loadVendors();
  }, []);

  // Handle selecting a current vendor for editing
  const handleSelectVendor = (idx: number) => {
    setSelectedVendorIdx(idx);
    setForm(vendors[idx]);
  };

  // Handle editing a vendor
  const handleEditVendor = (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedVendorIdx === null) return;
    const updated = vendors.map((v, i) => i === selectedVendorIdx ? form : v);
    setVendors(updated);
    setForm({ name: '', price: 0, leadTime: '', availability: '' });
    setSelectedVendorIdx(null);
  };

  // Handle adding a previous vendor
  const handleAddPrevVendor = () => {
    if (addPrevVendorIdx === null) return;
    const prevVendor = allVendors[addPrevVendorIdx];
    if (!vendors.some(v => v.name === prevVendor.name)) {
      setVendors([...vendors, prevVendor]);
    }
    setAddPrevVendorIdx(null);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setForm(prev => ({ ...prev, [name]: name === 'price' ? Number(value) : value }));
  };

  const handleAddVendor = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name || !form.leadTime || !form.availability) return;
    setVendors(prev => [...prev, form]);
    setForm({ name: '', price: 0, leadTime: '', availability: '' });
    setDialogOpen(false);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'approved':
        return <Badge className="bg-blue-100 text-blue-800 border-blue-200">Approved</Badge>;
      case 'ordered':
        return <Badge className="bg-amber-100 text-amber-800 border-amber-200">Ordered</Badge>;
      case 'not-ordered':
        return <Badge className="bg-red-100 text-red-800 border-red-200">Not Ordered</Badge>;
      case 'received':
        return <Badge className="bg-green-100 text-green-800 border-green-200">Received</Badge>;
      default:
        return <Badge variant="outline">Unknown</Badge>;
    }
  };

  return (
    <div 
      className="@container border border-gray-200 rounded p-3 hover:bg-gray-50 transition-colors cursor-pointer relative text-sm"
      onClick={editing ? undefined : onClick}
    >
      <div className="grid grid-cols-[1fr_auto] gap-2 w-full">
        <div className="min-w-0">
          {editing ? (
            <div className="space-y-2">
              <div className="grid grid-cols-[1fr_auto_auto_auto] @lg:grid-cols-[2fr_1fr_1fr_auto] gap-2 @md:gap-3">
                <input
                  placeholder="Part Name"
                  className="text-sm font-medium bg-white border rounded px-2 py-1 truncate"
                  value={editForm.name}
                  onChange={(e) => setEditForm(prev => ({ ...prev, name: e.target.value }))}
                  onClick={(e) => e.stopPropagation()}
                />
                <div className="min-w-0" onClick={(e) => e.stopPropagation()}>
                  <Select
                    value={editForm.make}
                    onValueChange={(value) => setEditForm(prev => ({ ...prev, make: value === "__NONE__" ? '' : (value || '') }))}
                  >
                    <SelectTrigger className="h-8 text-xs w-full">
                      <SelectValue placeholder="Make" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__NONE__">None</SelectItem>
                      {availableMakes
                        .filter(make => make && make.trim() !== '')
                        .map((make) => (
                          <SelectItem key={make} value={make}>
                            {make}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
                <input
                  placeholder="SKU"
                  className="text-sm bg-white border rounded px-2 py-1 truncate"
                  value={editForm.sku}
                  onChange={(e) => setEditForm(prev => ({ ...prev, sku: e.target.value }))}
                  onClick={(e) => e.stopPropagation()}
                />
                <input
                  type="number"
                  className="w-16 text-sm bg-white border rounded px-2 py-1"
                  value={editForm.quantity}
                  onChange={(e) => setEditForm(prev => ({ ...prev, quantity: Number(e.target.value) }))}
                  onClick={(e) => e.stopPropagation()}
                />
              </div>
              <div className="grid grid-cols-[1fr_auto] gap-2 @md:gap-3">
                <input
                  placeholder="Description"
                  className="text-sm bg-white border rounded px-2 py-1 truncate"
                  value={editForm.description}
                  onChange={(e) => setEditForm(prev => ({ ...prev, description: e.target.value }))}
                  onClick={(e) => e.stopPropagation()}
                />
                <select
                  className="text-sm bg-white border rounded px-2 py-1 min-w-[100px]"
                  value={editForm.category}
                  onChange={(e) => setEditForm(prev => ({ ...prev, category: e.target.value }))}
                  onClick={(e) => e.stopPropagation()}
                >
                  {availableCategories.map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>
            </div>
          ) : (
            <div className="space-y-1">
              <div className="grid grid-cols-[1fr_auto_auto_auto] @md:grid-cols-[2fr_auto_auto_auto] gap-2 @md:gap-3 items-center">
                <h4 className="font-medium text-gray-900 truncate min-w-0">{part.name}</h4>
                {part.make && (
                  <span className="text-xs text-blue-600 bg-blue-50 px-1 rounded whitespace-nowrap">{part.make}</span>
                )}
                {part.sku && (
                  <span className="text-xs text-purple-600 bg-purple-50 px-1 rounded whitespace-nowrap">SKU: {part.sku}</span>
                )}
                <span className="text-xs text-gray-500 bg-gray-100 px-1 rounded whitespace-nowrap">Qty: {part.quantity}</span>
              </div>
              <div className="text-xs text-gray-600 truncate">{part.description}</div>
              <div className="grid grid-cols-[auto_1fr] @md:grid-cols-[auto_auto] gap-2 @md:gap-4 text-xs text-gray-500 items-center">
                {part.expectedDelivery && (
                  <div className="flex items-center gap-1 whitespace-nowrap">
                    <Calendar size={10} />
                    <span>{part.expectedDelivery}</span>
                  </div>
                )}
                {part.finalizedVendor && (
                  <span className="truncate min-w-0">Vendor: {part.finalizedVendor.name}</span>
                )}
              </div>
            </div>
          )}
        </div>
        
        <div className="flex items-center gap-1">
          {editing ? (
            <>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 w-6 p-0"
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit?.(part.id, editForm);
                  if (editForm.category !== part.category) {
                    onCategoryChange?.(part.id, editForm.category);
                  }
                  setEditing(false);
                }}
              >
                <Check className="h-3 w-3 text-green-600" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 w-6 p-0"
                onClick={(e) => {
                  e.stopPropagation();
                  setEditForm({ 
                    name: part.name, 
                    make: part.make || '', 
                    description: part.description, 
                    sku: part.sku || '', 
                    quantity: part.quantity, 
                    category: part.category 
                  });
                  setEditForm({ 
                    name: part.name, 
                    make: part.make || '', 
                    description: part.description, 
                    sku: part.sku || '', 
                    quantity: part.quantity, 
                    category: part.category 
                  });
                  setEditing(false);
                }}
              >
                <X className="h-3 w-3 text-red-600" />
              </Button>
            </>
          ) : (
            <>
              {/* Status dropdown */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <span onClick={(e) => e.stopPropagation()}>{getStatusBadge(part.status)}</span>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem onClick={() => onStatusChange?.(part.id, 'approved')}>Approved</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onStatusChange?.(part.id, 'ordered')}>Ordered</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onStatusChange?.(part.id, 'not-ordered')}>Not Ordered</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onStatusChange?.(part.id, 'received')}>Received</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              
              {/* Actions dropdown */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 w-6 p-0"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <MoreHorizontal className="h-3 w-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem onClick={() => setEditing(true)}>
                    <Edit className="mr-2 h-3 w-3" />
                    Edit
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setShowDeleteConfirm(true)} className="text-red-600">
                    <Trash2 className="mr-2 h-3 w-3" />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}
        </div>
      </div>
      
      {/* Delete confirmation */}
      {showDeleteConfirm && (
        <div className="absolute right-0 top-8 z-50 bg-white border border-gray-300 rounded shadow-lg p-3 text-xs">
          <div className="mb-2 font-medium">Delete {part.name}?</div>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="destructive"
              className="h-6 text-xs px-2"
              onClick={(e) => {
                e.stopPropagation();
                onDelete?.(part.id);
                setShowDeleteConfirm(false);
              }}
            >
              Delete
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-6 text-xs px-2"
              onClick={(e) => {
                e.stopPropagation();
                setShowDeleteConfirm(false);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

export default BOMPartRow;
