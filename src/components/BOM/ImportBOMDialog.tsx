import React, { useState, useRef } from 'react';
import { X, Loader2, Check, AlertCircle, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { BOMItem } from '@/types/bom';
import { getBOMSettings, getVendors } from '@/utils/settingsFirestore';
import { analyzeBOMWithAI, ExtractedBOMItem as AIExtractedItem } from '@/utils/aiService';

interface ImportBOMDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string | null;
  onImportComplete: (items: BOMItem[]) => void;
}

interface EditableBOMItem {
  id: string;
  selected: boolean;
  name: string;
  make: string;
  sku: string;
  description: string;
  quantity: number;
  unit: string;
  category: string;
  isValid: boolean;
  errors: string[];
}

const ImportBOMDialog: React.FC<ImportBOMDialogProps> = ({
  open,
  onOpenChange,
  projectId,
  onImportComplete
}) => {
  const [textContent, setTextContent] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [editableItems, setEditableItems] = useState<EditableBOMItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [bomSettings, setBomSettings] = useState<any>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [existingCategories, setExistingCategories] = useState<string[]>([]);
  const [existingMakes, setExistingMakes] = useState<string[]>([]);
  const [showTable, setShowTable] = useState(false);

  // Load BOM settings and reset state when dialog opens
  React.useEffect(() => {
    const loadData = async () => {
      try {
        const [settings, vendors] = await Promise.all([
          getBOMSettings(),
          getVendors()
        ]);
        
        setBomSettings(settings);
        if (settings?.defaultCategories) {
          setExistingCategories(settings.defaultCategories);
        }
        
        // Extract unique makes from OEM vendors only
        const makes = new Set<string>();
        
        const oemVendors = vendors.filter(vendor => vendor.type === 'OEM');
        oemVendors.forEach(vendor => {
          if (vendor.company && vendor.company.trim()) {
            makes.add(vendor.company);
          }
        });
        
        setExistingMakes(Array.from(makes));
        console.log('Loaded OEM makes (company names):', Array.from(makes));
        
      } catch (err) {
        console.error('Failed to load data:', err);
      }
    };
    
    if (open) {
      // Reset all state when dialog opens
      setTextContent('');
      setEditableItems([]);
      setError(null);
      setIsAnalyzing(false);
      setShowTable(false);
      
      loadData();
    }
  }, [open]);

  // Validation function for editable items
  const validateItem = (item: Partial<EditableBOMItem>): { isValid: boolean; errors: string[] } => {
    const errors: string[] = [];
    
    if (!item.name?.trim()) errors.push('Name is required');
    if (!item.quantity || item.quantity <= 0) errors.push('Quantity must be greater than 0');
    if (!item.unit?.trim()) errors.push('Unit is required');
    if (!item.category?.trim()) errors.push('Category is required');
    
    return {
      isValid: errors.length === 0,
      errors
    };
  };

  // Convert AI response to editable items
  const convertToEditableItems = (aiItems: AIExtractedItem[]): EditableBOMItem[] => {
    return aiItems.map((item, index) => {
      // Smart make matching: only use predefined makes from vendor DB
      let makeName = 'unspecified';
      
      if (item.make && typeof item.make === 'string') {
        // Clean the AI response (remove repeated patterns)
        const cleanedMake = item.make
          .replace(/(.+?)\1+/g, '$1') // Remove "KEYENCEKEYENCE" -> "KEYENCE"
          .trim()
          .substring(0, 50);
        
        // Find exact match in existing makes (case-insensitive)
        const exactMatch = existingMakes.find(existing => 
          existing.toLowerCase() === cleanedMake.toLowerCase()
        );
        
        if (exactMatch) {
          makeName = exactMatch;
        } else {
          // Try partial matching for common abbreviations
          const partialMatch = existingMakes.find(existing => {
            const existingLower = existing.toLowerCase();
            const cleanedLower = cleanedMake.toLowerCase();
            return existingLower.includes(cleanedLower) || cleanedLower.includes(existingLower);
          });
          
          if (partialMatch) {
            makeName = partialMatch;
          }
          // If no match found, keep as 'unspecified' - don't add to the list
        }
      }
      
      const editableItem: Partial<EditableBOMItem> = {
        id: `ai-${Date.now()}-${index}`,
        selected: true,
        name: item.name || '',
        make: makeName,
        sku: item.sku || '',
        description: item.description || item.name || '',
        quantity: item.quantity || 1,
        unit: item.unit || 'pcs',
        category: item.category || 'Uncategorized'
      };
      
      const validation = validateItem(editableItem);
      return {
        ...editableItem,
        isValid: validation.isValid,
        errors: validation.errors
      } as EditableBOMItem;
    });
  };

  // Analyze text with AI
  const handleAnalyze = async () => {
    if (!textContent.trim()) {
      setError('Please enter some text content to analyze');
      return;
    }

    setIsAnalyzing(true);
    setError(null);
    
    try {
      const analysis = await analyzeBOMWithAI({
        text: textContent,
        existingCategories,
        existingMakes
      });
      
      const editableItems = convertToEditableItems(analysis.items);
      setEditableItems(editableItems);
      setShowTable(true);
      
    } catch (err: any) {
      setError(err.message || 'Failed to analyze text content. Please try again.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Update editable item
  const updateEditableItem = (id: string, updates: Partial<EditableBOMItem>) => {
    setEditableItems(prev => prev.map(item => {
      if (item.id === id) {
        const updatedItem = { ...item, ...updates };
        const validation = validateItem(updatedItem);
        return {
          ...updatedItem,
          isValid: validation.isValid,
          errors: validation.errors
        };
      }
      return item;
    }));
  };

  // Toggle item selection
  const toggleItemSelection = (id: string, selected: boolean) => {
    setEditableItems(prev => prev.map(item => 
      item.id === id ? { ...item, selected } : item
    ));
  };

  // Select all/none items
  const toggleAllItems = (selected: boolean) => {
    setEditableItems(prev => prev.map(item => ({ ...item, selected })));
  };

  // Add new empty row
  const addNewRow = () => {
    const newItem: EditableBOMItem = {
      id: `manual-${Date.now()}`,
      selected: true,
      name: '',
      make: 'unspecified',
      sku: '',
      description: '',
      quantity: 1,
      unit: 'pcs',
      category: existingCategories[0] || 'Uncategorized',
      isValid: false,
      errors: ['Name is required', 'Category is required']
    };
    setEditableItems(prev => [...prev, newItem]);
  };

  // Remove row
  const removeRow = (id: string) => {
    setEditableItems(prev => prev.filter(item => item.id !== id));
  };

  // Import selected valid items
  const handleImport = async () => {
    if (!projectId) return;
    
    const selectedItems = editableItems.filter(item => item.selected && item.isValid);
    if (selectedItems.length === 0) {
      setError('Please select at least one valid item to import');
      return;
    }
    
    setIsImporting(true);
    try {
      const bomItems: BOMItem[] = selectedItems.map((item, index) => ({
        id: `imported-${Date.now()}-${index}`,
        name: item.name,
        make: item.make,
        description: item.description || item.name,
        sku: item.sku,
        category: item.category,
        quantity: item.quantity,
        vendors: [],
        status: 'not-ordered' as any,
      }));

      onImportComplete(bomItems);
      handleClose();
      
    } catch (err: any) {
      setError(err.message || 'Failed to import items');
    } finally {
      setIsImporting(false);
    }
  };

  const handleClose = () => {
    setTextContent('');
    setEditableItems([]);
    setError(null);
    setIsAnalyzing(false);
    setIsImporting(false);
    setShowTable(false);
    onOpenChange(false);
  };

  const selectedCount = editableItems.filter(item => item.selected).length;
  const validSelectedCount = editableItems.filter(item => item.selected && item.isValid).length;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="@container max-w-6xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Import BOM with AI</DialogTitle>
          <DialogDescription>
            Paste your BOM text content to automatically extract and edit items using AI analysis.
          </DialogDescription>
        </DialogHeader>

        {!showTable ? (
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>BOM Text Content</CardTitle>
                <CardDescription>
                  Copy and paste your BOM content. Convert PDFs to text first if needed.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Label htmlFor="bom-text">BOM Content</Label>
                <Textarea
                  id="bom-text"
                  placeholder="Paste your BOM content here...

Example:
1. Motor, Siemens, 3-phase 2HP, Qty: 2
2. Sensor, Omron, Proximity sensor, Qty: 4
3. Bracket, Steel mounting bracket, Qty: 8"
                  value={textContent}
                  onChange={(e) => setTextContent(e.target.value)}
                  className="min-h-[300px]"
                />
              </CardContent>
            </Card>

            {error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            
            <div className="flex justify-end gap-2 pt-4">
              <Button variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button 
                onClick={handleAnalyze}
                disabled={isAnalyzing || !textContent.trim()}
                className="bg-blue-600 hover:bg-blue-700"
              >
                {isAnalyzing ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Analyzing with AI...
                  </>
                ) : (
                  <>
                    <Check className="mr-2 h-4 w-4" />
                    Analyze with AI
                  </>
                )}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Editable Table Section */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>Edit BOM Items</CardTitle>
                    <CardDescription>
                      Review and modify the AI-extracted items. Select items to import.
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={addNewRow}>
                      <Plus className="h-4 w-4 mr-2" />
                      Add Row
                    </Button>
                    <Button 
                      variant="outline" 
                      size="sm" 
                      onClick={() => toggleAllItems(selectedCount !== editableItems.length)}
                    >
                      {selectedCount === editableItems.length ? 'Unselect All' : 'Select All'}
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="border rounded-lg">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-12">Select</TableHead>
                        <TableHead className="w-48">Name*</TableHead>
                        <TableHead className="w-32">Make</TableHead>
                        <TableHead className="w-32">SKU</TableHead>
                        <TableHead className="w-48">Description</TableHead>
                        <TableHead className="w-24">Qty*</TableHead>
                        <TableHead className="w-24">Unit*</TableHead>
                        <TableHead className="w-32">Category*</TableHead>
                        <TableHead className="w-12">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {editableItems.map((item) => (
                        <TableRow key={item.id} className={!item.isValid ? 'bg-red-50' : ''}>
                          <TableCell>
                            <Checkbox
                              checked={item.selected}
                              onCheckedChange={(checked) => toggleItemSelection(item.id, !!checked)}
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              value={item.name}
                              onChange={(e) => updateEditableItem(item.id, { name: e.target.value })}
                              className={!item.name.trim() ? 'border-red-300' : ''}
                            />
                          </TableCell>
                          <TableCell>
                            <Select
                              value={item.make}
                              onValueChange={(value) => updateEditableItem(item.id, { make: value })}
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="unspecified">None</SelectItem>
                                {existingMakes
                                  .filter(make => make !== 'unspecified')
                                  .map((make) => (
                                    <SelectItem key={make} value={make}>{make}</SelectItem>
                                  ))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell>
                            <Input
                              value={item.sku}
                              onChange={(e) => updateEditableItem(item.id, { sku: e.target.value })}
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              value={item.description}
                              onChange={(e) => updateEditableItem(item.id, { description: e.target.value })}
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              min="1"
                              value={item.quantity}
                              onChange={(e) => updateEditableItem(item.id, { quantity: parseInt(e.target.value) || 1 })}
                              className={item.quantity <= 0 ? 'border-red-300' : ''}
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              value={item.unit}
                              onChange={(e) => updateEditableItem(item.id, { unit: e.target.value })}
                              className={!item.unit.trim() ? 'border-red-300' : ''}
                            />
                          </TableCell>
                          <TableCell>
                            <Select
                              value={item.category}
                              onValueChange={(value) => updateEditableItem(item.id, { category: value })}
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {existingCategories.map((category) => (
                                  <SelectItem key={category} value={category}>{category}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => removeRow(item.id)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                
                {editableItems.some(item => !item.isValid) && (
                  <Alert className="mt-4">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>
                      Some items have validation errors (highlighted in red). Fix errors before importing.
                    </AlertDescription>
                  </Alert>
                )}
                
                <div className="mt-4 text-sm text-gray-600">
                  {selectedCount} of {editableItems.length} items selected • {validSelectedCount} valid items ready to import
                </div>
              </CardContent>
            </Card>

            {error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowTable(false)}>
                Back to Text Input
              </Button>
              <Button 
                onClick={handleImport}
                disabled={isImporting || validSelectedCount === 0}
                className="bg-green-600 hover:bg-green-700"
              >
                {isImporting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Importing...
                  </>
                ) : (
                  <>
                    <Check className="mr-2 h-4 w-4" />
                    Import {validSelectedCount} Items
                  </>
                )}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default ImportBOMDialog;