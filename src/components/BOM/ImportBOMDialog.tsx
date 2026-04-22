import React, { useState } from 'react';
import { Loader2, Check, AlertCircle, Plus, Trash2 } from 'lucide-react';
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
import { BOMItem } from '@/types/bom';
import { getBOMSettings } from '@/utils/settingsFirestore';
import { getBrands } from '@/utils/brandFirestore';
import { analyzeBOMWithAI, ExtractedBOMItem as AIExtractedItem } from '@/utils/aiService';

const UOM_OPTIONS = ['pcs', 'nos', 'sets', 'kg', 'g', 'm', 'mm', 'cm', 'sqm', 'l', 'ml', 'hrs', 'days', 'lot'];

const cleanText = (text: string): string => {
  if (!text) return '';
  return text
    .replace(/^["'"“”‘’]+|["'"“”‘’]+$/g, '')
    .replace(/^[₹\s,]+|[₹\s,]+$/g, '')
    .replace(/^\s+|\s+$/g, '')
    .trim();
};

interface ImportBOMDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string | null;
  onImportComplete: (items: BOMItem[]) => void;
}

interface EditableBOMItem {
  id: string;
  selected: boolean;
  itemType: 'component' | 'service';
  name: string;
  make: string;
  sku: string;
  description: string;
  quantity: number;
  price?: number;
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
        const [settings, brands] = await Promise.all([
          getBOMSettings(),
          getBrands()
        ]);

        setBomSettings(settings);
        if (settings?.defaultCategories) {
          setExistingCategories(settings.defaultCategories);
        }

        // Extract brand names (active brands only) - these are the manufacturers/makes
        const brandNames = brands
          .filter(brand => brand.status === 'active')
          .map(brand => brand.name)
          .filter(name => name && name.trim() !== '');

        setExistingMakes(brandNames);
        console.log('Loaded brands for makes:', brandNames);
        
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
    const minQuantity = item.itemType === 'service' ? 0.5 : 1;
    if (!item.quantity || item.quantity < minQuantity) {
      errors.push(item.itemType === 'service' ? 'Mandays must be at least 0.5' : 'Quantity must be at least 1');
    }
    if (!item.unit?.trim()) errors.push('Unit is required');
    if (!item.category?.trim()) {
      errors.push('Category is required');
    } else if (existingCategories.length > 0 && !existingCategories.includes(item.category)) {
      errors.push(`Category "${item.category}" is not in the canonical list`);
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  };

