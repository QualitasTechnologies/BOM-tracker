import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search, Plus, Download, Filter, X, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Label } from '@/components/ui/label';
import BOMHeader from '@/components/BOM/BOMHeader';
import BOMTable from '@/components/BOM/BOMTable';
import BOMPartDetails from '@/components/BOM/BOMPartDetails';
import ImportBOMDialog from '@/components/BOM/ImportBOMDialog';
import Sidebar from '@/components/Sidebar';
import { saveAs } from 'file-saver';
import { 
  getBOMData, 
  subscribeToBOM, 
  updateBOMData, 
  updateBOMItem, 
  deleteBOMItem,
} from '@/utils/projectFirestore';
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
  const [searchParams] = useSearchParams();
  const projectId = searchParams.get('project');
  const [projectDetails, setProjectDetails] = useState<{ projectName: string; projectId: string; clientName: string } | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>([]);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [addPartOpen, setAddPartOpen] = useState(false);
  const [importBOMOpen, setImportBOMOpen] = useState(false);
  const [newPart, setNewPart] = useState({ 
    name: '', 
    make: '',
    description: '',
    sku: '',
    quantity: 1
  });
  const [categoryForPart, setCategoryForPart] = useState<string | null>(null);
  const [addingNewCategory, setAddingNewCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [addPartError, setAddPartError] = useState<string | null>(null);
  const [emailStatus, setEmailStatus] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState<string | null>(null);

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
    if (!categoryForPart && !addingNewCategory) return;

    let finalCategory = categoryForPart;
    let updatedCategories = categories;

    if (addingNewCategory && newCategoryName.trim()) {
      finalCategory = newCategoryName.trim();
      if (!categories.some(cat => cat.name === finalCategory)) {
        updatedCategories = [...categories, { name: finalCategory, isExpanded: true, items: [] }];
      }
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
    setAddingNewCategory(false);
    setNewCategoryName('');
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
    
    // Ensure "Uncategorized" category exists
    const ensureUncategorizedExists = (cats: any[]) => {
      if (!cats.find(cat => cat.name === 'Uncategorized')) {
        cats.push({ name: 'Uncategorized', isExpanded: true, items: [] });
      }
      return cats;
    };
    
    // Find the part and remove it from its current category
    let partToMove: BOMItem | null = null;
    let updatedCategories = categories.map(cat => ({
      ...cat,
      items: cat.items.filter(item => {
        if (item.id === itemId) {
          partToMove = { ...item, category: newCategory };
          return false;
        }
        return true;
      })
    }));
    
    // Ensure Uncategorized exists
    updatedCategories = ensureUncategorizedExists(updatedCategories);
    
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

  const handleCreatePurchaseOrder = async () => {
    setEmailStatus(null);
    try {
      const response = await fetch('http://localhost:5001/send-purchase-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: 'swathi.rao@btech.christuniversity.in' }), // Updated recipient
      });
      const data = await response.json();
      if (data.success) {
        setEmailStatus('Email sent successfully!');
      } else {
        setEmailStatus('Failed to send email: ' + data.error);
      }
    } catch (err: any) {
      setEmailStatus('Error: ' + err.message);
    }
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
        <main className="p-4">
          <div className="max-w-7xl mx-auto">
            {/* BOM Header */}
            <BOMHeader
              projectName={projectDetails?.projectName || ''}
              projectId={projectDetails?.projectId || ''}
              clientName={projectDetails?.clientName || ''}
              stats={calculateBOMStats()}
            />

            {/* Search and Actions Bar */}
            <div className="flex flex-col sm:flex-row gap-3 mb-4">
              <div className="relative flex-1 flex items-center gap-2">
                <div className="flex-1 relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground" size={18} />
                  <Input
                    type="text"
                    placeholder="Search parts by name, ID, or description..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-9 h-9"
                  />
                </div>
                <Button variant="outline" size="sm" onClick={() => setAddPartOpen(true)} className="h-9">
                  <Plus className="mr-1.5 h-4 w-4" />
                  Add Part
                </Button>
                <Button variant="outline" size="sm" onClick={() => setImportBOMOpen(true)} className="h-9">
                  <Upload className="mr-1.5 h-4 w-4" />
                  Import BOM
                </Button>
              </div>
              
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setFilterOpen(true)} className="h-9">
                  <Filter className="mr-1.5 h-4 w-4" />
                  Filter
                </Button>
                <Button variant="outline" size="sm" onClick={handleExportCSV} className="h-9">
                  <Download className="mr-1.5 h-4 w-4" />
                  Export
                </Button>
                <Button variant="outline" size="sm" onClick={handleCreatePurchaseOrder} className="h-9">
                  Create Purchase Order
                </Button>
              </div>
            </div>
            {emailStatus && <div className="mt-1 text-sm">{emailStatus}</div>}
            {importSuccess && (
              <Alert className="mt-2 border-green-200 bg-green-50">
                <AlertDescription className="text-green-800">
                  {importSuccess}
                </AlertDescription>
              </Alert>
            )}

            {/* BOM Content */}
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
              {/* BOM Table */}
              <div className="lg:col-span-3">
                <BOMTable
                  categories={filteredCategories}
                  onToggle={toggleCategory}
                  onPartClick={handlePartClick}
                  onQuantityChange={handleQuantityChange}
                  onDeletePart={handleDeletePart}
                  onDeleteCategory={(categoryName) => {
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
                  availableCategories={categories.map(cat => cat.name)}
                  selectedPart={selectedPart}
                />
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
        <DialogContent className="max-w-[350px]">
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
        <DialogContent className="max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Add Part</DialogTitle>
          </DialogHeader>
          {addPartError && (
            <Alert variant="destructive">
              <AlertDescription>{addPartError}</AlertDescription>
            </Alert>
          )}
          <div className="space-y-4">
            <div>
              <Label>Category</Label>
              <select 
                className="w-full border rounded p-2"
                value={addingNewCategory ? '+new' : (categoryForPart ?? '')}
                onChange={e => {
                  if (e.target.value === '+new') {
                    setAddingNewCategory(true);
                    setCategoryForPart(null);
                  } else {
                    setAddingNewCategory(false);
                    setCategoryForPart(e.target.value);
                  }
                }}
              >
                <option value="">Select Category</option>
                {categories.map(cat => (
                  <option key={cat.name} value={cat.name}>{cat.name}</option>
                ))}
                <option value="+new">+ Add New Category</option>
              </select>
            </div>

            {addingNewCategory && (
              <div>
                <Label>New Category Name</Label>
                <Input
                  value={newCategoryName}
                  onChange={e => setNewCategoryName(e.target.value)}
                  placeholder="Enter new category name"
                />
              </div>
            )}

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
                <Input
                  id="make"
                  value={newPart.make}
                  onChange={e => setNewPart({ ...newPart, make: e.target.value })}
                  placeholder="Brand/Manufacturer"
                />
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
          if (projectId && importedItems.length > 0) {
            // Ensure "Uncategorized" category exists
            const ensureUncategorizedExists = (cats: any[]) => {
              if (!cats.find(cat => cat.name === 'Uncategorized')) {
                cats.push({ name: 'Uncategorized', isExpanded: true, items: [] });
              }
              return cats;
            };
            
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
            let updatedCategories = [...categories];
            updatedCategories = ensureUncategorizedExists(updatedCategories);
            
            Object.entries(itemsByCategory).forEach(([categoryName, items]) => {
              let category = updatedCategories.find(cat => cat.name === categoryName);
              if (!category) {
                category = { name: categoryName, isExpanded: true, items: [] };
                updatedCategories.push(category);
              }
              category.items.push(...items);
            });

            updateBOMData(projectId, updatedCategories);
            setImportBOMOpen(false);
            
            // Show success message
            setImportSuccess(`Successfully imported ${importedItems.length} BOM items!`);
            setTimeout(() => setImportSuccess(null), 5000);
          }
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
