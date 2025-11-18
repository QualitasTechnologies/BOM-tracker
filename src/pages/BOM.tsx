import { useState, useEffect, useCallback } from 'react';
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
import BOMPartDetails from '@/components/BOM/BOMPartDetails';
import ImportBOMDialog from '@/components/BOM/ImportBOMDialog';
import PurchaseRequestDialog from '@/components/BOM/PurchaseRequestDialog';
import Sidebar from '@/components/Sidebar';
import { saveAs } from 'file-saver';
import { 
  getBOMData, 
  subscribeToBOM, 
  updateBOMData, 
  updateBOMItem, 
  deleteBOMItem,
} from '@/utils/projectFirestore';
import { getVendors, Vendor, getBOMSettings } from '@/utils/settingsFirestore';
import { BOMItem, BOMCategory, BOMStatus } from '@/types/bom';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/firebase';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogFooter,
  AlertDialogAction
} from '@/components/ui/alert-dialog';

const BOM = () => {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedPart, setSelectedPart] = useState<BOMItem | null>(null);
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
  const [newPart, setNewPart] = useState({ 
    name: '', 
    make: '',
    description: '',
    sku: '',
    quantity: 1
  });
  const [categoryForPart, setCategoryForPart] = useState<string | null>(null);
  const [addPartError, setAddPartError] = useState<string | null>(null);
  const [emailStatus, setEmailStatus] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState<string | null>(null);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [availableMakes, setAvailableMakes] = useState<string[]>([]);
  const [settingsCategories, setSettingsCategories] = useState<string[]>([]);

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

  // Load project details
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
          const categoryNames = bomSettings.categories.map(cat => cat.name);
          setSettingsCategories(categoryNames);
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

  const handlePartClick = (part: BOMItem) => {
    setSelectedPart(part);
  };

  const handleAddPart = async () => {
    if (!projectId) return;

    setAddPartError(null);
    if (!categoryForPart) return;

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
              name: newPart.name,
              make: newPart.make,
              description: newPart.description,
              sku: newPart.sku,
              category: finalCategory || '',
              quantity: newPart.quantity,
              vendors: [],
              status: 'not-ordered' as BOMStatus,
            } as BOMItem]
          }
        : cat
    );

    await updateBOMData(projectId, newCategories);
    
    // Reset form
    setNewPart({ name: '', make: '', description: '', sku: '', quantity: 1 });
    setAddPartOpen(false);
    setCategoryForPart(null);
  };

  const handleEditCategory = async (oldName: string, newName: string) => {
    if (!projectId) return;

    const updatedCategories = categories.map(cat => {
      if (cat.name === oldName) {
        return {
          ...cat,
          name: newName,
          items: cat.items.map(item => ({ ...item, category: newName }))
        };
      }
      return cat;
    });

    await updateBOMData(projectId, updatedCategories);
  };

  const handleDeletePart = async (itemId: string) => {
    if (!projectId) return;
    await deleteBOMItem(projectId, categories, itemId);
    if (selectedPart?.id === itemId) {
      setSelectedPart(null);
    }
  };

  const handleUpdatePart = async (updatedPart: BOMItem) => {
    if (!projectId) return;
    await updateBOMItem(projectId, categories, updatedPart.id, updatedPart);
  };

  const handleEditPart = async (itemId: string, updates: Partial<BOMItem>) => {
    if (!projectId) return;
    await updateBOMItem(projectId, categories, itemId, updates);
  };

  const handlePartCategoryChange = async (itemId: string, newCategory: string) => {
    if (!projectId) return;
    
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
      'Part Name',
      'Make',
      'SKU',
      'Description',
      'Category',
      'Quantity',
      'Status',
      'Expected Delivery',
      'Selected Vendor',
      'Vendor Price (₹)'
    ];

    const rows = categories.flatMap(category =>
      category.items.map(item => [
        projectDetails?.projectId || '',
        projectDetails?.projectName || '',
        projectDetails?.clientName || '',
        item.name,
        item.make || '',
        item.sku || '',
        item.description,
        category.name,
        item.quantity,
        item.status === 'not-ordered' ? 'Pending' : item.status.charAt(0).toUpperCase() + item.status.slice(1),
        item.expectedDelivery || '',
        item.finalizedVendor?.name || '',
        item.finalizedVendor?.price !== undefined ? item.finalizedVendor.price : ''
      ])
    );

    const csvContent = [headers, ...rows]
      .map(row => row.map(field => `"${String(field).replace(/"/g, '""')}"`).join(','))
      .join('\r\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    saveAs(blob, 'bom_export.csv');
  };

  // Calculate BOM statistics
  const calculateBOMStats = () => {
    const allParts = categories.flatMap(cat => cat.items);
    const totalParts = allParts.length;
    const receivedParts = allParts.filter(part => part.status === 'received').length;
    const orderedParts = allParts.filter(part => part.status === 'ordered').length;
    const approvedParts = allParts.filter(part => part.status === 'approved').length;
    const notOrderedParts = allParts.filter(part => part.status === 'not-ordered').length;

    return {
      totalParts,
      receivedParts,
      orderedParts,
      notOrderedParts,
      approvedParts
    };
  };

  return (
    <div className="min-h-screen bg-background flex">
      <Sidebar 
        collapsed={sidebarCollapsed} 
        onToggle={() => setSidebarCollapsed(!sidebarCollapsed)} 
      />
      
      <div className={`flex-1 ${sidebarCollapsed ? 'ml-16' : 'ml-64'}`}>
        <main className="p-6">
          <div className="max-w-7xl mx-auto">
            {/* BOM Header */}
            <BOMHeader
              projectName={projectDetails?.projectName || ''}
              projectId={projectDetails?.projectId || ''}
              clientName={projectDetails?.clientName || ''}
              stats={calculateBOMStats()}
            />

            {/* Search and Actions Bar */}
            <div className="flex flex-col sm:flex-row gap-4 mb-6">
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
                  Create Purchase Order
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

            {/* BOM Content */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Categories List */}
              <div className="lg:col-span-2 space-y-4">
                {filteredCategories.map((category) => (
                  <BOMCategoryCard
                    key={category.name}
                    category={category}
                    onToggle={() => toggleCategory(category.name)}
                    onPartClick={handlePartClick}
                    onQuantityChange={handleQuantityChange}
                    onDeletePart={handleDeletePart}
                    onDeleteCategory={(categoryName) => {
                      // Handle category deletion - remove the entire category
                      if (projectId) {
                        const updatedCategories = categories.filter(cat => cat.name !== categoryName);
                        updateBOMData(projectId, updatedCategories);
                      }
                    }}
                    onEditCategory={handleEditCategory}
                    onStatusChange={(itemId, newStatus) => {
                      if (projectId) {
                        updateBOMItem(projectId, categories, itemId, { status: newStatus as BOMStatus });
                      }
                    }}
                    onEditPart={handleEditPart}
                    onPartCategoryChange={handlePartCategoryChange}
                    availableCategories={settingsCategories}
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

              {/* Part Details */}
              <div className="lg:col-span-1">
                <BOMPartDetails
                  part={selectedPart}
                  onClose={() => setSelectedPart(null)}
                  onUpdatePart={handleUpdatePart}
                  onDeletePart={handleDeletePart}
                />
              </div>
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
            <DialogTitle>Add Part</DialogTitle>
            <DialogDescription>
              Add a new part to your BOM. Select or create a category for organization.
            </DialogDescription>
          </DialogHeader>
          {addPartError && (
            <Alert variant="destructive">
              <AlertDescription>{addPartError}</AlertDescription>
            </Alert>
          )}
          <div className="space-y-4">
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
                  {settingsCategories.length === 0 && (
                    <SelectItem value="__LOADING__" disabled>Loading categories...</SelectItem>
                  )}
                  {settingsCategories
                    .filter(catName => catName && catName.trim() !== '') // Filter out empty categories
                    .map(catName => (
                      <SelectItem key={catName} value={catName}>{catName}</SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>


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
