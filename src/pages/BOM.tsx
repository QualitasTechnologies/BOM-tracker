import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { Search, Plus, Download, Filter, X, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Label } from '@/components/ui/label';
import BOMHeader from '@/components/BOM/BOMHeader';
import BOMCategoryCard from '@/components/BOM/BOMCategoryCard';
import ImportBOMDialog from '@/components/BOM/ImportBOMDialog';
import PurchaseRequestDialog from '@/components/BOM/PurchaseRequestDialog';
import OrderItemDialog from '@/components/BOM/OrderItemDialog';
import ReceiveItemDialog from '@/components/BOM/ReceiveItemDialog';
import InwardTracking from '@/components/BOM/InwardTracking';
import ProjectDocuments from '@/components/BOM/ProjectDocuments';
import Sidebar from '@/components/Sidebar';
import { saveAs } from 'file-saver';
import { 
  getBOMData, 
  subscribeToBOM, 
  updateBOMData, 
  updateBOMItem, 
  deleteBOMItem,
} from '@/utils/projectFirestore';
import { getVendors, getBOMSettings } from '@/utils/settingsFirestore';
import type { Vendor, BOMCategory as SettingsCategory } from '@/utils/settingsFirestore';
import { BOMItem, BOMCategory, BOMStatus } from '@/types/bom';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/firebase';
import { getProjectDocuments, linkDocumentToBOMItems } from '@/utils/projectDocumentFirestore';
import { ProjectDocument } from '@/types/projectDocument';
import { syncPODocumentLinks } from '@/utils/bomDocumentLinking';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogFooter,
  AlertDialogAction
} from '@/components/ui/alert-dialog';

interface OrderDialogData {
  orderDate: string;
  expectedArrival: string;
  poNumber?: string;
  linkedPODocumentId: string;
  vendor: {
    id: string;
    name: string;
    price: number;
    leadTime: string;
    availability: string;
  };
}

