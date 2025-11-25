import { useState, useEffect, useRef } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Textarea } from "@/components/ui/textarea";
import {
  Plus,
  Edit,
  Trash2,
  Save,
  Loader2,
  X,
  Globe,
  Tag,
  Upload,
  Download,
} from "lucide-react";
import { toast } from "@/components/ui/use-toast";
import { Brand, BrandInput } from "@/types/brand";
import {
  addBrand,
  updateBrand,
  deleteBrand,
  subscribeToBrands,
  validateBrand,
  brandNameExists,
} from "@/utils/brandFirestore";
import { uploadBrandLogo } from "@/utils/imageUpload";
import {
  exportBrandsToCSV,
  parseBrandCSV,
  validateBrandData,
} from "@/utils/csvImport";

const BrandsTab = () => {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingBrand, setEditingBrand] = useState<Brand | null>(null);
  const [formErrors, setFormErrors] = useState<string[]>([]);

  // Form state
  const [brandForm, setBrandForm] = useState<Partial<BrandInput>>({
    status: "active",
  });
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);

  // CSV Import state
  const [importing, setImporting] = useState(false);
  const [importResults, setImportResults] = useState<{ success: number; errors: string[] } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Subscribe to brands on mount
  useEffect(() => {
    const unsubscribe = subscribeToBrands((brandsData) => {
      setBrands(brandsData);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // Reset form when dialog opens/closes
  const resetForm = () => {
    setBrandForm({ status: "active" });
    setLogoFile(null);
    setLogoPreview(null);
    setFormErrors([]);
    setEditingBrand(null);
  };

  const handleOpenDialog = (brand?: Brand) => {
    if (brand) {
      setEditingBrand(brand);
      setBrandForm({
        name: brand.name,
        website: brand.website || "",
        description: brand.description || "",
        status: brand.status,
      });
      if (brand.logo) {
        setLogoPreview(brand.logo);
      }
    } else {
      resetForm();
    }
    setDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setDialogOpen(false);
    resetForm();
  };

  // Handle logo file selection
  const handleLogoSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setLogoFile(file);
      const reader = new FileReader();
      reader.onload = (e) => {
        setLogoPreview(e.target?.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const clearLogo = () => {
    setLogoFile(null);
    setLogoPreview(null);
    setBrandForm({ ...brandForm, logo: "", logoPath: "" });
  };

  // Add or update brand
  const handleSaveBrand = async () => {
    // Validate form
    const errors = validateBrand(brandForm);
    if (errors.length > 0) {
      setFormErrors(errors);
      return;
    }

    // Check for duplicate name
    const nameExists = await brandNameExists(
      brandForm.name!,
      editingBrand?.id
    );
    if (nameExists) {
      setFormErrors(["A brand with this name already exists"]);
      return;
    }

    setSaving(true);
    setFormErrors([]);

    try {
      let logoUrl = editingBrand?.logo || "";
      let logoPath = editingBrand?.logoPath || "";

      // Upload logo if new file selected
      if (logoFile) {
        setUploadingLogo(true);
        const uploadResult = await uploadBrandLogo(
          logoFile,
          editingBrand?.id || undefined
        );
        logoUrl = uploadResult.url;
        logoPath = uploadResult.path;
        setUploadingLogo(false);
      }

      const brandData: BrandInput = {
        name: brandForm.name!.trim(),
        website: brandForm.website?.trim() || undefined,
        description: brandForm.description?.trim() || undefined,
        logo: logoUrl || undefined,
        logoPath: logoPath || undefined,
        status: brandForm.status as "active" | "inactive",
      };

      if (editingBrand) {
        await updateBrand(editingBrand.id, brandData);
        toast({
          title: "Success",
          description: "Brand updated successfully",
        });
      } else {
        await addBrand(brandData);
        toast({
          title: "Success",
          description: "Brand added successfully",
        });
      }

      handleCloseDialog();
    } catch (error: any) {
      console.error("Error saving brand:", error);
      setFormErrors([error.message || "Failed to save brand"]);
      setUploadingLogo(false);
    } finally {
      setSaving(false);
    }
  };

  // Delete brand
  const handleDeleteBrand = async (brand: Brand) => {
    if (
      !confirm(
        `Are you sure you want to delete "${brand.name}"? This action cannot be undone.`
      )
    ) {
      return;
    }

    try {
      await deleteBrand(brand.id);
      toast({
        title: "Success",
        description: "Brand deleted successfully",
      });
    } catch (error: any) {
      console.error("Error deleting brand:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to delete brand",
        variant: "destructive",
      });
    }
  };

  // CSV Import
  const handleCSVImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setImporting(true);
    setImportResults(null);

    try {
      const text = await file.text();
      const parsedData = parseBrandCSV(text);

      const errors: string[] = [];
      let successCount = 0;

      for (const { brand, lineNumber } of parsedData) {
        // Validate
        const validationErrors = validateBrandData(brand, lineNumber);
        if (validationErrors.length > 0) {
          errors.push(...validationErrors);
          continue;
        }

        // Check for duplicate
        const exists = await brandNameExists(brand.name!);
        if (exists) {
          errors.push(`Line ${lineNumber}: Brand "${brand.name}" already exists`);
          continue;
        }

        // Add brand
        try {
          await addBrand({
            name: brand.name!,
            website: brand.website || undefined,
            description: brand.description || undefined,
            status: brand.status || "active",
          });
          successCount++;
        } catch (err: any) {
          errors.push(`Line ${lineNumber}: ${err.message || "Failed to add brand"}`);
        }
      }

      setImportResults({ success: successCount, errors });

      if (successCount > 0) {
        toast({
          title: "Import Complete",
          description: `${successCount} brands imported successfully`,
        });
      }
    } catch (err: any) {
      toast({
        title: "Import Failed",
        description: err.message || "Failed to parse CSV file",
        variant: "destructive",
      });
    }

    setImporting(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex justify-between items-center">
          <div>
            <CardTitle>Brand Management</CardTitle>
            <CardDescription>
              Manage OEM/manufacturer brands for your BOM items
            </CardDescription>
          </div>
          <div className="flex gap-2">
            {/* Export Button */}
            <Button
              variant="outline"
              onClick={() => exportBrandsToCSV(brands)}
              disabled={brands.length === 0}
            >
              <Download size={16} className="mr-2" />
              Export
            </Button>

            {/* Import Button */}
            <Button
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={importing}
            >
              {importing ? (
                <Loader2 size={16} className="mr-2 animate-spin" />
              ) : (
                <Upload size={16} className="mr-2" />
              )}
              Import CSV
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              onChange={handleCSVImport}
              className="hidden"
            />

            {/* Add Brand Dialog */}
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button onClick={() => handleOpenDialog()}>
                  <Plus size={16} className="mr-2" />
                  Add Brand
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle>
                    {editingBrand ? "Edit Brand" : "Add New Brand"}
                  </DialogTitle>
                  <DialogDescription>
                    {editingBrand
                      ? "Update brand information"
                      : "Add a new OEM/manufacturer brand"}
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-4">
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

                  {/* Brand Name */}
                  <div className="space-y-2">
                    <Label htmlFor="brandName">Brand Name *</Label>
                    <Input
                      id="brandName"
                      value={brandForm.name || ""}
                      onChange={(e) =>
                        setBrandForm({ ...brandForm, name: e.target.value })
                      }
                      placeholder="e.g., Basler, Cognex, Siemens"
                    />
                  </div>

                  {/* Website */}
                  <div className="space-y-2">
                    <Label htmlFor="brandWebsite">Website</Label>
                    <Input
                      id="brandWebsite"
                      value={brandForm.website || ""}
                      onChange={(e) =>
                        setBrandForm({ ...brandForm, website: e.target.value })
                      }
                      placeholder="https://www.example.com"
                    />
                  </div>

                  {/* Description */}
                  <div className="space-y-2">
                    <Label htmlFor="brandDescription">Description</Label>
                    <Textarea
                      id="brandDescription"
                      value={brandForm.description || ""}
                      onChange={(e) =>
                        setBrandForm({ ...brandForm, description: e.target.value })
                      }
                      placeholder="Brief description of the brand"
                      rows={2}
                    />
                  </div>

                  {/* Logo */}
                  <div className="space-y-2">
                    <Label>Brand Logo</Label>
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
                          onChange={handleLogoSelect}
                          className="cursor-pointer"
                        />
                        <p className="text-xs text-muted-foreground mt-1">
                          Upload a brand logo (max 2MB)
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Status */}
                  <div className="space-y-2">
                    <Label htmlFor="brandStatus">Status</Label>
                    <Select
                      value={brandForm.status || "active"}
                      onValueChange={(value) =>
                        setBrandForm({
                          ...brandForm,
                          status: value as "active" | "inactive",
                        })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="inactive">Inactive</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={handleCloseDialog}>
                    Cancel
                  </Button>
                  <Button
                    onClick={handleSaveBrand}
                    disabled={saving || uploadingLogo}
                  >
                    {(saving || uploadingLogo) && (
                      <Loader2 size={16} className="mr-2 animate-spin" />
                    )}
                    <Save size={16} className="mr-2" />
                    {uploadingLogo
                      ? "Uploading..."
                      : editingBrand
                      ? "Update Brand"
                      : "Add Brand"}
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
                    Import completed: {importResults.success} brands added
                  </div>
                  {importResults.errors.length > 0 && (
                    <div>
                      <div className="font-medium text-red-600 mb-2">
                        {importResults.errors.length} errors:
                      </div>
                      <ul className="list-disc list-inside text-sm space-y-1 max-h-32 overflow-y-auto">
                        {importResults.errors.map((error, index) => (
                          <li key={index}>{error}</li>
                        ))}
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
        {brands.length === 0 ? (
          <div className="text-center py-8">
            <Tag className="mx-auto h-12 w-12 text-gray-400 mb-4" />
            <p className="text-gray-500">No brands added yet</p>
            <p className="text-gray-400 text-sm">
              Add your first brand to get started
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Brand</TableHead>
                <TableHead>Website</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {brands.map((brand) => (
                <TableRow key={brand.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      {brand.logo && (
                        <img
                          src={brand.logo}
                          alt={`${brand.name} logo`}
                          className="w-8 h-8 object-contain rounded"
                          onError={(e) => {
                            e.currentTarget.style.display = "none";
                          }}
                        />
                      )}
                      <span className="font-medium">{brand.name}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    {brand.website ? (
                      <a
                        href={brand.website}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-blue-600 hover:underline text-sm"
                      >
                        <Globe size={14} />
                        {(() => {
                          try {
                            return new URL(brand.website).hostname;
                          } catch {
                            return brand.website;
                          }
                        })()}
                      </a>
                    ) : (
                      <span className="text-muted-foreground text-sm">-</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <span className="text-sm text-muted-foreground line-clamp-1">
                      {brand.description || "-"}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        brand.status === "active" ? "default" : "secondary"
                      }
                    >
                      {brand.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleOpenDialog(brand)}
                      >
                        <Edit size={14} />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleDeleteBrand(brand)}
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
  );
};

export default BrandsTab;