  // Convert AI response to editable items
  const convertToEditableItems = (aiItems: AIExtractedItem[]): EditableBOMItem[] => {
    return aiItems
      .filter(item => {
        const name = cleanText(item.name || '');
        return name.length > 0;
      })
      .map((item, index) => {
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

      // Category validation: MUST use canonical categories only
      let categoryName = 'Uncategorized';
      if (item.category && typeof item.category === 'string') {
        // Find exact match in existing categories (case-insensitive)
        const exactCategoryMatch = existingCategories.find(existing =>
          existing.toLowerCase() === item.category.toLowerCase()
        );

        if (exactCategoryMatch) {
          categoryName = exactCategoryMatch;
        } else {
          // Try partial matching for similar categories
          const partialCategoryMatch = existingCategories.find(existing => {
            const existingLower = existing.toLowerCase();
            const aiCategoryLower = item.category.toLowerCase();
            return existingLower.includes(aiCategoryLower) || aiCategoryLower.includes(existingLower);
          });

          if (partialCategoryMatch) {
            categoryName = partialCategoryMatch;
          }
          // If no match, defaults to 'Uncategorized' - ensures canonical categories only
          console.warn(`AI suggested non-canonical category "${item.category}" for item "${item.name}", defaulting to "${categoryName}"`);
        }
      }

      // Ensure the category exists in the list, fallback to first available or 'Uncategorized'
      if (!existingCategories.includes(categoryName)) {
        categoryName = existingCategories.find(c => c.toLowerCase() === 'uncategorized')
          || existingCategories[0]
          || 'Uncategorized';
      }

      const qty = item.quantity || 1;
      const isService = item.itemType === 'service';
      const editableItem: Partial<EditableBOMItem> = {
        id: `ai-${Date.now()}-${index}`,
        selected: qty > 0,
        itemType: isService ? 'service' : 'component',
        name: cleanText(item.name || ''),
        make: makeName,
        sku: cleanText(item.sku || ''),
        description: cleanText(item.description || item.name || ''),
        quantity: qty,
        price: typeof item.price === 'number' && Number.isFinite(item.price) && item.price > 0 ? item.price : undefined,
        unit: isService ? (item.unit || 'days') : (item.unit || 'pcs'),
        category: categoryName
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
      itemType: 'component',
      name: '',
      make: 'unspecified',
      sku: '',
      description: '',
      quantity: 1,
      price: undefined,
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
        itemType: item.itemType,
        name: item.name,
        ...(item.itemType === 'component' && { make: item.make }),
        description: item.description || item.name,
        ...(item.itemType === 'component' && { sku: item.sku }),
        ...(item.price !== undefined && { price: item.price }),
        unit: item.unit || (item.itemType === 'service' ? 'days' : 'pcs'),
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
      <DialogContent className="@container max-w-6xl max-h-[90vh] flex flex-col">
        <DialogHeader className="flex-shrink-0">
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
          <div className="flex-1 flex flex-col overflow-hidden space-y-4">
            {/* Editable Table Section */}
            <Card className="flex-1 flex flex-col overflow-hidden">
              <CardHeader className="flex-shrink-0">
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
              <CardContent className="flex-1 overflow-y-auto p-0">
                <div className="overflow-x-auto border rounded-lg">
                  <Table className="min-w-[1300px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10 px-2">Select</TableHead>
                        <TableHead className="min-w-[200px]">Name*</TableHead>
                        <TableHead className="min-w-[120px]">Type*</TableHead>
                        <TableHead className="min-w-[140px]">Make</TableHead>
                        <TableHead className="min-w-[110px]">SKU</TableHead>
                        <TableHead className="min-w-[220px]">Description</TableHead>
                        <TableHead className="min-w-[90px]">Qty/Days*</TableHead>
                        <TableHead className="min-w-[110px]">Price/Rate</TableHead>
                        <TableHead className="min-w-[100px]">Unit*</TableHead>
                        <TableHead className="min-w-[150px]">Category*</TableHead>
                        <TableHead className="w-10 px-2">Del</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {editableItems.map((item) => (
                        <TableRow key={item.id} className={!item.isValid ? 'bg-red-50' : item.quantity === 0 ? 'bg-gray-50 opacity-60' : ''}>
                          <TableCell className="px-2">
                            <Checkbox
                              checked={item.selected}
                              onCheckedChange={(checked) => toggleItemSelection(item.id, !!checked)}
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              value={item.name}
                              onChange={(e) => updateEditableItem(item.id, { name: e.target.value })}
                              className={`min-w-[180px] ${!item.name.trim() ? 'border-red-300' : ''}`}
                            />
                          </TableCell>
                          <TableCell>
                            <Select
                              value={item.itemType}
                              onValueChange={(value: 'component' | 'service') =>
                                updateEditableItem(item.id, {
                                  itemType: value,
                                  make: value === 'service' ? 'unspecified' : item.make,
                                  sku: value === 'service' ? '' : item.sku,
                                  unit: value === 'service' ? 'days' : (item.unit === 'days' ? 'pcs' : item.unit)
                                })
                              }
                            >
                              <SelectTrigger className="min-w-[110px]">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="component">Component</SelectItem>
                                <SelectItem value="service">Service</SelectItem>
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell>
                            <Select
                              value={item.make}
                              onValueChange={(value) => updateEditableItem(item.id, { make: value })}
                              disabled={item.itemType === 'service'}
                            >
                              <SelectTrigger className="min-w-[130px]">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="unspecified">None</SelectItem>
                                {existingMakes
                                  .filter(make => make !== 'unspecified')
                                  .sort((a, b) => a.localeCompare(b))
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
                              disabled={item.itemType === 'service'}
                              className="min-w-[90px]"
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              value={item.description}
                              onChange={(e) => updateEditableItem(item.id, { description: e.target.value })}
                              className="min-w-[200px]"
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              step={item.itemType === 'service' ? '0.5' : '1'}
                              min={item.itemType === 'service' ? '0.5' : '0'}
                              value={item.quantity}
                              onChange={(e) => updateEditableItem(item.id, { quantity: Number(e.target.value) || 0 })}
                              className={`min-w-[75px] ${item.quantity <= 0 ? 'border-red-300' : ''}`}
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              min="0"
                              step="0.01"
                              value={item.price ?? ''}
                              onChange={(e) => updateEditableItem(item.id, {
                                price: e.target.value === '' ? undefined : Number(e.target.value)
                              })}
                              placeholder={item.itemType === 'service' ? 'Rate/day' : 'Unit price'}
                              className="min-w-[90px]"
                            />
                          </TableCell>
                          <TableCell>
                            <Select
                              value={item.unit || (item.itemType === 'service' ? 'days' : 'pcs')}
                              onValueChange={(value) => updateEditableItem(item.id, { unit: value })}
                            >
                              <SelectTrigger className="min-w-[85px]">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {UOM_OPTIONS.map((u) => (
                                  <SelectItem key={u} value={u}>{u}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell>
                            <Select
                              value={item.category}
                              onValueChange={(value) => updateEditableItem(item.id, { category: value })}
                            >
                              <SelectTrigger className="min-w-[140px]">
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
              <Alert variant="destructive" className="flex-shrink-0">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <div className="flex justify-end gap-2 flex-shrink-0 pt-2">
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