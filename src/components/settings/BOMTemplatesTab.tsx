import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Plus,
  Edit,
  Trash2,
  Save,
  X,
  Loader2,
  FileText,
  Package,
  Wrench,
  Copy,
  Star
} from 'lucide-react';
import { BOMTemplate, BOMTemplateItem, BOMItemType } from '@/types/bom';
import {
  subscribeToTemplates,
  addTemplate,
  updateTemplate,
  deleteTemplate,
  setDefaultTemplate,
  getBOMSettings,
  BOMSettings
} from '@/utils/settingsFirestore';
import { getBrands } from '@/utils/brandFirestore';
import { cleanFirestoreData } from '@/utils/firestoreHelpers';
import { toast } from '@/components/ui/use-toast';

interface BOMTemplatesTabProps {
  bomSettings: BOMSettings | null;
}

const BOMTemplatesTab = ({ bomSettings }: BOMTemplatesTabProps) => {
  const [templates, setTemplates] = useState<BOMTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Dialog states
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<BOMTemplate | null>(null);
  const [itemDialogOpen, setItemDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<BOMTemplateItem | null>(null);

  // Form states
  const [templateName, setTemplateName] = useState('');
  const [templateDescription, setTemplateDescription] = useState('');
  const [templateItems, setTemplateItems] = useState<BOMTemplateItem[]>([]);

  // Item form states
  const [itemName, setItemName] = useState('');
  const [itemDescription, setItemDescription] = useState('');
  const [itemCategory, setItemCategory] = useState('');
  const [itemType, setItemType] = useState<BOMItemType>('component');
  const [itemQuantity, setItemQuantity] = useState(1);
  const [itemPrice, setItemPrice] = useState<number | undefined>(undefined);
  const [itemMake, setItemMake] = useState('');
  const [itemSku, setItemSku] = useState('');

  // Available brands/makes for dropdown
  const [availableMakes, setAvailableMakes] = useState<string[]>([]);

  // Categories from BOM settings
  const categories = bomSettings?.defaultCategories || [];

  useEffect(() => {
    const unsubscribe = subscribeToTemplates((fetchedTemplates) => {
      setTemplates(fetchedTemplates);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // Load brands/makes for dropdown
  useEffect(() => {
    const loadBrands = async () => {
      try {
        const brandsData = await getBrands();
        // Extract brand names (active brands only) - these are the manufacturers/makes
        const brandNames = brandsData
          .filter(brand => brand.status === 'active')
          .map(brand => brand.name)
          .filter(name => name && name.trim() !== '');
        
        // Sort alphabetically and remove duplicates
        const sortedBrands = [...new Set(brandNames)].sort((a, b) => a.localeCompare(b));
        setAvailableMakes(sortedBrands);
      } catch (error) {
        console.error('Error loading brands:', error);
      }
    };

    loadBrands();
  }, []);

  const resetTemplateForm = () => {
    setTemplateName('');
    setTemplateDescription('');
    setTemplateItems([]);
    setEditingTemplate(null);
  };

  const resetItemForm = () => {
    setItemName('');
    setItemDescription('');
    setItemCategory(categories[0] || '');
    setItemType('component');
    setItemQuantity(1);
    setItemPrice(undefined);
    setItemMake('');
    setItemSku('');
    setEditingItem(null);
  };

  const handleOpenTemplateDialog = (template?: BOMTemplate) => {
    if (template) {
      setEditingTemplate(template);
      setTemplateName(template.name);
      setTemplateDescription(template.description || '');
      setTemplateItems([...template.items]);
    } else {
      resetTemplateForm();
    }
    setTemplateDialogOpen(true);
  };

  const handleCloseTemplateDialog = () => {
    setTemplateDialogOpen(false);
    resetTemplateForm();
  };

  const handleOpenItemDialog = (item?: BOMTemplateItem) => {
    if (item) {
      setEditingItem(item);
      setItemName(item.name);
      setItemDescription(item.description);
      setItemCategory(item.category);
      setItemType(item.itemType);
      setItemQuantity(item.quantity);
      setItemPrice(item.price);
      setItemMake(item.make || '');
      setItemSku(item.sku || '');
    } else {
      resetItemForm();
    }
    setItemDialogOpen(true);
  };

  const handleCloseItemDialog = () => {
    setItemDialogOpen(false);
    resetItemForm();
  };

  const handleSaveItem = () => {
    if (!itemName.trim() || !itemCategory) {
      toast({
        title: 'Validation Error',
        description: 'Name and category are required',
        variant: 'destructive'
      });
      return;
    }

    const newItem = cleanFirestoreData({
      id: editingItem?.id || `item-${Date.now()}`,
      itemType: itemType,
      name: itemName.trim(),
      description: itemDescription.trim() || itemName.trim(),
      category: itemCategory,
      quantity: itemQuantity,
      price: itemPrice,
      make: itemMake.trim() || undefined,
      sku: itemSku.trim() || undefined
    }) as BOMTemplateItem;

    if (editingItem) {
      setTemplateItems(prev => prev.map(item =>
        item.id === editingItem.id ? newItem : item
      ));
    } else {
      setTemplateItems(prev => [...prev, newItem]);
    }

    handleCloseItemDialog();
  };

  const handleRemoveItem = (itemId: string) => {
    setTemplateItems(prev => prev.filter(item => item.id !== itemId));
  };

  const handleSaveTemplate = async () => {
    if (!templateName.trim()) {
      toast({
        title: 'Validation Error',
        description: 'Template name is required',
        variant: 'destructive'
      });
      return;
    }

    setSaving(true);
    try {
      // Build template data object, only including description if it has a value
      const templateDataObj: any = {
        name: templateName.trim(),
        items: templateItems
      };
      
      // Only add description if it's not empty
      const trimmedDescription = templateDescription.trim();
      if (trimmedDescription) {
        templateDataObj.description = trimmedDescription;
      }
      
      const templateData = cleanFirestoreData(templateDataObj);

      if (editingTemplate) {
        await updateTemplate(editingTemplate.id, templateData);
        toast({
          title: 'Template Updated',
          description: `Template "${templateName}" has been updated`
        });
      } else {
        await addTemplate(templateData);
        toast({
          title: 'Template Created',
          description: `Template "${templateName}" has been created`
        });
      }

      handleCloseTemplateDialog();
    } catch (error) {
      console.error('Error saving template:', error);
      toast({
        title: 'Error',
        description: 'Failed to save template',
        variant: 'destructive'
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteTemplate = async (template: BOMTemplate) => {
    if (!confirm(`Are you sure you want to delete the template "${template.name}"?`)) {
      return;
    }

    try {
      await deleteTemplate(template.id);
      toast({
        title: 'Template Deleted',
        description: `Template "${template.name}" has been deleted`
      });
    } catch (error) {
      console.error('Error deleting template:', error);
      toast({
        title: 'Error',
        description: 'Failed to delete template',
        variant: 'destructive'
      });
    }
  };

  const handleDuplicateTemplate = async (template: BOMTemplate) => {
    setSaving(true);
    try {
      await addTemplate({
        name: `${template.name} (Copy)`,
        description: template.description,
        items: template.items.map(item => ({
          ...item,
          id: `item-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
        }))
      });
      toast({
        title: 'Template Duplicated',
        description: `Template "${template.name}" has been duplicated`
      });
    } catch (error) {
      console.error('Error duplicating template:', error);
      toast({
        title: 'Error',
        description: 'Failed to duplicate template',
        variant: 'destructive'
      });
    } finally {
      setSaving(false);
    }
  };

  const handleSetDefault = async (template: BOMTemplate) => {
    setSaving(true);
    try {
      // If template is already default, clear it
      if (template.isDefault) {
        await setDefaultTemplate(null);
        toast({
          title: 'Default Cleared',
          description: 'No default template is set'
        });
      } else {
        await setDefaultTemplate(template.id);
        toast({
          title: 'Default Set',
          description: `"${template.name}" is now the default template for new projects`
        });
      }
    } catch (error) {
      console.error('Error setting default template:', error);
      toast({
        title: 'Error',
        description: 'Failed to set default template',
        variant: 'destructive'
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>BOM Templates</CardTitle>
              <CardDescription>
                Create templates with pre-defined parts and services for new projects
              </CardDescription>
            </div>
            <Button onClick={() => handleOpenTemplateDialog()}>
              <Plus className="h-4 w-4 mr-2" />
              New Template
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {templates.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No templates yet. Create your first template to get started.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {templates.map((template) => (
                <Card key={template.id} className={`bg-secondary/30 ${template.isDefault ? 'ring-2 ring-yellow-500' : ''}`}>
                  <CardContent className="pt-4">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="font-semibold">{template.name}</h3>
                          {template.isDefault && (
                            <Badge variant="default" className="bg-yellow-500 text-white">
                              <Star className="h-3 w-3 mr-1 fill-current" />
                              Default
                            </Badge>
                          )}
                          <Badge variant="secondary">
                            {template.items.length} item{template.items.length !== 1 ? 's' : ''}
                          </Badge>
                        </div>
                        {template.description && (
                          <p className="text-sm text-muted-foreground mb-2">
                            {template.description}
                          </p>
                        )}
                        <div className="flex flex-wrap gap-1">
                          {template.items.slice(0, 5).map((item) => (
                            <Badge key={item.id} variant="outline" className="text-xs">
                              {item.itemType === 'service' ? (
                                <Wrench className="h-3 w-3 mr-1" />
                              ) : (
                                <Package className="h-3 w-3 mr-1" />
                              )}
                              {item.name}
                            </Badge>
                          ))}
                          {template.items.length > 5 && (
                            <Badge variant="outline" className="text-xs">
                              +{template.items.length - 5} more
                            </Badge>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleSetDefault(template)}
                          title={template.isDefault ? "Remove as default" : "Set as default"}
                          className={template.isDefault ? "text-yellow-600 hover:text-yellow-700" : ""}
                        >
                          <Star className={`h-4 w-4 ${template.isDefault ? 'fill-current' : ''}`} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDuplicateTemplate(template)}
                          title="Duplicate"
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleOpenTemplateDialog(template)}
                          title="Edit"
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDeleteTemplate(template)}
                          className="text-red-600 hover:text-red-700"
                          title="Delete"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Template Edit Dialog */}
      <Dialog open={templateDialogOpen} onOpenChange={setTemplateDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>
              {editingTemplate ? 'Edit Template' : 'Create New Template'}
            </DialogTitle>
            <DialogDescription>
              Define a template with parts and services that will be added to new projects
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto space-y-4 py-4">
            {/* Template Name & Description */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="templateName">Template Name *</Label>
                <Input
                  id="templateName"
                  value={templateName}
                  onChange={(e) => setTemplateName(e.target.value)}
                  placeholder="e.g., Standard Vision System"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="templateDescription">Description</Label>
                <Input
                  id="templateDescription"
                  value={templateDescription}
                  onChange={(e) => setTemplateDescription(e.target.value)}
                  placeholder="Brief description of the template"
                />
              </div>
            </div>

            {/* Items Section */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Template Items ({templateItems.length})</Label>
                <Button size="sm" onClick={() => handleOpenItemDialog()}>
                  <Plus className="h-4 w-4 mr-1" />
                  Add Item
                </Button>
              </div>

              {templateItems.length === 0 ? (
                <div className="border border-dashed rounded-lg p-8 text-center text-muted-foreground">
                  <Package className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p>No items yet. Add parts or services to this template.</p>
                </div>
              ) : (
                <div className="border rounded-lg overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Type</TableHead>
                        <TableHead>Name</TableHead>
                        <TableHead>Category</TableHead>
                        <TableHead className="text-right">Qty</TableHead>
                        <TableHead className="text-right">Price</TableHead>
                        <TableHead className="w-20">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {templateItems.map((item) => (
                        <TableRow key={item.id}>
                          <TableCell>
                            <Badge variant={item.itemType === 'service' ? 'secondary' : 'default'}>
                              {item.itemType === 'service' ? (
                                <><Wrench className="h-3 w-3 mr-1" /> Service</>
                              ) : (
                                <><Package className="h-3 w-3 mr-1" /> Part</>
                              )}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div>
                              <div className="font-medium">{item.name}</div>
                              {item.make && (
                                <div className="text-xs text-muted-foreground">{item.make}</div>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>{item.category}</TableCell>
                          <TableCell className="text-right">
                            {item.quantity} {item.itemType === 'service' ? 'days' : 'pcs'}
                          </TableCell>
                          <TableCell className="text-right">
                            {item.price ? `₹${item.price.toLocaleString('en-IN')}` : '-'}
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleOpenItemDialog(item)}
                              >
                                <Edit className="h-3 w-3" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleRemoveItem(item.id)}
                                className="text-red-600"
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button variant="outline" onClick={handleCloseTemplateDialog}>
              Cancel
            </Button>
            <Button onClick={handleSaveTemplate} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              <Save className="h-4 w-4 mr-2" />
              {editingTemplate ? 'Update Template' : 'Create Template'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Item Edit Dialog */}
      <Dialog open={itemDialogOpen} onOpenChange={setItemDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingItem ? 'Edit Item' : 'Add Item'}
            </DialogTitle>
            <DialogDescription>
              Add a part or service to the template
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Item Type</Label>
              <Select value={itemType} onValueChange={(v) => setItemType(v as BOMItemType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="component">
                    <div className="flex items-center gap-2">
                      <Package className="h-4 w-4" />
                      Component / Part
                    </div>
                  </SelectItem>
                  <SelectItem value="service">
                    <div className="flex items-center gap-2">
                      <Wrench className="h-4 w-4" />
                      Service
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="itemName">Name *</Label>
              <Input
                id="itemName"
                value={itemName}
                onChange={(e) => setItemName(e.target.value)}
                placeholder="e.g., Industrial Camera"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="itemDescription">Description</Label>
              <Textarea
                id="itemDescription"
                value={itemDescription}
                onChange={(e) => setItemDescription(e.target.value)}
                placeholder="Brief description"
                rows={2}
              />
            </div>

            <div className="space-y-2">
              <Label>Category *</Label>
              <Select value={itemCategory} onValueChange={setItemCategory}>
                <SelectTrigger>
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((cat) => (
                    <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="itemQuantity">
                  {itemType === 'service' ? 'Duration (days)' : 'Quantity'}
                </Label>
                <Input
                  id="itemQuantity"
                  type="number"
                  min="0.5"
                  step={itemType === 'service' ? '0.5' : '1'}
                  value={itemQuantity}
                  onChange={(e) => setItemQuantity(parseFloat(e.target.value) || 1)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="itemPrice">
                  {itemType === 'service' ? 'Rate/Day (₹)' : 'Unit Price (₹)'}
                </Label>
                <Input
                  id="itemPrice"
                  type="number"
                  min="0"
                  value={itemPrice || ''}
                  onChange={(e) => setItemPrice(parseFloat(e.target.value) || undefined)}
                  placeholder="Optional"
                />
              </div>
            </div>

            {itemType === 'component' && (
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="itemMake">Make / Brand</Label>
                  <Select
                    value={itemMake || undefined}
                    onValueChange={(value) => setItemMake(value === "__NONE__" ? '' : (value || ''))}
                  >
                    <SelectTrigger id="itemMake">
                      <SelectValue placeholder="Select Make/Brand" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__NONE__">None</SelectItem>
                      {availableMakes.length === 0 && (
                        <SelectItem value="__NO_BRANDS__" disabled>No brands found. Add brands in Settings.</SelectItem>
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
                <div className="space-y-2">
                  <Label htmlFor="itemSku">SKU / Part No.</Label>
                  <Input
                    id="itemSku"
                    value={itemSku}
                    onChange={(e) => setItemSku(e.target.value)}
                    placeholder="e.g., CV-X420F"
                  />
                </div>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button variant="outline" onClick={handleCloseItemDialog}>
              Cancel
            </Button>
            <Button onClick={handleSaveItem}>
              {editingItem ? 'Update Item' : 'Add Item'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default BOMTemplatesTab;
