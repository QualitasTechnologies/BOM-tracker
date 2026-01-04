
import { Calendar, ChevronDown, Building2, Link as LinkIcon, MoreHorizontal, Trash2, Edit, Check, X, FileText, Clock, AlertTriangle, CheckCircle2, Package, Unlink } from 'lucide-react';
import { SpecSearchButton } from './SpecSearchButton';
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
import { SearchableVendorSelect } from '@/components/ui/searchable-vendor-select';
import { useState, useEffect } from 'react';
import { getVendors, Vendor } from '@/utils/settingsFirestore';
import { getActiveBrands } from '@/utils/brandFirestore';
import { Brand } from '@/types/brand';
import QuantityControl from './QuantityControl';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { getInwardStatus, InwardStatus } from '@/types/bom';

interface BOMItem {
  id: string;
  itemType: 'component' | 'service';
  name: string;
  description: string;
  category: string;
  quantity: number; // For components: units, for services: days
  price?: number; // For components: unit price, for services: rate per day
  make?: string;
  sku?: string;
  vendors: Array<{
    name: string;
    price: number;
    leadTime: string;
    availability: string;
  }>;
  status: 'not-ordered' | 'ordered' | 'received';
  expectedDelivery?: string;
  poNumber?: string;
  finalizedVendor?: { name: string; price: number; leadTime: string; availability: string };
  // Inward tracking fields
  orderDate?: string;
  expectedArrival?: string;
  actualArrival?: string;
  linkedPODocumentId?: string;
  // Specification sheet fields
  specificationUrl?: string;
  linkedSpecDocumentId?: string;
}

interface GlobalVendor {
  id: string;
  company: string;
  leadTime: string;
  type: 'OEM' | 'Dealer';
  status: 'active' | 'inactive';
}

interface LinkedDocument {
  id: string;
  name: string;
  type: 'vendor-quote' | 'vendor-po' | 'customer-po';
  url: string;
}

interface BOMPartRowProps {
  part: BOMItem;
  projectId?: string;
  onClick: () => void;
  onQuantityChange?: (itemId: string, newQuantity: number) => void;
  allVendors?: Array<{ name: string; price: number; leadTime: string; availability: string }>;
  onDelete?: (itemId: string) => void;
  onStatusChange?: (itemId: string, newStatus: string) => void;
  onEdit?: (itemId: string, updates: Partial<BOMItem>) => void;
  onCategoryChange?: (itemId: string, newCategory: string) => void;
  availableCategories?: string[];
  linkedDocumentsCount?: number;
  linkedDocuments?: LinkedDocument[];
  onUnlinkDocument?: (documentId: string, itemId: string) => void;
  globalVendors?: GlobalVendor[];
}

// Helper function to format date
const formatDateShort = (dateStr: string | undefined): string => {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};