const BOM = () => {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [categories, setCategories] = useState<BOMCategory[]>([]);
  const { projectId } = useParams<{ projectId: string }>();
  console.log('projectId from URL params:', projectId);
  const [projectDetails, setProjectDetails] = useState<{ projectName: string; projectId: string; clientName: string } | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>([]);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [addPartOpen, setAddPartOpen] = useState(false);
  const [importBOMOpen, setImportBOMOpen] = useState(false);
  const [prDialogOpen, setPRDialogOpen] = useState(false);
  const [orderDialogOpen, setOrderDialogOpen] = useState(false);
  const [receiveDialogOpen, setReceiveDialogOpen] = useState(false);
  const [selectedItemForOrder, setSelectedItemForOrder] = useState<BOMItem | null>(null);
  const [selectedItemForReceive, setSelectedItemForReceive] = useState<BOMItem | null>(null);
  const [newPart, setNewPart] = useState<{
    itemType: 'component' | 'service';
    name: string;
    make: string;
    description: string;
    sku: string;
    quantity: number;
    price?: number;
  }>({
    itemType: 'component',
    name: '',
    make: '',
    description: '',
    sku: '',
    quantity: 1,
    price: undefined
  });
  const [categoryForPart, setCategoryForPart] = useState<string | null>(null);
  const [addPartError, setAddPartError] = useState<string | null>(null);
  const [emailStatus, setEmailStatus] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState<string | null>(null);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [availableMakes, setAvailableMakes] = useState<string[]>([]);
  const [canonicalCategories, setCanonicalCategories] = useState<SettingsCategory[]>([]);
  const [projectDocuments, setProjectDocuments] = useState<ProjectDocument[]>([]);
  const canonicalCategoryNames = useMemo(
    () =>
      canonicalCategories
        .filter((cat) => !cat.parentId && cat.isActive !== false)
        .map((cat) => cat.name),
    [canonicalCategories]
  );
  const canonicalCategorySet = useMemo(
    () => new Set(canonicalCategoryNames.map((name) => name.toLowerCase())),
    [canonicalCategoryNames]
  );

  const isCanonicalCategory = useCallback(
    (name: string | null | undefined) => !!name && canonicalCategorySet.has(name.toLowerCase()),
    [canonicalCategorySet]
  );

  // Load BOM data when project ID changes
  useEffect(() => {
    if (!projectId) return;

    // Initial load
    const loadBOMData = async () => {
      const data = await getBOMData(projectId);
      setCategories(data);
    };
    loadBOMData();

    // Subscribe to real-time updates
    const unsubscribe = subscribeToBOM(projectId, (updatedCategories) => {
      setCategories(updatedCategories);
    });

    return () => unsubscribe();
  }, [projectId]);

  // Load project details and documents
  useEffect(() => {
    const loadProjectDetails = async () => {
      if (!projectId) return;

      try {
        const projectRef = doc(db, 'projects', projectId);
        const projectSnap = await getDoc(projectRef);

        if (projectSnap.exists()) {
          const projectData = projectSnap.data() as { projectName: string; projectId: string; clientName: string };
          setProjectDetails({
            projectName: projectData.projectName,
            projectId: projectData.projectId,
            clientName: projectData.clientName,
          });
        } else {
          console.error('Project not found');
        }

        // Load project documents
        const docs = await getProjectDocuments(projectId);
        setProjectDocuments(docs);
      } catch (error) {
        console.error('Error loading project details:', error);
      }
    };

    loadProjectDetails();
  }, [projectId]);

  // Load settings data (vendors, makes, categories)
  useEffect(() => {
    const loadSettingsData = async () => {
      try {
        // Load vendors
        const vendorsData = await getVendors();
        setVendors(vendorsData);
        
        // Extract vendor company names as makes/brands
        const companyNames = vendorsData.map(vendor => vendor.company).filter(company => company.trim() !== '');
        
        // Remove duplicates and sort
        const uniqueMakes = [...new Set(companyNames)].sort();
        setAvailableMakes(uniqueMakes);

        // Load settings categories
        const bomSettings = await getBOMSettings();
        if (bomSettings && bomSettings.categories) {
          setCanonicalCategories(bomSettings.categories.filter(cat => !cat.parentId));
        } else {
          setCanonicalCategories([]);
        }
      } catch (error) {
        console.error('Error loading settings data:', error);
      }
    };

    loadSettingsData();
  }, []);

  const toggleCategory = async (categoryName: string) => {
    if (!projectId) return;
    
    const updatedCategories = categories.map(cat => 
      cat.name === categoryName 
        ? { ...cat, isExpanded: !cat.isExpanded }
        : cat
    );
    await updateBOMData(projectId, updatedCategories);
  };

  const handleQuantityChange = async (itemId: string, newQuantity: number) => {
    if (!projectId) return;
    await updateBOMItem(projectId, categories, itemId, { quantity: newQuantity });
  };

  const handleAddPart = async () => {
    if (!projectId) return;

    setAddPartError(null);
    if (canonicalCategoryNames.length === 0) {
      setAddPartError('Define at least one category in Settings → Default Categories before adding items.');
      return;
    }
    if (!categoryForPart) {
      setAddPartError('Select a category before adding an item.');
      return;
    }
    if (!isCanonicalCategory(categoryForPart)) {
      setAddPartError('Selected category is not part of Settings. Add or rename categories in Settings first.');
      return;
    }

    let finalCategory = categoryForPart;
    let updatedCategories = categories;
    
    // If the category doesn't exist in BOM yet, create it
    if (!categories.some(cat => cat.name === finalCategory)) {
      updatedCategories = [...categories, { name: finalCategory, isExpanded: true, items: [] }];
    }

    const newCategories = updatedCategories.map(cat =>
      cat.name === finalCategory
        ? {
            ...cat,
            items: [...cat.items, {
              id: Date.now().toString(),
              itemType: newPart.itemType,
              name: newPart.name,
              description: newPart.description,
              category: finalCategory || '',
              quantity: newPart.quantity,
              price: newPart.price,
              vendors: [],
              status: 'not-ordered' as BOMStatus,
              // Only include make and sku for components (Firestore doesn't accept undefined)
              ...(newPart.itemType === 'component' && {
                make: newPart.make,
                sku: newPart.sku
              })
            } as BOMItem]
          }
        : cat
    );

    await updateBOMData(projectId, newCategories);

    // Reset form
    setNewPart({ itemType: 'component', name: '', make: '', description: '', sku: '', quantity: 1, price: undefined });
    setAddPartOpen(false);
    setCategoryForPart(null);
  };

  const handleEditCategory = async (oldName: string, newName: string) => {
    if (!projectId || oldName === newName || !isCanonicalCategory(newName)) return;

    let movedItems: BOMItem[] = [];
    let wasExpanded = true;
    const remainingCategories = categories.filter((cat) => {
      if (cat.name === oldName) {
        movedItems = cat.items.map((item) => ({ ...item, category: newName }));
        wasExpanded = cat.isExpanded;
        return false;
      }
      return true;
    });

    const targetIndex = remainingCategories.findIndex((cat) => cat.name === newName);
    if (targetIndex >= 0) {
      const target = remainingCategories[targetIndex];
      remainingCategories[targetIndex] = {
        ...target,
        isExpanded: wasExpanded || target.isExpanded,
        items: [...target.items, ...movedItems],
      };
    } else {
      remainingCategories.push({
        name: newName,
        isExpanded: wasExpanded,
        items: movedItems,
      });
    }

    await updateBOMData(projectId, remainingCategories);
  };

  const handleDeletePart = async (itemId: string) => {
    if (!projectId) return;
    await deleteBOMItem(projectId, categories, itemId);
  };

  const handleUpdatePart = async (updatedPart: BOMItem) => {
    if (!projectId) return;
    await updateBOMItem(projectId, categories, updatedPart.id, updatedPart);
  };

  const handleEditPart = async (itemId: string, updates: Partial<BOMItem>) => {
    if (!projectId) return;
    await updateBOMItem(projectId, categories, itemId, updates);
  };

  // Calculate document count for a BOM item
  const getDocumentCountForItem = (itemId: string): number => {
    return projectDocuments.filter(doc =>
      doc.linkedBOMItems && doc.linkedBOMItems.includes(itemId)
    ).length;
  };

  // Get linked documents for a BOM item
  const getDocumentsForItem = (itemId: string) => {
    return projectDocuments
      .filter(doc => doc.linkedBOMItems && doc.linkedBOMItems.includes(itemId))
      .map(doc => ({
        id: doc.id,
        name: doc.name,
        type: doc.type,
        url: doc.url
      }));
  };

  // Unlink a document from a BOM item
  const handleUnlinkDocument = async (documentId: string, itemId: string) => {
    const doc = projectDocuments.find(d => d.id === documentId);
    if (!doc || !doc.linkedBOMItems) return;

    const updatedLinkedItems = doc.linkedBOMItems.filter(id => id !== itemId);

    try {
      await linkDocumentToBOMItems(documentId, updatedLinkedItems);
      // Update local state
      setProjectDocuments(prev =>
        prev.map(d =>
          d.id === documentId
            ? { ...d, linkedBOMItems: updatedLinkedItems }
            : d
        )
      );
    } catch (error) {
      console.error('Error unlinking document:', error);
    }
  };

  const handlePartCategoryChange = async (itemId: string, newCategory: string) => {
    if (!projectId) return;
    if (!isCanonicalCategory(newCategory)) return;
    
    // Find the part and remove it from its current category
    let partToMove: BOMItem | null = null;
    const updatedCategories = categories.map(cat => ({
      ...cat,
      items: cat.items.filter(item => {
        if (item.id === itemId) {
          partToMove = { ...item, category: newCategory };
          return false;
        }
        return true;
      })
    }));
    
    // Add the part to the new category
    if (partToMove) {
      let targetCategory = updatedCategories.find(cat => cat.name === newCategory);
      if (!targetCategory) {
        // Create new category if it doesn't exist
        targetCategory = { name: newCategory, isExpanded: true, items: [] };
        updatedCategories.push(targetCategory);
      }
      targetCategory.items.push(partToMove);
      
      await updateBOMData(projectId, updatedCategories);
    }
  };

  const handleCreatePurchaseOrder = () => {
    setPRDialogOpen(true);
  };

  // Filtered categories based on search and filter selections
  const filteredCategories = categories
    .map(category => ({
      ...category,
      items: category.items.filter(item => {
        const matchesSearch =
          item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
          item.description.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesStatus =
          selectedStatuses.length === 0 || selectedStatuses.includes(item.status as string);
        const matchesCategory =
          selectedCategories.length === 0 || selectedCategories.includes(category.name);
        return matchesSearch && matchesStatus && matchesCategory;
      })
    }))
    .filter(category => category.items.length > 0);

  // CSV Export Handler
  const handleExportCSV = () => {
    const headers = [
      'Project ID',
      'Project Name',
      'Client Name',
      'Item Type',
      'Name',
      'Make',
      'SKU',
      'Description',
      'Category',
      'Quantity/Duration',
      'Unit',
      'Unit Price/Rate (₹)',
      'Total Cost (₹)',
      'Status',
      'Expected Delivery',
      'Selected Vendor',
      'Vendor Price (₹)'
    ];

    const rows = categories.flatMap(category =>
      category.items.map(item => {
        const itemType = item.itemType || 'component';
        const isService = itemType === 'service';

        return [
          projectDetails?.projectId || '',
          projectDetails?.projectName || '',
          projectDetails?.clientName || '',
          isService ? 'Service' : 'Component',
          item.name,
          item.make || '',
          item.sku || '',
          item.description,
          category.name,
          item.quantity,
          isService ? 'days' : 'units',
          item.price !== undefined ? (isService ? `${item.price}/day` : item.price) : '',
          item.price !== undefined ? item.price * item.quantity : '',
          item.status === 'not-ordered' ? 'Pending' : item.status.charAt(0).toUpperCase() + item.status.slice(1),
          !isService ? (item.expectedDelivery || '') : '',
          !isService ? (item.finalizedVendor?.name || '') : '',
          !isService && item.finalizedVendor?.price !== undefined ? item.finalizedVendor.price : ''
        ];
      })
    );

    const csvContent = [headers, ...rows]
      .map(row => row.map(field => `"${String(field).replace(/"/g, '""')}"`).join(','))
      .join('\r\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    saveAs(blob, 'bom_export.csv');
  };

  // Calculate BOM financial metrics
  const calculateBOMMetrics = () => {
    const allParts = categories.flatMap(cat => cat.items);
    const totalItems = allParts.length;

    // Calculate items with pricing
    const itemsPriced = allParts.filter(part => part.price && part.price > 0).length;

    // Calculate total cost
    const totalCost = allParts.reduce((sum, part) => {
      if (part.price && part.price > 0) {
        return sum + (part.price * part.quantity);
      }
      return sum;
    }, 0);

    return {
      totalItems,
      itemsPriced,
      totalCost
    };
  };

  const handleOrderDialogConfirm = async (data: OrderDialogData) => {
    if (!projectId || !selectedItemForOrder) {
      return;
    }

    await updateBOMItem(projectId, categories, selectedItemForOrder.id, {
      status: 'ordered',
      orderDate: data.orderDate,
      expectedArrival: data.expectedArrival,
      poNumber: data.poNumber,
      linkedPODocumentId: data.linkedPODocumentId,
      finalizedVendor: {
        name: data.vendor.name,
        price: data.vendor.price,
        leadTime: data.vendor.leadTime,
        availability: data.vendor.availability,
      },
    });

    try {
      const updatedDocs = await syncPODocumentLinks({
        itemId: selectedItemForOrder.id,
        newDocumentId: data.linkedPODocumentId,
        previousDocumentId: selectedItemForOrder.linkedPODocumentId,
        documents: projectDocuments,
        linkDocument: linkDocumentToBOMItems,
      });
      setProjectDocuments(updatedDocs);
    } catch (error) {
      console.error('Error syncing PO document links:', error);
    }

    setSelectedItemForOrder(null);
  };

  return (
    <div className="min-h-screen bg-background flex">
      <Sidebar 
        collapsed={sidebarCollapsed} 
        onToggle={() => setSidebarCollapsed(!sidebarCollapsed)} 
      />
      
      <div className={`flex-1 ${sidebarCollapsed ? 'ml-16' : 'ml-64'}`}>
        <main className="p-4">
          <div className="max-w-full mx-auto px-2">
            {/* BOM Header */}
            <BOMHeader
              projectName={projectDetails?.projectName || ''}
              projectId={projectDetails?.projectId || ''}
              clientName={projectDetails?.clientName || ''}
              {...calculateBOMMetrics()}
            />

            {/* Project Documents - Centralized */}
            {projectId && (
              <ProjectDocuments
                projectId={projectId}
                bomItems={categories.flatMap(cat => cat.items)}
                onDocumentsChange={() => {
                  // Reload documents when they change
                  getProjectDocuments(projectId).then(setProjectDocuments);
                }}
                onBOMItemUpdate={async (itemId: string, updates: Partial<BOMItem>) => {
                  if (projectId) {
                    await updateBOMItem(projectId, categories, itemId, updates);
                  }
                }}
              />
            )}

            {/* Search and Actions Bar */}
            <div className="flex flex-col sm:flex-row gap-3 mb-4">
              <div className="relative flex-1 flex items-center gap-2">
                <div className="flex-1 relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground" size={20} />
                  <Input
                    type="text"
                    placeholder="Search parts by name, ID, or description..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10"
                  />
                </div>
                <Button variant="outline" onClick={() => setAddPartOpen(true)}>
                  <Plus className="mr-2 h-4 w-4" />
                  Add Part
                </Button>
                <Button variant="outline" onClick={() => setImportBOMOpen(true)}>
                  <Upload className="mr-2 h-4 w-4" />
                  Import BOM
                </Button>
              </div>
              
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setFilterOpen(true)}>
                  <Filter className="mr-2 h-4 w-4" />
                  Filter
                </Button>
                <Button variant="outline" onClick={handleExportCSV}>
                  <Download className="mr-2 h-4 w-4" />
                  Export
                </Button>
                <Button variant="outline" onClick={handleCreatePurchaseOrder}>
                  Create PR
                </Button>
              </div>
            </div>
            {emailStatus && <div className="mt-2 text-sm">{emailStatus}</div>}
            {importSuccess && (
              <Alert className="mt-2 border-green-200 bg-green-50">
                <AlertDescription className="text-green-800">
                  {importSuccess}
                </AlertDescription>
              </Alert>
            )}

            {/* Inward Tracking Section */}
            <InwardTracking
              categories={categories}
              documents={projectDocuments}
              onItemClick={(item) => {
                console.log('Item clicked:', item.name);
              }}
            />

            {/* BOM Content - Single Column Layout */}
            <div className="space-y-4">
              {filteredCategories.map((category) => (
                <BOMCategoryCard
                  key={category.name}
                  category={category}
                  onToggle={() => toggleCategory(category.name)}
                  onQuantityChange={handleQuantityChange}
                  onDeletePart={handleDeletePart}
                  onDeleteCategory={(categoryName) => {
                    // Handle category deletion - remove the entire category
                    if (projectId) {
                      const updatedCategories = categories.filter(cat => cat.name !== categoryName);
                      updateBOMData(projectId, updatedCategories);
                    }
                  }}
                  onStatusChange={(itemId, newStatus) => {
                    if (!projectId) return;

                    // Find the item
                    let targetItem: BOMItem | null = null;
                    for (const cat of categories) {
                      const found = cat.items.find(item => item.id === itemId);
                      if (found) {
                        targetItem = found;
                        break;
                      }
                    }

                    // If changing to "ordered", show the order dialog
                    if (newStatus === 'ordered' && targetItem) {
                      setSelectedItemForOrder(targetItem);
                      setOrderDialogOpen(true);
                      return;
                    }

                    // If changing to "received", show the receive dialog
                    if (newStatus === 'received' && targetItem) {
                      setSelectedItemForReceive(targetItem);
                      setReceiveDialogOpen(true);
                      return;
                    }

                    // For other status changes, update directly
                    updateBOMItem(projectId, categories, itemId, { status: newStatus as BOMStatus });
                  }}
                  onEditPart={handleEditPart}
                  onPartCategoryChange={handlePartCategoryChange}
                  availableCategories={canonicalCategoryNames}
                  onUpdatePart={handleUpdatePart}
                  getDocumentCount={getDocumentCountForItem}
                  getDocumentsForItem={getDocumentsForItem}
                  onUnlinkDocument={handleUnlinkDocument}
                  vendors={vendors}
                />
              ))}

              {filteredCategories.length === 0 && (
                <Card>
                  <CardContent className="p-8 text-center">
                    <p className="text-muted-foreground">No parts found matching your search criteria.</p>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        </main>
      </div>

      {/* Filter Dialog */}
      <Dialog open={filterOpen} onOpenChange={setFilterOpen}>
        <DialogContent className="@container max-w-[350px] max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Filter Parts</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <div className="font-semibold text-sm mb-2">Status</div>
              {['ordered', 'received', 'not-ordered', 'approved'].map(status => (
                <label key={status} className="flex items-center gap-2 mb-1">
                  <input
                    type="checkbox"
                    checked={selectedStatuses.includes(status)}
                    onChange={e => {
                      setSelectedStatuses(prev =>
                        e.target.checked
                          ? [...prev, status]
                          : prev.filter(s => s !== status)
                      );
                    }}
                  />
                  {status === 'not-ordered' ? 'Not Ordered' : status.charAt(0).toUpperCase() + status.slice(1)}
                </label>
              ))}
            </div>
            <div>
              <div className="font-semibold text-sm mb-2">Category</div>
              {categories.map(cat => (
                <label key={cat.name} className="flex items-center gap-2 mb-1">
                  <input
                    type="checkbox"
                    checked={selectedCategories.includes(cat.name)}
                    onChange={e => {
                      setSelectedCategories(prev =>
                        e.target.checked
                          ? [...prev, cat.name]
                          : prev.filter(c => c !== cat.name)
                      );
                    }}
                  />
                  {cat.name}
                </label>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <Button onClick={() => setFilterOpen(false)}>Apply</Button>
              <Button variant="outline" onClick={() => { setSelectedStatuses([]); setSelectedCategories([]); setFilterOpen(false); }}>
                Clear
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Add Part Dialog */}
      <Dialog open={addPartOpen} onOpenChange={setAddPartOpen}>
        <DialogContent className="@container max-w-[425px] max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>{newPart.itemType === 'service' ? 'Add Service' : 'Add Part'}</DialogTitle>
            <DialogDescription>
              {newPart.itemType === 'service'
                ? 'Add a new service to your BOM. Services are tracked by duration (days) and rate per day.'
                : 'Add a new part to your BOM. Select or create a category for organization.'}
            </DialogDescription>
          </DialogHeader>
          {addPartError && (
            <Alert variant="destructive">
              <AlertDescription>{addPartError}</AlertDescription>
            </Alert>
          )}
          <div className="space-y-4">
            <div>
              <Label>Item Type</Label>
              <Select
                value={newPart.itemType}
                onValueChange={(value: 'component' | 'service') => {
                  setNewPart({ ...newPart, itemType: value, make: '', sku: '' });
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="component">Component / Part</SelectItem>
                  <SelectItem value="service">Service</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Category</Label>
              <Select
                value={categoryForPart ?? undefined}
                onValueChange={(value) => {
                  setCategoryForPart(value || null);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select Category" />
                </SelectTrigger>
                <SelectContent>
                  {canonicalCategoryNames.length === 0 && (
                    <SelectItem value="__LOADING__" disabled>Loading categories...</SelectItem>
                  )}
                  {canonicalCategoryNames
                    .filter(catName => catName && catName.trim() !== '') // Filter out empty categories
                    .map(catName => (
                      <SelectItem key={catName} value={catName}>{catName}</SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>


            {newPart.itemType === 'component' ? (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="partName">Part Name *</Label>
                    <Input
                      id="partName"
                      value={newPart.name}
                      onChange={e => setNewPart({ ...newPart, name: e.target.value })}
                      placeholder="Enter part name"
                    />
                  </div>
                  <div>
                    <Label htmlFor="make">Make</Label>
                    <Select
                      value={newPart.make || undefined}
                      onValueChange={(value) => setNewPart({ ...newPart, make: value === "__NONE__" ? '' : (value || '') })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select Make/Brand" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__NONE__">None</SelectItem>
                        {availableMakes.length === 0 && vendors.length === 0 && (
                          <SelectItem value="__LOADING__" disabled>Loading makes...</SelectItem>
                        )}
                        {availableMakes.length === 0 && vendors.length > 0 && (
                          <SelectItem value="__NO_MAKES__" disabled>No makes found in vendors</SelectItem>
                        )}
                        {availableMakes
                          .filter(make => make && make.trim() !== '') // Filter out empty makes
                          .map((make) => (
                            <SelectItem key={make} value={make}>
                              {make}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="sku">SKU/Part Number</Label>
                    <Input
                      id="sku"
                      value={newPart.sku}
                      onChange={e => setNewPart({ ...newPart, sku: e.target.value })}
                      placeholder="Product SKU or part #"
                    />
                  </div>
                  <div>
                    <Label htmlFor="quantity">Quantity *</Label>
                    <Input
                      id="quantity"
                      type="number"
                      min={1}
                      value={newPart.quantity}
                      onChange={e => setNewPart({ ...newPart, quantity: Number(e.target.value) })}
                    />
                  </div>
                </div>
              </>
            ) : (
              <>
                <div>
                  <Label htmlFor="serviceName">Service Name *</Label>
                  <Input
                    id="serviceName"
                    value={newPart.name}
                    onChange={e => setNewPart({ ...newPart, name: e.target.value })}
                    placeholder="Enter service name"
                  />
                </div>

                <div>
                  <Label htmlFor="duration">Duration (days) *</Label>
                  <Input
                    id="duration"
                    type="number"
                    step="0.5"
                    min="0.5"
                    value={newPart.quantity}
                    onChange={e => setNewPart({ ...newPart, quantity: Number(e.target.value) })}
                    placeholder="Minimum 0.5 days"
                  />
                </div>

                <div>
                  <Label htmlFor="ratePerDay">Rate per Day (₹) *</Label>
                  <Input
                    id="ratePerDay"
                    type="number"
                    min="0"
                    value={newPart.price || ''}
                    onChange={e => setNewPart({ ...newPart, price: e.target.value ? Number(e.target.value) : undefined })}
                    placeholder="Enter rate per day"
                  />
                </div>
              </>
            )}

            <div>
              <Label htmlFor="description">Description</Label>
              <Input
                id="description"
                value={newPart.description}
                onChange={e => setNewPart({ ...newPart, description: e.target.value })}
                placeholder="Brief description of the part"
              />
            </div>

            <div className="flex justify-end gap-2">
              <Button onClick={handleAddPart} disabled={!newPart.name.trim()}>
                Add
              </Button>
              <Button variant="outline" onClick={() => setAddPartOpen(false)}>
                Cancel
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={emailStatus === 'Email sent successfully!'} onOpenChange={(open) => { if (!open) setEmailStatus(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Email sent successfully!</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setEmailStatus(null)}>OK</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Import BOM Dialog */}
      <ImportBOMDialog
        open={importBOMOpen}
        onOpenChange={setImportBOMOpen}
        projectId={projectId}
        onImportComplete={(importedItems) => {
          // Handle imported items - add them to the current BOM
          console.log('Received imported items:', importedItems);
          if (projectId && importedItems.length > 0) {
            // Group items by category
            const itemsByCategory = importedItems.reduce((acc, item) => {
              const category = item.category || 'Uncategorized';
              if (!acc[category]) {
                acc[category] = [];
              }
              acc[category].push(item);
              return acc;
            }, {} as Record<string, any[]>);

            // Update categories with new items
            const updatedCategories = [...categories];
            console.log('Items by category:', itemsByCategory);
            Object.entries(itemsByCategory).forEach(([categoryName, items]) => {
              let category = updatedCategories.find(cat => cat.name === categoryName);
              if (!category) {
                console.log('Creating new category:', categoryName);
                category = { name: categoryName, isExpanded: true, items: [] };
                updatedCategories.push(category);
              }
              console.log('Adding items to category:', categoryName, items);
              category.items.push(...items);
            });

            console.log('Final updated categories:', updatedCategories);
            updateBOMData(projectId, updatedCategories);
            setImportBOMOpen(false);
            
            // Show success message
            setImportSuccess(`Successfully imported ${importedItems.length} BOM items!`);
            setTimeout(() => setImportSuccess(null), 5000);
          }
        }}
      />

      {/* Purchase Request Dialog */}
      {projectDetails && (
        <PurchaseRequestDialog
          open={prDialogOpen}
          onOpenChange={setPRDialogOpen}
          projectId={projectId!}
          projectDetails={projectDetails}
          categories={categories}
          vendors={vendors}
        />
      )}

      {/* Order Item Dialog - shown when changing status to "ordered" */}
      {projectId && (
        <OrderItemDialog
          open={orderDialogOpen}
          onOpenChange={setOrderDialogOpen}
          item={selectedItemForOrder}
          projectId={projectId}
          availablePODocuments={projectDocuments.filter(doc => doc.type === 'outgoing-po')}
          vendors={vendors}
          onConfirm={handleOrderDialogConfirm}
          onDocumentUploaded={(newDoc) => {
            // Add the new document to the list
            setProjectDocuments(prev => [...prev, newDoc]);
          }}
        />
      )}

      {/* Receive Item Dialog - shown when changing status to "received" */}
      <ReceiveItemDialog
        open={receiveDialogOpen}
        onOpenChange={setReceiveDialogOpen}
        item={selectedItemForReceive}
        onConfirm={(data) => {
          if (selectedItemForReceive && projectId) {
            updateBOMItem(projectId, categories, selectedItemForReceive.id, {
              status: 'received',
              actualArrival: data.actualArrival,
            });
          }
          setSelectedItemForReceive(null);
        }}
      />
    </div>
  );
};

// Update the status mapping function to be more specific
function mapStatusToFirestore(status: string): BOMStatus {
  switch (status.toLowerCase()) {
    case 'ordered':
      return 'ordered';
    case 'received':
      return 'received';
    case 'approved':
      return 'approved';
    default:
      return 'not-ordered';
  }
}

export default BOM;
