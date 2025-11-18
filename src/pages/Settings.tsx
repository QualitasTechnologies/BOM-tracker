import { useState, useEffect, useRef } from 'react';
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
  Loader2,
  Upload,
  Download
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
  PRSettings,
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
  validateVendor,
  getOEMVendors,
  getPRSettings,
  updatePRSettings,
  validatePRSettings,
  validateEmail
} from '@/utils/settingsFirestore';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { downloadVendorCSVTemplate, parseVendorCSV, validateVendorData, CSVImportResult } from '@/utils/csvImport';
import { uploadVendorLogo, ImageUploadResult } from '@/utils/imageUpload';
import { useAuth } from '@/hooks/useAuth';
import { toast } from '@/components/ui/use-toast';

const Settings = () => {
  // Auth check
  const { user, loading: authLoading, isAdmin } = useAuth();
  
  // State management
  const [clients, setClients] = useState<Client[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [oemVendors, setOemVendors] = useState<Vendor[]>([]);
  const [bomSettings, setBomSettings] = useState<BOMSettings | null>(null);
  const [prSettings, setPRSettings] = useState<PRSettings | null>(null);
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

  // CSV Import states
  const [importing, setImporting] = useState(false);
  const [importResults, setImportResults] = useState<CSVImportResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Image upload states
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);

  // Purchase Request settings states
  const [prEmailInput, setPREmailInput] = useState('');
  const [prRecipients, setPRRecipients] = useState<string[]>([]);
  const [prCompanyName, setPRCompanyName] = useState('Qualitas Technologies Pvt Ltd');
  const [prFromEmail, setPRFromEmail] = useState('info@qualitastech.com');
  const [prSaving, setPRSaving] = useState(false);
  const [prError, setPRError] = useState<string | null>(null);

  // Handle CSV file import
  const handleCSVImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setImporting(true);
    setImportResults(null);

    try {
      const text = await file.text();
      const parsedData = parseVendorCSV(text);
      
      const errors: string[] = [];
      let successCount = 0;

      for (const { vendor, lineNumber } of parsedData) {
        try {
          // Validate vendor data
          const validationErrors = validateVendorData(vendor, lineNumber);
          if (validationErrors.length > 0) {
            errors.push(...validationErrors);
            continue;
          }

          // Add vendor to database
          await addVendor({
            company: vendor.company!,
            email: vendor.email || '',
            phone: vendor.phone || '',
            address: vendor.address || '',
            contactPerson: vendor.contactPerson || '',
            website: vendor.website || '',
            logo: vendor.logo || '',
            logoPath: '',
            paymentTerms: vendor.paymentTerms || 'Net 30',
            leadTime: vendor.leadTime || '2 weeks',
            rating: 0,
            status: 'active',
            notes: vendor.notes || '',
            type: vendor.type || 'Dealer',
            makes: vendor.makes || []
          });

          successCount++;
        } catch (err: any) {
          errors.push(`Line ${lineNumber}: ${err.message || 'Failed to import vendor'}`);
        }
      }

      setImportResults({ success: successCount, errors });
    } catch (err: any) {
      setError(err.message || 'Failed to parse CSV file');
    }

    setImporting(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Load data on component mount
  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      try {
        // Initialize BOM settings if they don't exist
        await initializeDefaultBOMSettings();
        
        // Load OEM vendors for dealer form
        const oems = await getOEMVendors();
        setOemVendors(oems);
        
        // Load Purchase Request settings
        const prSettingsData = await getPRSettings();
        if (prSettingsData) {
          setPRSettings(prSettingsData);
          setPRRecipients(prSettingsData.recipients || []);
          setPRCompanyName(prSettingsData.companyName || 'Qualitas Technologies Pvt Ltd');
          setPRFromEmail(prSettingsData.fromEmail || 'info@qualitastech.com');
        }

        // Subscribe to real-time updates
        const unsubscribeClients = subscribeToClients(setClients);
        const unsubscribeVendors = subscribeToVendors((vendors) => {
          setVendors(vendors);
          // Update OEM vendors list when vendors change
          setOemVendors(vendors.filter(v => v.type === 'OEM'));
        });
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
    if (!user) return;
    
    try {
      setLoading(true);
      await addClient({
        company: clientForm.company || '',
        email: clientForm.email || '',
        phone: clientForm.phone || '',
        address: clientForm.address || '',
        contactPerson: clientForm.contactPerson || '',
        status: 'active',
        notes: clientForm.notes || '' // Fixed: ensure notes is not undefined
      });
      
      // Reset form
      setClientForm({
        company: '',
        email: '',
        phone: '',
        address: '',
        contactPerson: '',
        notes: ''
      });
      
      setClientDialog(false);
      toast({
        title: "Success",
        description: "Client added successfully",
      });
    } catch (error) {
      console.error('Error adding client:', error);
      toast({
        title: "Error",
        description: "Failed to add client",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
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
      let logoUrl = '';
      let logoPath = '';

      // Upload logo if provided
      if (logoFile) {
        setUploadingLogo(true);
        const uploadResult = await uploadVendorLogo(logoFile);
        logoUrl = uploadResult.url;
        logoPath = uploadResult.path;
        setUploadingLogo(false);
      }

      await addVendor({
        company: vendorForm.company || '',
        email: vendorForm.email || '',
        phone: vendorForm.phone || '',
        address: vendorForm.address || '',
        contactPerson: vendorForm.contactPerson || '',
        website: vendorForm.website || '',
        logo: logoUrl,
        logoPath: logoPath,
        paymentTerms: vendorForm.paymentTerms || 'Net 30',
        leadTime: vendorForm.leadTime || '2 weeks',
        rating: vendorForm.rating || 0,
        status: 'active',
        notes: vendorForm.notes || '',
        type: vendorForm.type || 'Dealer',
        makes: vendorForm.makes || []
      });
      
      setVendorForm({});
      setLogoFile(null);
      setLogoPreview(null);
      setVendorDialog(false);
      setFormErrors([]);
    } catch (err: any) {
      setError(err.message || 'Failed to add vendor');
      setUploadingLogo(false);
    }
    setSaving(false);
  };

  // Handle image file selection
  const handleImageSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setLogoFile(file);
      
      // Create preview
      const reader = new FileReader();
      reader.onload = (e) => {
        setLogoPreview(e.target?.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  // Clear logo
  const clearLogo = () => {
    setLogoFile(null);
    setLogoPreview(null);
    setVendorForm({...vendorForm, logo: '', logoPath: ''});
  };

  const handleEditVendor = (vendor: Vendor) => {
    setEditingVendor(vendor);
    setVendorForm(vendor);
    setFormErrors([]);
    
    // Set logo preview if vendor has logo
    if (vendor.logo) {
      setLogoPreview(vendor.logo);
      setLogoFile(null); // Clear file since it's existing image
    } else {
      setLogoPreview(null);
      setLogoFile(null);
    }
    
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
      let updatedVendorForm = { ...vendorForm };

      // Upload new logo if provided
      if (logoFile) {
        setUploadingLogo(true);
        const uploadResult = await uploadVendorLogo(logoFile, editingVendor.id);
        updatedVendorForm.logo = uploadResult.url;
        updatedVendorForm.logoPath = uploadResult.path;
        setUploadingLogo(false);
      }

      await updateVendor(editingVendor.id, updatedVendorForm);
      
      setEditingVendor(null);
      setVendorForm({});
      setLogoFile(null);
      setLogoPreview(null);
      setVendorDialog(false);
      setFormErrors([]);
    } catch (err: any) {
      setError(err.message || 'Failed to update vendor');
      setUploadingLogo(false);
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

  // Check auth loading first
  if (authLoading) {
    return (
      <div className="container mx-auto py-6 px-4">
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4" />
            <p>Loading...</p>
          </div>
        </div>
      </div>
    );
  }

  // Check admin access
  if (!user || !isAdmin) {
    return (
      <div className="container mx-auto py-6 px-4">
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <X className="h-12 w-12 text-red-500 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-gray-900 mb-2">Access Denied</h2>
            <p className="text-gray-600">You need admin privileges to access settings.</p>
            {user && user.isPending && (
              <p className="text-yellow-600 mt-2">Your account is pending approval.</p>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Purchase Request Settings Handlers
  const handleAddPRRecipient = () => {
    if (!prEmailInput.trim()) return;

    const email = prEmailInput.trim();

    // Validate email
    if (!validateEmail(email)) {
      setPRError('Invalid email format');
      return;
    }

    // Check for duplicates
    if (prRecipients.includes(email)) {
      setPRError('Email already added');
      return;
    }

    setPRRecipients([...prRecipients, email]);
    setPREmailInput('');
    setPRError(null);
  };

  const handleRemovePRRecipient = (email: string) => {
    setPRRecipients(prRecipients.filter(e => e !== email));
  };

  const handleSavePRSettings = async () => {
    try {
      setPRSaving(true);
      setPRError(null);

      const settings = {
        recipients: prRecipients,
        companyName: prCompanyName,
        fromEmail: prFromEmail
      };

      // Validate
      const errors = validatePRSettings(settings);
      if (errors.length > 0) {
        setPRError(errors.join(', '));
        setPRSaving(false);
        return;
      }

      // Save to Firestore
      await updatePRSettings(settings);

      toast({
        title: "Success",
        description: "Purchase request settings saved successfully",
      });
    } catch (error: any) {
      setPRError(error.message || 'Failed to save settings');
      toast({
        title: "Error",
        description: "Failed to save purchase request settings",
        variant: "destructive",
      });
    } finally {
      setPRSaving(false);
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
          <TabsList className="grid w-full grid-cols-5">
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
            <TabsTrigger value="purchase-request" className="flex items-center gap-2">
              <Mail size={16} />
              Purchase Request
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
                    <DialogContent className="@container max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
                      <DialogHeader>
                        <DialogTitle>
                          {editingClient ? 'Edit Client' : 'Add New Client'}
                        </DialogTitle>
                        <DialogDescription>
                          {editingClient ? 'Update client information' : 'Add a new client to your system'}
                        </DialogDescription>
                      </DialogHeader>

                      <div className="flex-1 overflow-y-auto pr-2 -mr-2">
                        {formErrors.length > 0 && (
                          <Alert variant="destructive" className="mb-4">
                            <AlertDescription>
                              <ul className="list-disc list-inside">
                                {formErrors.map((error, index) => (
                                  <li key={index}>{error}</li>
                                ))}
                              </ul>
                            </AlertDescription>
                          </Alert>
                        )}

                        <div className="grid grid-cols-2 gap-4 pb-4">
                          <div className="col-span-2 space-y-2">
                            <Label htmlFor="company">Company Name *</Label>
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
                                                  <div className="col-span-2 space-y-2">
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
                      </div>
                      
                      <div className="flex justify-end gap-2 mt-4 pt-4 border-t bg-background">
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
                              <div className="font-medium">{client.company}</div>
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
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      onClick={downloadVendorCSVTemplate}
                      className="flex items-center gap-2"
                    >
                      <Download size={16} />
                      Download Template
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={importing}
                      className="flex items-center gap-2"
                    >
                      {importing ? (
                        <Loader2 size={16} className="animate-spin" />
                      ) : (
                        <Upload size={16} />
                      )}
                      {importing ? 'Importing...' : 'Import CSV'}
                    </Button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".csv"
                      onChange={handleCSVImport}
                      style={{ display: 'none' }}
                    />
                    <Dialog open={vendorDialog} onOpenChange={setVendorDialog}>
                    <DialogTrigger asChild>
                      <Button onClick={() => {
                        setEditingVendor(null);
                        setVendorForm({});
                        setFormErrors([]);
                        setLogoFile(null);
                        setLogoPreview(null);
                      }}>
                        <Plus size={16} className="mr-2" />
                        Add Vendor
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="@container max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
                      <DialogHeader>
                        <DialogTitle>
                          {editingVendor ? 'Edit Vendor' : 'Add New Vendor'}
                        </DialogTitle>
                        <DialogDescription>
                          {editingVendor ? 'Update vendor information' : 'Add a new vendor to your supplier database'}
                        </DialogDescription>
                      </DialogHeader>

                      <div className="flex-1 overflow-y-auto pr-2 -mr-2">
                        {formErrors.length > 0 && (
                          <Alert variant="destructive" className="mb-4">
                            <AlertDescription>
                              <ul className="list-disc list-inside">
                                {formErrors.map((error, index) => (
                                  <li key={index}>{error}</li>
                                ))}
                              </ul>
                            </AlertDescription>
                          </Alert>
                        )}

                        <div className="grid grid-cols-1 @2xl:grid-cols-2 gap-4 pb-4">
                        <div className="space-y-2">
                          <Label htmlFor="vendorCompany">Company Name *</Label>
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
                          <Label>Company Logo</Label>
                          <div className="flex items-center gap-4">
                            {logoPreview && (
                              <div className="relative">
                                <img 
                                  src={logoPreview} 
                                  alt="Logo preview"
                                  className="w-16 h-16 object-contain border rounded"
                                />
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="destructive"
                                  className="absolute -top-2 -right-2 h-6 w-6 rounded-full p-0"
                                  onClick={clearLogo}
                                >
                                  <X size={14} />
                                </Button>
                              </div>
                            )}
                            <div className="flex-1">
                              <Input
                                type="file"
                                accept="image/*"
                                onChange={handleImageSelect}
                                className="cursor-pointer"
                              />
                              <p className="text-xs text-muted-foreground mt-1">
                                Upload a company logo (max 2MB, will be resized to 200x200px)
                              </p>
                            </div>
                          </div>
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
                        <div className="space-y-2">
                          <Label htmlFor="vendorType">Vendor Type</Label>
                          <Select 
                            value={vendorForm.type || 'Dealer'} 
                            onValueChange={(value) => {
                              // Clear makes field when switching to OEM since OEMs don't represent other makes
                              const updatedForm = {
                                ...vendorForm, 
                                type: value as 'OEM' | 'Dealer'
                              };
                              if (value === 'OEM') {
                                updatedForm.makes = [];
                              }
                              setVendorForm(updatedForm);
                            }}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="OEM">OEM</SelectItem>
                              <SelectItem value="Dealer">Dealer</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        {/* Only show Makes/Brands field for Dealers */}
                        {vendorForm.type === 'Dealer' && (
                          <div className="space-y-2">
                            <Label>Makes/Brands (OEMs represented)</Label>
                            <div className="border rounded-md p-3 max-h-32 overflow-y-auto bg-background">
                              {oemVendors.length === 0 ? (
                                <p className="text-sm text-muted-foreground">No OEM vendors available. Add some OEM vendors first.</p>
                              ) : (
                                <div className="space-y-2">
                                  {oemVendors.map((oem) => (
                                    <div key={oem.id} className="flex items-center space-x-2">
                                      <input
                                        type="checkbox"
                                        id={`oem-${oem.id}`}
                                        checked={(vendorForm.makes || []).includes(oem.company)}
                                        onChange={(e) => {
                                          const currentMakes = vendorForm.makes || [];
                                          if (e.target.checked) {
                                            setVendorForm({
                                              ...vendorForm,
                                              makes: [...currentMakes, oem.company]
                                            });
                                          } else {
                                            setVendorForm({
                                              ...vendorForm,
                                              makes: currentMakes.filter(make => make !== oem.company)
                                            });
                                          }
                                        }}
                                        className="rounded border-gray-300"
                                      />
                                      <Label 
                                        htmlFor={`oem-${oem.id}`} 
                                        className="text-sm font-normal cursor-pointer"
                                      >
                                        {oem.company}
                                      </Label>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground">
                              Select the OEM brands this dealer represents
                            </p>
                          </div>
                        )}
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
                      </div>
                      
                      <div className="flex justify-end gap-2 mt-4 pt-4 border-t bg-background">
                        <Button
                          onClick={editingVendor ? handleUpdateVendor : handleAddVendor}
                          disabled={saving || uploadingLogo}
                        >
                          {(saving || uploadingLogo) && <Loader2 size={16} className="mr-2 animate-spin" />}
                          <Save size={16} className="mr-2" />
                          {uploadingLogo ? 'Uploading Logo...' : `${editingVendor ? 'Update' : 'Add'} Vendor`}
                        </Button>
                        <Button variant="outline" onClick={() => setVendorDialog(false)}>
                          Cancel
                        </Button>
                      </div>
                    </DialogContent>
                  </Dialog>
                  </div>
                </div>
                
                {/* Import Results */}
                {importResults && (
                  <div className="mt-4">
                    <Alert variant={importResults.errors.length > 0 ? "destructive" : "default"}>
                      <AlertDescription>
                        <div className="space-y-2">
                          <div className="font-medium">
                            Import completed: {importResults.success} vendors added successfully
                          </div>
                          {importResults.errors?.length > 0 && (
                            <div>
                              <div className="font-medium text-red-600 mb-2">
                                {importResults.errors?.length || 0} errors occurred:
                              </div>
                              <ul className="list-disc list-inside text-sm space-y-1 max-h-32 overflow-y-auto">
                                {importResults.errors?.map((error, index) => (
                                  <li key={index}>{error}</li>
                                )) || []}
                              </ul>
                            </div>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setImportResults(null)}
                          >
                            Dismiss
                          </Button>
                        </div>
                      </AlertDescription>
                    </Alert>
                  </div>
                )}
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
                        <TableHead>Type & Makes</TableHead>
                        <TableHead>Contact Info</TableHead>
                        <TableHead>Terms</TableHead>
                        <TableHead>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {vendors.map((vendor) => (
                        <TableRow key={vendor.id}>
                          <TableCell>
                            <div className="flex items-center space-x-3">
                              {vendor.logo && (
                                <img 
                                  src={vendor.logo} 
                                  alt={`${vendor.company} logo`}
                                  className="w-8 h-8 object-contain rounded"
                                  onError={(e) => {
                                    e.currentTarget.style.display = 'none';
                                  }}
                                />
                              )}
                              <div className="font-medium">{vendor.company}</div>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div>
                              <Badge variant={vendor.type === 'OEM' ? 'default' : 'secondary'} className="text-xs mb-1">
                                {vendor.type || 'Dealer'}
                              </Badge>
                              {vendor.makes && vendor.makes.length > 0 && (
                                <div className="flex flex-wrap gap-1 mt-1">
                                  {vendor.makes.slice(0, 3).map((make, index) => (
                                    <Badge key={index} variant="outline" className="text-xs">
                                      {make}
                                    </Badge>
                                  ))}
                                  {vendor.makes.length > 3 && (
                                    <Badge variant="outline" className="text-xs">
                                      +{vendor.makes.length - 3}
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

          {/* Purchase Request Settings Tab */}
          <TabsContent value="purchase-request">
            <Card>
              <CardHeader>
                <CardTitle>Purchase Request Email Settings</CardTitle>
                <CardDescription>
                  Configure email recipients and company information for purchase requests
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Company Name */}
                <div className="space-y-2">
                  <Label htmlFor="prCompanyName">Company Name *</Label>
                  <Input
                    id="prCompanyName"
                    value={prCompanyName}
                    onChange={(e) => setPRCompanyName(e.target.value)}
                    placeholder="Enter company name"
                  />
                  <p className="text-xs text-muted-foreground">
                    This will appear in the email header
                  </p>
                </div>

                {/* Sender Email */}
                <div className="space-y-2">
                  <Label htmlFor="prFromEmail">Sender Email Address *</Label>
                  <Input
                    id="prFromEmail"
                    type="email"
                    value={prFromEmail}
                    onChange={(e) => setPRFromEmail(e.target.value)}
                    placeholder="info@qualitastech.com"
                  />
                  <p className="text-xs text-muted-foreground">
                    Must be verified in SendGrid. Emails will be sent from this address.
                  </p>
                </div>

                <Separator />

                {/* Email Recipients */}
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="prRecipients">Email Recipients *</Label>
                    <p className="text-xs text-muted-foreground mt-1">
                      Internal emails for supply chain and accounts team to receive purchase requests
                    </p>
                  </div>

                  {/* Add Email Input */}
                  <div className="flex gap-2">
                    <Input
                      id="prRecipients"
                      type="email"
                      value={prEmailInput}
                      onChange={(e) => setPREmailInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleAddPRRecipient();
                        }
                      }}
                      placeholder="Enter email address"
                    />
                    <Button
                      type="button"
                      onClick={handleAddPRRecipient}
                      variant="outline"
                    >
                      <Plus size={16} className="mr-2" />
                      Add
                    </Button>
                  </div>

                  {/* Error Display */}
                  {prError && (
                    <Alert variant="destructive">
                      <AlertDescription>{prError}</AlertDescription>
                    </Alert>
                  )}

                  {/* Recipients List */}
                  {prRecipients.length > 0 && (
                    <div className="space-y-2">
                      <Label>Added Recipients ({prRecipients.length})</Label>
                      <div className="space-y-2">
                        {prRecipients.map((email, index) => (
                          <div
                            key={index}
                            className="flex items-center justify-between p-3 border rounded-lg bg-muted/50"
                          >
                            <div className="flex items-center gap-2">
                              <Mail size={16} className="text-muted-foreground" />
                              <span>{email}</span>
                            </div>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleRemovePRRecipient(email)}
                            >
                              <X size={16} />
                            </Button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {prRecipients.length === 0 && (
                    <Alert>
                      <Mail className="h-4 w-4" />
                      <AlertDescription>
                        No recipients added yet. Add at least one email address to receive purchase requests.
                      </AlertDescription>
                    </Alert>
                  )}
                </div>

                <Separator />

                {/* Save Button */}
                <div className="flex justify-end gap-2">
                  <Button
                    onClick={handleSavePRSettings}
                    disabled={prSaving || prRecipients.length === 0 || !prCompanyName.trim()}
                  >
                    {prSaving ? (
                      <>
                        <Loader2 size={16} className="mr-2 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <Save size={16} className="mr-2" />
                        Save Settings
                      </>
                    )}
                  </Button>
                </div>

                {/* Help Text */}
                <Alert>
                  <Mail className="h-4 w-4" />
                  <AlertDescription>
                    <strong>How it works:</strong> When users create a purchase request from the BOM page,
                    an email will be sent to all recipients listed above with the grouped BOM items by vendor.
                  </AlertDescription>
                </Alert>
              </CardContent>
            </Card>
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
                  <CardTitle>n8n Webhook Configuration</CardTitle>
                  <CardDescription>Configure webhooks for automation workflows</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="raise-pr-webhook">Raise PR Webhook URL</Label>
                    <Input
                      id="raise-pr-webhook"
                      placeholder="https://your-n8n-instance.com/webhook/raise-pr"
                    />
                    <p className="text-xs text-muted-foreground">Triggered when user wants to raise a Purchase Order</p>
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="add-bom-webhook">Add BOM Item Webhook URL</Label>
                    <Input
                      id="add-bom-webhook"
                      placeholder="https://your-n8n-instance.com/webhook/bom-item-added"
                    />
                    <p className="text-xs text-muted-foreground">Triggered when a new BOM item is added</p>
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="add-vendor-webhook">Add Vendor Webhook URL</Label>
                    <Input
                      id="add-vendor-webhook"
                      placeholder="https://your-n8n-instance.com/webhook/vendor-added"
                    />
                    <p className="text-xs text-muted-foreground">Triggered when a new vendor is added</p>
                  </div>
                  
                  <Button className="flex items-center gap-2">
                    <Save size={16} />
                    Save Webhook Settings
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