// Helper function to calculate days until arrival
const getDaysUntilArrival = (expectedArrival: string | undefined): number | null => {
  if (!expectedArrival) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const expected = new Date(expectedArrival);
  expected.setHours(0, 0, 0, 0);
  return Math.ceil((expected.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
};

// Inward status badge component
const InwardStatusBadge = ({ part }: { part: BOMItem }) => {
  const inwardStatus = getInwardStatus(part);
  const daysUntil = getDaysUntilArrival(part.expectedArrival);

  if (inwardStatus === 'not-ordered' || !part.expectedArrival) return null;

  const statusConfig: Record<InwardStatus, { icon: React.ReactNode; className: string; label: string }> = {
    'overdue': {
      icon: <AlertTriangle size={10} />,
      className: 'text-red-600 bg-red-50',
      label: `LATE ${Math.abs(daysUntil || 0)}d`
    },
    'arriving-soon': {
      icon: <Clock size={10} />,
      className: 'text-amber-600 bg-amber-50',
      label: `${daysUntil}d`
    },
    'on-track': {
      icon: <Package size={10} />,
      className: 'text-gray-600 bg-gray-100',
      label: `${daysUntil}d`
    },
    'received': {
      icon: <CheckCircle2 size={10} />,
      className: 'text-green-600 bg-green-50',
      label: 'Received'
    },
    'not-ordered': {
      icon: null,
      className: '',
      label: ''
    }
  };

  const config = statusConfig[inwardStatus];
  if (!config.icon) return null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={`flex items-center gap-1 px-1.5 py-0.5 rounded whitespace-nowrap ${config.className}`}>
          {config.icon}
          <span className="font-medium">{config.label}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <div className="text-xs">
          <div>Expected: {formatDateShort(part.expectedArrival)}</div>
          {part.orderDate && <div>Ordered: {formatDateShort(part.orderDate)}</div>}
        </div>
      </TooltipContent>
    </Tooltip>
  );
};

const statusStyles: Record<
  BOMItem["status"],
  { label: string; className: string }
> = {
  "not-ordered": {
    label: "Not Ordered",
    className: "bg-red-50 text-red-700 border-red-200",
  },
  ordered: {
    label: "Ordered",
    className: "bg-amber-50 text-amber-700 border-amber-200",
  },
  received: {
    label: "Received",
    className: "bg-green-50 text-green-700 border-green-200",
  },
};

const BOMPartRow = ({ part, projectId, onClick, onQuantityChange, allVendors = [], onDelete, onStatusChange, onEdit, onCategoryChange, availableCategories = [], linkedDocumentsCount = 0, linkedDocuments = [], onUnlinkDocument, globalVendors = [] }: BOMPartRowProps) => {
  // Backward compatibility: default to 'component' if itemType is missing
  const itemType = part.itemType || 'component';

  const [dialogOpen, setDialogOpen] = useState(false);
  const [vendors, setVendors] = useState(part.vendors);
  const [form, setForm] = useState({ name: '', price: 0, leadTime: '', availability: '' });
  const [selectedVendorIdx, setSelectedVendorIdx] = useState<number | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [showDeleteConfirmIdx, setShowDeleteConfirmIdx] = useState<number | null>(null);
  const [addPrevVendorIdx, setAddPrevVendorIdx] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const [availableBrands, setAvailableBrands] = useState<Brand[]>([]);
  const [editForm, setEditForm] = useState({
    itemType: part.itemType || 'component',
    name: part.name,
    make: part.make || '',
    description: part.description,
    sku: part.sku || '',
    quantity: part.quantity,
    price: part.price,
    category: part.category,
    finalizedVendor: part.finalizedVendor
  });
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Load brands for make dropdown
  useEffect(() => {
    const loadBrands = async () => {
      try {
        const brandsData = await getActiveBrands();
        // Sort by name
        const sortedBrands = brandsData.sort((a, b) => a.name.localeCompare(b.name));
        setAvailableBrands(sortedBrands);
      } catch (error) {
        console.error('Error loading brands:', error);
      }
    };

    loadBrands();
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

  const getStatusBadge = (status: BOMItem["status"]) => {
    const meta = statusStyles[status];
    if (!meta) {
      return <Badge variant="outline">Unknown</Badge>;
    }
    return (
      <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium ${meta.className}`}>
        {meta.label}
      </span>
    );
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
              {/* Item Type Selector */}
              <div className="flex items-center gap-2 pb-1 border-b">
                <label className="text-xs font-medium text-gray-600">Type:</label>
                <Select
                  value={editForm.itemType}
                  onValueChange={(value: 'component' | 'service') => {
                    setEditForm(prev => ({
                      ...prev,
                      itemType: value,
                      // Clear make and sku when switching to service
                      ...(value === 'service' && { make: '', sku: '' })
                    }));
                  }}
                >
                  <SelectTrigger className="h-7 w-32 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="component">Component</SelectItem>
                    <SelectItem value="service">Service</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className={`grid gap-2 @md:gap-3 ${editForm.itemType === 'service' ? 'grid-cols-[1fr_auto_auto]' : 'grid-cols-[1fr_auto_auto_auto_auto] @lg:grid-cols-[2fr_1fr_1fr_auto_auto]'}`}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <input
                      placeholder={editForm.itemType === 'service' ? 'Service Name' : 'Part Name'}
                      className="text-sm font-medium bg-white border rounded px-2 py-1 truncate"
                      value={editForm.name}
                      onChange={(e) => setEditForm(prev => ({ ...prev, name: e.target.value }))}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </TooltipTrigger>
                  <TooltipContent>{editForm.itemType === 'service' ? 'Service name shown on BOM' : 'Internal name shown on BOM'}</TooltipContent>
                </Tooltip>

                {editForm.itemType === 'component' && (
                  <>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="min-w-0" onClick={(e) => e.stopPropagation()}>
                          <Select
                            value={editForm.make}
                            onValueChange={(value) => setEditForm(prev => ({ ...prev, make: value === "__NONE__" ? '' : (value || '') }))}
                          >
                            <SelectTrigger className="h-8 text-xs w-full">
                              <SelectValue placeholder="Brand" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__NONE__">None</SelectItem>
                              {availableBrands.map((brand) => (
                                <SelectItem key={brand.id} value={brand.name}>
                                  <span className="flex items-center gap-2">
                                    {brand.logo && (
                                      <img
                                        src={brand.logo}
                                        alt=""
                                        className="w-4 h-4 object-contain"
                                      />
                                    )}
                                    {brand.name}
                                  </span>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent>Brand / OEM manufacturer</TooltipContent>
                    </Tooltip>

                    <Tooltip>
                      <TooltipTrigger asChild>
                        <input
                          placeholder="SKU"
                          className="text-sm bg-white border rounded px-2 py-1 truncate"
                          value={editForm.sku}
                          onChange={(e) => setEditForm(prev => ({ ...prev, sku: e.target.value }))}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </TooltipTrigger>
                      <TooltipContent>SKU / model number for procurement</TooltipContent>
                    </Tooltip>
                  </>
                )}

                <Tooltip>
                  <TooltipTrigger asChild>
                    <input
                      type="number"
                      placeholder={editForm.itemType === 'service' ? '₹/day' : 'Price'}
                      className="w-20 text-sm bg-white border rounded px-2 py-1"
                      value={editForm.price || ''}
                      onChange={(e) => setEditForm(prev => ({ ...prev, price: e.target.value ? Number(e.target.value) : undefined }))}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </TooltipTrigger>
                  <TooltipContent>
                    {editForm.itemType === 'service' ? 'Rate per day in INR' : 'Unit price in INR'}
                  </TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <input
                      type="number"
                      step={editForm.itemType === 'service' ? '0.5' : '1'}
                      min={editForm.itemType === 'service' ? '0.5' : '1'}
                      placeholder={editForm.itemType === 'service' ? 'Days' : 'Qty'}
                      className="w-16 text-sm bg-white border rounded px-2 py-1"
                      value={editForm.quantity}
                      onChange={(e) => setEditForm(prev => ({ ...prev, quantity: Number(e.target.value) }))}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </TooltipTrigger>
                  <TooltipContent>
                    {editForm.itemType === 'service' ? 'Duration in days (min 0.5)' : 'Quantity required for this project'}
                  </TooltipContent>
                </Tooltip>
              </div>
              <div className="grid grid-cols-[1fr_auto] gap-2 @md:gap-3">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <input
                      placeholder="Description"
                      className="text-sm bg-white border rounded px-2 py-1 truncate"
                      value={editForm.description}
                      onChange={(e) => setEditForm(prev => ({ ...prev, description: e.target.value }))}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </TooltipTrigger>
                  <TooltipContent>Key specs or application notes</TooltipContent>
                </Tooltip>
                {/* Category selector */}
                {availableCategories.length > 0 && (
                  <div onClick={(e) => e.stopPropagation()}>
                    <Select
                      value={editForm.category}
                      onValueChange={(value) => setEditForm(prev => ({ ...prev, category: value }))}
                    >
                      <SelectTrigger className="h-8 text-xs w-[140px]">
                        <SelectValue placeholder="Category" />
                      </SelectTrigger>
                      <SelectContent>
                        {availableCategories.map((cat) => (
                          <SelectItem key={cat} value={cat}>
                            {cat}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
              {/* Vendor Selection for components - use globalVendors with search */}
              {editForm.itemType === 'component' && globalVendors.length > 0 && (
                <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                  <span className="text-xs text-gray-500">Vendor:</span>
                  <SearchableVendorSelect
                    vendors={globalVendors}
                    value={editForm.finalizedVendor?.name}
                    onValueChange={(value) => {
                      if (!value) {
                        setEditForm(prev => ({ ...prev, finalizedVendor: undefined }));
                      } else {
                        const selected = globalVendors.find(v => v.company === value);
                        if (selected) {
                          setEditForm(prev => ({
                            ...prev,
                            finalizedVendor: {
                              name: selected.company,
                              price: editForm.price || 0,
                              leadTime: selected.leadTime,
                              availability: 'In Stock'
                            }
                          }));
                        }
                      }
                    }}
                    placeholder="Select vendor"
                    triggerClassName="h-7 text-xs flex-1 min-w-[150px]"
                    className="w-[300px]"
                  />
                </div>
              )}
              {/* Linked Documents Section - shown in edit mode */}
              {linkedDocuments.length > 0 && (
                <div className="border-t pt-2 mt-2" onClick={(e) => e.stopPropagation()}>
                  <span className="text-xs text-gray-500 font-medium">Linked Documents:</span>
                  <div className="flex flex-wrap gap-2 mt-1">
                    {linkedDocuments.map((doc) => (
                      <div
                        key={doc.id}
                        className="flex items-center gap-2 px-2 py-1.5 rounded border bg-gray-50 text-xs"
                      >
                        <FileText size={14} className="text-gray-500 flex-shrink-0" />
                        <a
                          href={doc.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="hover:underline max-w-[180px] truncate text-gray-700"
                          title={doc.name}
                        >
                          {doc.name}
                        </a>
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium flex-shrink-0 ${
                          doc.type === 'vendor-quote'
                            ? 'bg-blue-100 text-blue-700'
                            : doc.type === 'vendor-po'
                            ? 'bg-green-100 text-green-700'
                            : 'bg-purple-100 text-purple-700'
                        }`}>
                          {doc.type === 'vendor-quote' ? 'Quote' : doc.type === 'vendor-po' ? 'PO' : 'Customer PO'}
                        </span>
                        {onUnlinkDocument && (
                          <button
                            onClick={() => onUnlinkDocument(doc.id, part.id)}
                            className="p-1 hover:bg-red-100 rounded flex-shrink-0"
                            title="Unlink document from this item"
                          >
                            <X size={14} className="text-red-500" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2 justify-between">
                <div className="flex flex-wrap items-center gap-2 min-w-0 flex-1">
                  <h4 className="font-medium text-gray-900 truncate">{part.name}</h4>
                  {itemType === 'component' && part.make && (
                    <span className="text-xs text-blue-600 bg-blue-50 px-1 rounded whitespace-nowrap">{part.make}</span>
                  )}
                  {itemType === 'component' && part.sku && (
                    <span className="text-xs text-purple-600 bg-purple-50 px-1 rounded whitespace-nowrap">SKU: {part.sku}</span>
                  )}
                  {itemType === 'service' && (
                    <span className="text-xs text-indigo-600 bg-indigo-50 px-1 rounded whitespace-nowrap">Service</span>
                  )}
                  {linkedDocumentsCount > 0 && (
                    <span className="text-xs text-green-600 bg-green-50 px-1 rounded whitespace-nowrap flex items-center gap-1">
                      <FileText size={12} />
                      {linkedDocumentsCount}
                    </span>
                  )}
                </div>
                {part.price && (
                  <div className="flex flex-wrap items-center gap-3 text-xs text-gray-700">
                    <div className="flex items-center gap-1 whitespace-nowrap">
                      <span className="text-gray-500">
                        {itemType === 'service' ? 'Rate:' : 'Unit:'}
                      </span>
                      <span className="font-medium">
                        ₹{part.price.toLocaleString('en-IN')}
                        {itemType === 'service' && '/day'}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 whitespace-nowrap text-green-700 font-semibold">
                      <span className="text-gray-500 font-normal">Total:</span>
                      <span>₹{(part.price * part.quantity).toLocaleString('en-IN')}</span>
                    </div>
                  </div>
                )}
              </div>
              <div className="text-xs text-gray-600 truncate">{part.description}</div>
              <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500">
                <span className="text-xs text-gray-500 bg-gray-100 px-1 rounded whitespace-nowrap">
                  {itemType === 'service' ? 'Duration:' : 'Qty:'} {part.quantity}{itemType === 'service' && ' days'}
                </span>
                {itemType === 'component' && part.finalizedVendor && (
                  <span className="truncate min-w-0">Vendor: {part.finalizedVendor.name}</span>
                )}
                {/* Inward Tracking Status */}
                {itemType === 'component' && part.status === 'ordered' && (
                  <InwardStatusBadge part={part} />
                )}
                {itemType === 'component' && part.status === 'received' && part.actualArrival && (
                  <span className="flex items-center gap-1 text-green-600 whitespace-nowrap">
                    <CheckCircle2 size={10} />
                    Rcvd: {formatDateShort(part.actualArrival)}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
        
        <div className="flex items-center gap-2 self-start">
          {editing ? (
            <>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 w-6 p-0"
                onClick={(e) => {
                  e.stopPropagation();
                  console.log('Saving part changes:', { 
                    partId: part.id, 
                    originalCategory: part.category, 
                    newCategory: editForm.category,
                    availableCategories 
                  });
                  onEdit?.(part.id, editForm);
                  if (editForm.category !== part.category) {
                    console.log('Category changed, calling onCategoryChange:', editForm.category);
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
                    itemType: part.itemType || 'component',
                    name: part.name,
                    make: part.make || '',
                    description: part.description,
                    sku: part.sku || '',
                    quantity: part.quantity,
                    price: part.price,
                    category: part.category,
                    finalizedVendor: part.finalizedVendor
                  });
                  setEditing(false);
                }}
              >
                <X className="h-3 w-3 text-red-600" />
              </Button>
            </>
          ) : (
            <>
              {itemType === 'component' && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-0 py-0 bg-transparent hover:bg-transparent"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {getStatusBadge(part.status)}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuItem onClick={() => onStatusChange?.(part.id, 'not-ordered')}>Not Ordered</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onStatusChange?.(part.id, 'ordered')}>Ordered</DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => onStatusChange?.(part.id, 'received')}
                      disabled={part.status === 'not-ordered'}
                      className={part.status === 'not-ordered' ? 'opacity-50 cursor-not-allowed' : ''}
                    >
                      Received {part.status === 'not-ordered' && '(must be ordered first)'}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              
              {/* Spec search button (components only) */}
              {itemType === 'component' && projectId && (
                <SpecSearchButton
                  itemId={part.id}
                  itemName={part.name}
                  projectId={projectId}
                  make={part.make}
                  sku={part.sku}
                  specificationUrl={part.specificationUrl}
                  linkedSpecDocumentId={part.linkedSpecDocumentId}
                />
              )}

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
