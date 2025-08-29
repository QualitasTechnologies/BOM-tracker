import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { 
  User, 
  Users,
  Package,
  ShoppingCart,
  Settings as SettingsIcon,
  Plus,
  Edit,
  Trash2,
  Save,
  X,
  Building,
  Mail,
  Phone,
  MapPin,
  Loader2
} from 'lucide-react';
import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogHeader, 
  DialogTitle, 
  DialogTrigger 
} from '@/components/ui/dialog';
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from '@/components/ui/table';
import { 
  Client, 
  Vendor, 
  BOMSettings,
  BOMCategory,
  addClient,
  updateClient,
  deleteClient,
  subscribeToClients,
  addVendor,
  updateVendor,
  deleteVendor,
  subscribeToVendors,
  getBOMSettings,
  updateBOMSettings,
  subscribeToBOMSettings,
  initializeDefaultBOMSettings,
  validateClient,
  validateVendor
} from '@/utils/settingsFirestore';
import { Alert, AlertDescription } from '@/components/ui/alert';

const Settings = () => {
  // State management
  const [clients, setClients] = useState<Client[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [bomSettings, setBomSettings] = useState<BOMSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Dialog states
  const [clientDialog, setClientDialog] = useState(false);
  const [vendorDialog, setVendorDialog] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [editingVendor, setEditingVendor] = useState<Vendor | null>(null);

  // Form states
  const [clientForm, setClientForm] = useState<Partial<Client>>({});
  const [vendorForm, setVendorForm] = useState<Partial<Vendor>>({});
  const [formErrors, setFormErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  // Load data on component mount
  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      try {
        // Initialize BOM settings if they don't exist
        await initializeDefaultBOMSettings();
        
        // Subscribe to real-time updates
        const unsubscribeClients = subscribeToClients(setClients);
        const unsubscribeVendors = subscribeToVendors(setVendors);
        const unsubscribeBOMSettings = subscribeToBOMSettings(setBomSettings);
        
        setLoading(false);
        
        // Cleanup function
        return () => {
          unsubscribeClients();
          unsubscribeVendors();
          unsubscribeBOMSettings();
        };
      } catch (err: any) {
        setError(err.message || 'Failed to load settings data');
        setLoading(false);
      }
    };

    const cleanup = loadData();
    return () => {
      cleanup?.then(cleanupFn => cleanupFn && cleanupFn());
    };
  }, []);

  // Client management functions
  const handleAddClient = async () => {
    const errors = validateClient(clientForm);
    if (errors.length > 0) {
      setFormErrors(errors);
      return;
    }

    setSaving(true);
    try {
      await addClient({
        name: clientForm.name || '',
        company: clientForm.company || '',
        email: clientForm.email || '',
        phone: clientForm.phone || '',
        address: clientForm.address || '',
        contactPerson: clientForm.contactPerson || '',
        status: 'active',
        notes: clientForm.notes
      });
      
      setClientForm({});
      setClientDialog(false);
      setFormErrors([]);
    } catch (err: any) {
      setError(err.message || 'Failed to add client');
    }
    setSaving(false);
  };

  const handleEditClient = (client: Client) => {
    setEditingClient(client);
    setClientForm(client);
    setFormErrors([]);
    setClientDialog(true);
  };

  const handleUpdateClient = async () => {
    if (!editingClient) return;
    
    const errors = validateClient(clientForm);
    if (errors.length > 0) {
      setFormErrors(errors);
      return;
    }

    setSaving(true);
    try {
      await updateClient(editingClient.id, clientForm);
      
      setEditingClient(null);
      setClientForm({});
      setClientDialog(false);
      setFormErrors([]);
    } catch (err: any) {
      setError(err.message || 'Failed to update client');
    }
    setSaving(false);
  };

  const handleDeleteClient = async (clientId: string) => {
    if (!confirm('Are you sure you want to delete this client?')) return;
    
    try {
      await deleteClient(clientId);
    } catch (err: any) {
      setError(err.message || 'Failed to delete client');
    }
  };

  // Vendor management functions
  const handleAddVendor = async () => {
    const errors = validateVendor(vendorForm);
    if (errors.length > 0) {
      setFormErrors(errors);
      return;
    }

    setSaving(true);
    try {
      await addVendor({
        name: vendorForm.name || '',
        company: vendorForm.company || '',
        email: vendorForm.email || '',
        phone: vendorForm.phone || '',
        address: vendorForm.address || '',
        contactPerson: vendorForm.contactPerson || '',
        website: vendorForm.website,
        paymentTerms: vendorForm.paymentTerms || 'Net 30',
        leadTime: vendorForm.leadTime || '2 weeks',
        rating: vendorForm.rating || 0,
        status: 'active',
        specialties: vendorForm.specialties || [],
        notes: vendorForm.notes
      });
      
      setVendorForm({});
      setVendorDialog(false);
      setFormErrors([]);
    } catch (err: any) {
      setError(err.message || 'Failed to add vendor');
    }
    setSaving(false);
  };

  const handleEditVendor = (vendor: Vendor) => {
    setEditingVendor(vendor);
    setVendorForm(vendor);
    setFormErrors([]);
    setVendorDialog(true);
  };

  const handleUpdateVendor = async () => {
    if (!editingVendor) return;
    
    const errors = validateVendor(vendorForm);
    if (errors.length > 0) {
      setFormErrors(errors);
      return;
    }

    setSaving(true);
    try {
      await updateVendor(editingVendor.id, vendorForm);
      
      setEditingVendor(null);
      setVendorForm({});
      setVendorDialog(false);
      setFormErrors([]);
    } catch (err: any) {
      setError(err.message || 'Failed to update vendor');
    }
    setSaving(false);
  };

  const handleDeleteVendor = async (vendorId: string) => {
    if (!confirm('Are you sure you want to delete this vendor?')) return;
    
    try {
      await deleteVendor(vendorId);
    } catch (err: any) {
      setError(err.message || 'Failed to delete vendor');
    }
  };

  // BOM Settings functions
  const handleSaveBOMSettings = async () => {
    if (!bomSettings) return;
    
    setSaving(true);
    try {
      await updateBOMSettings(bomSettings);
    } catch (err: any) {
      setError(err.message || 'Failed to save BOM settings');
    }
    setSaving(false);
  };

  const addCategory = async (newCategory: string) => {
    if (!bomSettings || !newCategory.trim()) return;
    
    const currentCategories = bomSettings.categories || [];
    const newEnhancedCategory = {
      id: Date.now().toString(),
      name: newCategory.trim(),
      order: currentCategories.length + 1,
      isActive: true,
      color: '#9CA3AF'
    };
    
    const updatedCategories = [...currentCategories, newEnhancedCategory];
    const updatedSettings = {
      ...bomSettings,
      categories: updatedCategories,
      defaultCategories: updatedCategories.filter(cat => !cat.parentId).map(cat => cat.name)
    };
    
    setBomSettings(updatedSettings);
    
    try {
      await updateBOMSettings(updatedSettings);
    } catch (err: any) {
      setError(err.message || 'Failed to save category');
    }
  };

  const removeCategory = async (index: number) => {
    if (!bomSettings) return;
    
    const currentCategories = bomSettings.categories || [];
    const parentCategories = currentCategories.filter(cat => !cat.parentId);
    const categoryToRemove = parentCategories[index]?.name;
    
    if (!categoryToRemove) return;
    
    const updatedCategories = currentCategories.filter(cat => cat.name !== categoryToRemove);
    const updatedSettings = {
      ...bomSettings,
      categories: updatedCategories,
      defaultCategories: updatedCategories.filter(cat => !cat.parentId).map(cat => cat.name)
    };
    
    setBomSettings(updatedSettings);
    
    try {
      await updateBOMSettings(updatedSettings);
    } catch (err: any) {
      setError(err.message || 'Failed to remove category');
    }
  };

  if (loading) {
    return (
      <div className="container mx-auto py-6 px-4">
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4" />
            <p>Loading settings...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-6 px-4">
      <div className="max-w-6xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Settings</h1>
          <p className="text-gray-600 mt-2">Manage your system configuration and preferences</p>
        </div>

        {error && (
          <Alert variant="destructive" className="mb-6">
            <AlertDescription>{error}</AlertDescription>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={() => setError(null)}
              className="mt-2"
            >
              Dismiss
            </Button>
          </Alert>
        )}

        <Tabs defaultValue="clients" className="space-y-6">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="clients" className="flex items-center gap-2">
              <Users size={16} />
              Clients ({clients.length})
            </TabsTrigger>
            <TabsTrigger value="vendors" className="flex items-center gap-2">
              <ShoppingCart size={16} />
              Vendors ({vendors.length})
            </TabsTrigger>
            <TabsTrigger value="bom" className="flex items-center gap-2">
              <Package size={16} />
              BOM Settings
            </TabsTrigger>
            <TabsTrigger value="general" className="flex items-center gap-2">
              <SettingsIcon size={16} />
              General
            </TabsTrigger>
          </TabsList>

          {/* Clients Tab */}
          <TabsContent value="clients">
            <Card>
              <CardHeader>
                <div className="flex justify-between items-center">
                  <div>
                    <CardTitle>Client Management</CardTitle>
                    <CardDescription>Manage your client contacts and information</CardDescription>
                  </div>
                  <Dialog open={clientDialog} onOpenChange={setClientDialog}>
                    <DialogTrigger asChild>
                      <Button onClick={() => {
                        setEditingClient(null);
                        setClientForm({});
                        setFormErrors([]);
                      }}>
                        <Plus size={16} className="mr-2" />
                        Add Client
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-2xl">
                      <DialogHeader>
                        <DialogTitle>
                          {editingClient ? 'Edit Client' : 'Add New Client'}
                        </DialogTitle>
                        <DialogDescription>
                          {editingClient ? 'Update client information' : 'Add a new client to your system'}
                        </DialogDescription>
                      </DialogHeader>

                      {formErrors.length > 0 && (
                        <Alert variant="destructive">
                          <AlertDescription>
                            <ul className="list-disc list-inside">
                              {formErrors.map((error, index) => (
                                <li key={index}>{error}</li>
                              ))}
                            </ul>
                          </AlertDescription>
                        </Alert>
                      )}

                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="clientName">Client Name *</Label>
                          <Input
                            id="clientName"
                            value={clientForm.name || ''}
                            onChange={(e) => setClientForm({...clientForm, name: e.target.value})}
                            placeholder="Enter client name"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="company">Company *</Label>
                          <Input
                            id="company"
                            value={clientForm.company || ''}
                            onChange={(e) => setClientForm({...clientForm, company: e.target.value})}
                            placeholder="Enter company name"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="email">Email</Label>
                          <Input
                            id="email"
                            type="email"
                            value={clientForm.email || ''}
                            onChange={(e) => setClientForm({...clientForm, email: e.target.value})}
                            placeholder="Enter email address"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="phone">Phone</Label>
                          <Input
                            id="phone"
                            value={clientForm.phone || ''}
                            onChange={(e) => setClientForm({...clientForm, phone: e.target.value})}
                            placeholder="Enter phone number"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="contactPerson">Contact Person</Label>
                          <Input
                            id="contactPerson"
                            value={clientForm.contactPerson || ''}
                            onChange={(e) => setClientForm({...clientForm, contactPerson: e.target.value})}
                            placeholder="Enter contact person name"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="address">Address</Label>
                          <Input
                            id="address"
                            value={clientForm.address || ''}
                            onChange={(e) => setClientForm({...clientForm, address: e.target.value})}
                            placeholder="Enter address"
                          />
                        </div>
                        <div className="col-span-2 space-y-2">
                          <Label htmlFor="notes">Notes</Label>
                          <Textarea
                            id="notes"
                            value={clientForm.notes || ''}
                            onChange={(e) => setClientForm({...clientForm, notes: e.target.value})}
                            placeholder="Additional notes about the client"
                          />
                        </div>
                      </div>
                      <div className="flex justify-end gap-2 mt-6">
                        <Button
                          onClick={editingClient ? handleUpdateClient : handleAddClient}
                          disabled={saving}
                        >
                          {saving && <Loader2 size={16} className="mr-2 animate-spin" />}
                          <Save size={16} className="mr-2" />
                          {editingClient ? 'Update' : 'Add'} Client
                        </Button>
                        <Button variant="outline" onClick={() => setClientDialog(false)}>
                          Cancel
                        </Button>
                      </div>
                    </DialogContent>
                  </Dialog>
                </div>
              </CardHeader>
              <CardContent>
                {clients.length === 0 ? (
                  <div className="text-center py-8">
                    <Users className="mx-auto h-12 w-12 text-gray-400 mb-4" />
                    <p className="text-gray-500">No clients added yet</p>
                    <p className="text-gray-400 text-sm">Add your first client to get started</p>
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Client</TableHead>
                        <TableHead>Contact Info</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {clients.map((client) => (
                        <TableRow key={client.id}>
                          <TableCell>
                            <div>
                              <div className="font-medium">{client.name}</div>
                              <div className="text-sm text-muted-foreground">{client.company}</div>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="space-y-1">
                              {client.email && (
                                <div className="flex items-center gap-1 text-sm">
                                  <Mail size={12} />
                                  {client.email}
                                </div>
                              )}
                              {client.phone && (
                                <div className="flex items-center gap-1 text-sm">
                                  <Phone size={12} />
                                  {client.phone}
                                </div>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant={client.status === 'active' ? 'default' : 'secondary'}>
                              {client.status}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleEditClient(client)}
                              >
                                <Edit size={14} />
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleDeleteClient(client.id)}
                              >
                                <Trash2 size={14} />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Vendors Tab */}
          <TabsContent value="vendors">
            <Card>
              <CardHeader>
                <div className="flex justify-between items-center">
                  <div>
                    <CardTitle>Vendor Management</CardTitle>
                    <CardDescription>Manage your vendor database and supplier information</CardDescription>
                  </div>
                  <Dialog open={vendorDialog} onOpenChange={setVendorDialog}>
                    <DialogTrigger asChild>
                      <Button onClick={() => {
                        setEditingVendor(null);
                        setVendorForm({});
                        setFormErrors([]);
                      }}>
                        <Plus size={16} className="mr-2" />
                        Add Vendor
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-3xl">
                      <DialogHeader>
                        <DialogTitle>
                          {editingVendor ? 'Edit Vendor' : 'Add New Vendor'}
                        </DialogTitle>
                        <DialogDescription>
                          {editingVendor ? 'Update vendor information' : 'Add a new vendor to your supplier database'}
                        </DialogDescription>
                      </DialogHeader>

                      {formErrors.length > 0 && (
                        <Alert variant="destructive">
                          <AlertDescription>
                            <ul className="list-disc list-inside">
                              {formErrors.map((error, index) => (
                                <li key={index}>{error}</li>
                              ))}
                            </ul>
                          </AlertDescription>
                        </Alert>
                      )}

                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="vendorName">Vendor Name *</Label>
                          <Input
                            id="vendorName"
                            value={vendorForm.name || ''}
                            onChange={(e) => setVendorForm({...vendorForm, name: e.target.value})}
                            placeholder="Enter vendor name"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="vendorCompany">Company *</Label>
                          <Input
                            id="vendorCompany"
                            value={vendorForm.company || ''}
                            onChange={(e) => setVendorForm({...vendorForm, company: e.target.value})}
                            placeholder="Enter company name"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="vendorEmail">Email</Label>
                          <Input
                            id="vendorEmail"
                            type="email"
                            value={vendorForm.email || ''}
                            onChange={(e) => setVendorForm({...vendorForm, email: e.target.value})}
                            placeholder="Enter email address"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="vendorPhone">Phone</Label>
                          <Input
                            id="vendorPhone"
                            value={vendorForm.phone || ''}
                            onChange={(e) => setVendorForm({...vendorForm, phone: e.target.value})}
                            placeholder="Enter phone number"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="vendorContact">Contact Person</Label>
                          <Input
                            id="vendorContact"
                            value={vendorForm.contactPerson || ''}
                            onChange={(e) => setVendorForm({...vendorForm, contactPerson: e.target.value})}
                            placeholder="Enter contact person name"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="website">Website</Label>
                          <Input
                            id="website"
                            value={vendorForm.website || ''}
                            onChange={(e) => setVendorForm({...vendorForm, website: e.target.value})}
                            placeholder="Enter website URL"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="paymentTerms">Payment Terms</Label>
                          <Select 
                            value={vendorForm.paymentTerms || 'Net 30'} 
                            onValueChange={(value) => setVendorForm({...vendorForm, paymentTerms: value})}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="Net 15">Net 15</SelectItem>
                              <SelectItem value="Net 30">Net 30</SelectItem>
                              <SelectItem value="Net 45">Net 45</SelectItem>
                              <SelectItem value="Net 60">Net 60</SelectItem>
                              <SelectItem value="COD">Cash on Delivery</SelectItem>
                              <SelectItem value="Prepaid">Prepaid</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="leadTime">Lead Time</Label>
                          <Input
                            id="leadTime"
                            value={vendorForm.leadTime || ''}
                            onChange={(e) => setVendorForm({...vendorForm, leadTime: e.target.value})}
                            placeholder="e.g., 2 weeks"
                          />
                        </div>
                        <div className="col-span-2 space-y-2">
                          <Label htmlFor="vendorAddress">Address</Label>
                          <Input
                            id="vendorAddress"
                            value={vendorForm.address || ''}
                            onChange={(e) => setVendorForm({...vendorForm, address: e.target.value})}
                            placeholder="Enter complete address"
                          />
                        </div>
                        <div className="col-span-2 space-y-2">
                          <Label htmlFor="vendorNotes">Notes</Label>
                          <Textarea
                            id="vendorNotes"
                            value={vendorForm.notes || ''}
                            onChange={(e) => setVendorForm({...vendorForm, notes: e.target.value})}
                            placeholder="Additional notes about the vendor"
                          />
                        </div>
                      </div>
                      <div className="flex justify-end gap-2 mt-6">
                        <Button
                          onClick={editingVendor ? handleUpdateVendor : handleAddVendor}
                          disabled={saving}
                        >
                          {saving && <Loader2 size={16} className="mr-2 animate-spin" />}
                          <Save size={16} className="mr-2" />
                          {editingVendor ? 'Update' : 'Add'} Vendor
                        </Button>
                        <Button variant="outline" onClick={() => setVendorDialog(false)}>
                          Cancel
                        </Button>
                      </div>
                    </DialogContent>
                  </Dialog>
                </div>
              </CardHeader>
              <CardContent>
                {vendors.length === 0 ? (
                  <div className="text-center py-8">
                    <ShoppingCart className="mx-auto h-12 w-12 text-gray-400 mb-4" />
                    <p className="text-gray-500">No vendors added yet</p>
                    <p className="text-gray-400 text-sm">Add your first vendor to get started</p>
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Vendor</TableHead>
                        <TableHead>Contact Info</TableHead>
                        <TableHead>Terms</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {vendors.map((vendor) => (
                        <TableRow key={vendor.id}>
                          <TableCell>
                            <div>
                              <div className="font-medium">{vendor.name}</div>
                              <div className="text-sm text-muted-foreground">{vendor.company}</div>
                              {vendor.specialties.length > 0 && (
                                <div className="flex gap-1 mt-1">
                                  {vendor.specialties.slice(0, 2).map((specialty, index) => (
                                    <Badge key={index} variant="outline" className="text-xs">
                                      {specialty}
                                    </Badge>
                                  ))}
                                  {vendor.specialties.length > 2 && (
                                    <Badge variant="outline" className="text-xs">
                                      +{vendor.specialties.length - 2}
                                    </Badge>
                                  )}
                                </div>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="space-y-1">
                              {vendor.email && (
                                <div className="flex items-center gap-1 text-sm">
                                  <Mail size={12} />
                                  {vendor.email}
                                </div>
                              )}
                              {vendor.phone && (
                                <div className="flex items-center gap-1 text-sm">
                                  <Phone size={12} />
                                  {vendor.phone}
                                </div>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="space-y-1 text-sm">
                              <div>{vendor.paymentTerms}</div>
                              <div className="text-muted-foreground">{vendor.leadTime}</div>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant={vendor.status === 'active' ? 'default' : 'secondary'}>
                              {vendor.status}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleEditVendor(vendor)}
                              >
                                <Edit size={14} />
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleDeleteVendor(vendor.id)}
                              >
                                <Trash2 size={14} />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* BOM Settings Tab */}
          <TabsContent value="bom">
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Default Categories</CardTitle>
                  <CardDescription>Manage default BOM categories</CardDescription>
                </CardHeader>
                <CardContent>
                  {bomSettings && (
                    <>
                      <div className="flex flex-wrap gap-2 mb-4">
                        {(bomSettings.categories || [])
                          .filter(cat => !cat.parentId)
                          .map(cat => cat.name)
                          .map((category, index) => (
                          <Badge key={index} variant="secondary" className="px-3 py-1">
                            {category}
                            <button
                              className="ml-2 hover:bg-red-200 rounded-full"
                              onClick={() => removeCategory(index)}
                            >
                              <X size={12} />
                            </button>
                          </Badge>
                        ))}
                      </div>
                      <div className="flex gap-2">
                        <Input 
                          placeholder="Add new category" 
                          id="newCategory"
                          onKeyPress={(e) => {
                            if (e.key === 'Enter') {
                              const input = e.target as HTMLInputElement;
                              if (input.value.trim()) {
                                addCategory(input.value.trim());
                                input.value = '';
                              }
                            }
                          }}
                        />
                        <Button onClick={() => {
                          const input = document.getElementById('newCategory') as HTMLInputElement;
                          if (input.value.trim()) {
                            addCategory(input.value.trim());
                            input.value = '';
                          }
                        }}>
                          <Plus size={16} />
                        </Button>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>BOM Workflow Settings</CardTitle>
                  <CardDescription>Configure BOM approval and quotation settings</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  {bomSettings && (
                    <>
                      <div className="flex items-center justify-between">
                        <div className="space-y-1">
                          <Label>Auto-approval for orders</Label>
                          <p className="text-sm text-muted-foreground">Automatically approve orders from trusted vendors</p>
                        </div>
                        <Switch
                          checked={bomSettings.autoApprovalEnabled}
                          onCheckedChange={(checked) => 
                            setBomSettings({...bomSettings, autoApprovalEnabled: checked})
                          }
                        />
                      </div>
                      <Separator />
                      <div className="flex items-center justify-between">
                        <div className="space-y-1">
                          <Label>Require vendor quotes</Label>
                          <p className="text-sm text-muted-foreground">Require quotes before placing orders</p>
                        </div>
                        <Switch
                          checked={bomSettings.requireVendorQuotes}
                          onCheckedChange={(checked) => 
                            setBomSettings({...bomSettings, requireVendorQuotes: checked})
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Minimum vendor quotes required</Label>
                        <Select 
                          value={bomSettings.minimumVendorQuotes.toString()} 
                          onValueChange={(value) => 
                            setBomSettings({...bomSettings, minimumVendorQuotes: parseInt(value)})
                          }
                        >
                          <SelectTrigger className="w-32">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="1">1</SelectItem>
                            <SelectItem value="2">2</SelectItem>
                            <SelectItem value="3">3</SelectItem>
                            <SelectItem value="4">4</SelectItem>
                            <SelectItem value="5">5</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Cost calculation method</Label>
                        <Select 
                          value={bomSettings.costCalculationMethod} 
                          onValueChange={(value: 'average' | 'lowest' | 'selected') => 
                            setBomSettings({...bomSettings, costCalculationMethod: value})
                          }
                        >
                          <SelectTrigger className="w-48">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="average">Average of quotes</SelectItem>
                            <SelectItem value="lowest">Lowest quote</SelectItem>
                            <SelectItem value="selected">Selected vendor only</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <Button 
                        className="flex items-center gap-2"
                        onClick={handleSaveBOMSettings}
                        disabled={saving}
                      >
                        {saving && <Loader2 size={16} className="animate-spin" />}
                        <Save size={16} />
                        Save BOM Settings
                      </Button>
                    </>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* General Settings Tab */}
          <TabsContent value="general">
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Application Preferences</CardTitle>
                  <CardDescription>General application settings and preferences</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="space-y-2">
                    <Label>Default Currency</Label>
                    <Select defaultValue="USD">
                      <SelectTrigger className="w-48">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="USD">USD ($)</SelectItem>
                        <SelectItem value="EUR">EUR (€)</SelectItem>
                        <SelectItem value="GBP">GBP (£)</SelectItem>
                        <SelectItem value="INR">INR (₹)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Date Format</Label>
                    <Select defaultValue="MM/DD/YYYY">
                      <SelectTrigger className="w-48">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="MM/DD/YYYY">MM/DD/YYYY</SelectItem>
                        <SelectItem value="DD/MM/YYYY">DD/MM/YYYY</SelectItem>
                        <SelectItem value="YYYY-MM-DD">YYYY-MM-DD</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Time Zone</Label>
                    <Select defaultValue="UTC">
                      <SelectTrigger className="w-48">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="UTC">UTC</SelectItem>
                        <SelectItem value="EST">Eastern Time</SelectItem>
                        <SelectItem value="PST">Pacific Time</SelectItem>
                        <SelectItem value="IST">India Standard Time</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Button className="flex items-center gap-2">
                    <Save size={16} />
                    Save General Settings
                  </Button>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Data Management</CardTitle>
                  <CardDescription>Backup and export options</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex gap-4">
                    <Button variant="outline">
                      Export All Data
                    </Button>
                    <Button variant="outline">
                      Create Backup
                    </Button>
                    <Button variant="outline">
                      Import Data
                    </Button>
                  </div>
                  <div className="p-4 border rounded-lg border-red-200 bg-red-50">
                    <h4 className="font-medium mb-2 text-red-900">Danger Zone</h4>
                    <p className="text-sm text-red-700 mb-4">
                      Permanently delete all data. This action cannot be undone.
                    </p>
                    <Button variant="destructive" size="sm">
                      Delete All Data
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

export default Settings;