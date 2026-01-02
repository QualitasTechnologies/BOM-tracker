import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import {
  Building2,
  Save,
  Loader2,
  MapPin,
  FileText,
  AlertCircle,
  CheckCircle2
} from 'lucide-react';
import { toast } from '@/components/ui/use-toast';
import {
  getCompanySettings,
  updateCompanySettings,
  subscribeToCompanySettings,
  CompanySettings
} from '@/utils/settingsFirestore';
import { INDIAN_STATE_CODES } from '@/types/purchaseOrder';

const CompanySettingsTab: React.FC = () => {
  const [settings, setSettings] = useState<CompanySettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  // Form state
  const [companyName, setCompanyName] = useState('');
  const [companyAddress, setCompanyAddress] = useState('');
  const [gstin, setGstin] = useState('');
  const [pan, setPan] = useState('');
  const [stateCode, setStateCode] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [website, setWebsite] = useState('');

  // PO Settings
  const [poNumberPrefix, setPoNumberPrefix] = useState('PO-QT');
  const [poNumberFormat, setPoNumberFormat] = useState<'simple' | 'financial-year'>('simple');
  const [nextPoNumber, setNextPoNumber] = useState(1);

  // Default Terms
  const [defaultPaymentTerms, setDefaultPaymentTerms] = useState('');
  const [defaultDeliveryTerms, setDefaultDeliveryTerms] = useState('');
  const [defaultTermsAndConditions, setDefaultTermsAndConditions] = useState('');

  // Load settings
  useEffect(() => {
    const unsubscribe = subscribeToCompanySettings((data) => {
      setSettings(data);
      if (data) {
        setCompanyName(data.companyName || '');
        setCompanyAddress(data.companyAddress || '');
        setGstin(data.gstin || '');
        setPan(data.pan || '');
        setStateCode(data.stateCode || '');
        setPhone(data.phone || '');
        setEmail(data.email || '');
        setWebsite(data.website || '');
        setPoNumberPrefix(data.poNumberPrefix || 'PO-QT');
        setPoNumberFormat(data.poNumberFormat || 'simple');
        setNextPoNumber(data.nextPoNumber || 1);
        setDefaultPaymentTerms(data.defaultPaymentTerms || '');
        setDefaultDeliveryTerms(data.defaultDeliveryTerms || '');
        setDefaultTermsAndConditions(data.defaultTermsAndConditions || '');
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // Track changes
  useEffect(() => {
    if (!settings) {
      setHasChanges(true);
      return;
    }

    const changed =
      companyName !== (settings.companyName || '') ||
      companyAddress !== (settings.companyAddress || '') ||
      gstin !== (settings.gstin || '') ||
      pan !== (settings.pan || '') ||
      stateCode !== (settings.stateCode || '') ||
      phone !== (settings.phone || '') ||
      email !== (settings.email || '') ||
      website !== (settings.website || '') ||
      poNumberPrefix !== (settings.poNumberPrefix || 'PO-QT') ||
      poNumberFormat !== (settings.poNumberFormat || 'simple') ||
      nextPoNumber !== (settings.nextPoNumber || 1) ||
      defaultPaymentTerms !== (settings.defaultPaymentTerms || '') ||
      defaultDeliveryTerms !== (settings.defaultDeliveryTerms || '') ||
      defaultTermsAndConditions !== (settings.defaultTermsAndConditions || '');

    setHasChanges(changed);
  }, [
    settings,
    companyName,
    companyAddress,
    gstin,
    pan,
    stateCode,
    phone,
    email,
    website,
    poNumberPrefix,
    poNumberFormat,
    nextPoNumber,
    defaultPaymentTerms,
    defaultDeliveryTerms,
    defaultTermsAndConditions,
  ]);

  // Validate GSTIN format
  const validateGSTIN = (value: string): boolean => {
    if (!value) return true; // Empty is allowed (will show warning)
    // GSTIN format: 2 digits (state code) + 10 char PAN + 1 char entity code + 1 char check digit + Z
    const gstinRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[A-Z0-9]{1}[Z]{1}[A-Z0-9]{1}$/;
    return gstinRegex.test(value.toUpperCase());
  };

  // Auto-extract state code from GSTIN
  const handleGstinChange = (value: string) => {
    const upperValue = value.toUpperCase();
    setGstin(upperValue);

    // Auto-set state code from first 2 digits of GSTIN
    if (upperValue.length >= 2) {
      const code = upperValue.substring(0, 2);
      if (INDIAN_STATE_CODES[code]) {
        setStateCode(code);
      }
    }
  };

  // Save settings
  const handleSave = async () => {
    // Validation
    if (!companyName.trim()) {
      toast({
        title: 'Validation Error',
        description: 'Company name is required',
        variant: 'destructive',
      });
      return;
    }

    if (!companyAddress.trim()) {
      toast({
        title: 'Validation Error',
        description: 'Company address is required',
        variant: 'destructive',
      });
      return;
    }

    if (gstin && !validateGSTIN(gstin)) {
      toast({
        title: 'Validation Error',
        description: 'Invalid GSTIN format',
        variant: 'destructive',
      });
      return;
    }

    setSaving(true);

    try {
      await updateCompanySettings({
        companyName: companyName.trim(),
        companyAddress: companyAddress.trim(),
        gstin: gstin.trim(),
        pan: pan.trim(),
        stateCode,
        stateName: stateCode ? INDIAN_STATE_CODES[stateCode] : '',
        phone: phone.trim(),
        email: email.trim(),
        website: website.trim(),
        poNumberPrefix: poNumberPrefix.trim(),
        poNumberFormat,
        nextPoNumber,
        defaultPaymentTerms: defaultPaymentTerms.trim(),
        defaultDeliveryTerms: defaultDeliveryTerms.trim(),
        defaultTermsAndConditions: defaultTermsAndConditions.trim(),
      });

      toast({
        title: 'Settings Saved',
        description: 'Company settings have been updated successfully.',
      });
    } catch (error) {
      console.error('Error saving company settings:', error);
      toast({
        title: 'Error',
        description: 'Failed to save company settings. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    );
  }

  const isComplete = companyName && companyAddress && gstin && stateCode;

  return (
    <div className="space-y-6">
      {/* Status Alert */}
      {!isComplete && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Company settings are incomplete. GSTIN, Address, and State are required to create Purchase Orders.
          </AlertDescription>
        </Alert>
      )}

      {isComplete && (
        <Alert className="border-green-200 bg-green-50">
          <CheckCircle2 className="h-4 w-4 text-green-600" />
          <AlertDescription className="text-green-800">
            Company settings are complete. You can create Purchase Orders.
          </AlertDescription>
        </Alert>
      )}

      {/* Company Details */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            Company Details
          </CardTitle>
          <CardDescription>
            These details will appear on Purchase Orders as the invoicing company.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="companyName">
                Company Name <span className="text-red-500">*</span>
              </Label>
              <Input
                id="companyName"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="Your Company Pvt Ltd"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="gstin">
                GSTIN <span className="text-red-500">*</span>
              </Label>
              <Input
                id="gstin"
                value={gstin}
                onChange={(e) => handleGstinChange(e.target.value)}
                placeholder="29XXXXX1234X1Z5"
                className={gstin && !validateGSTIN(gstin) ? 'border-red-500' : ''}
              />
              {gstin && !validateGSTIN(gstin) && (
                <p className="text-xs text-red-500">Invalid GSTIN format</p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="pan">PAN</Label>
              <Input
                id="pan"
                value={pan}
                onChange={(e) => setPan(e.target.value.toUpperCase())}
                placeholder="XXXXX1234X"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="stateCode">
                State <span className="text-red-500">*</span>
              </Label>
              <Select value={stateCode} onValueChange={setStateCode}>
                <SelectTrigger>
                  <SelectValue placeholder="Select state" />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(INDIAN_STATE_CODES).map(([code, name]) => (
                    <SelectItem key={code} value={code}>
                      {code} - {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="companyAddress">
              Address <span className="text-red-500">*</span>
            </Label>
            <Textarea
              id="companyAddress"
              value={companyAddress}
              onChange={(e) => setCompanyAddress(e.target.value)}
              placeholder="Full company address including city, state, and PIN code"
              className="min-h-[80px]"
            />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="phone">Phone</Label>
              <Input
                id="phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+91 XXXXX XXXXX"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="info@company.com"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="website">Website</Label>
              <Input
                id="website"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                placeholder="www.company.com"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* PO Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Purchase Order Settings
          </CardTitle>
          <CardDescription>
            Configure PO numbering and default terms.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="poPrefix">PO Number Prefix</Label>
              <Input
                id="poPrefix"
                value={poNumberPrefix}
                onChange={(e) => setPoNumberPrefix(e.target.value)}
                placeholder="PO-QT"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="poFormat">PO Number Format</Label>
              <Select
                value={poNumberFormat}
                onValueChange={(v) => setPoNumberFormat(v as 'simple' | 'financial-year')}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="simple">
                    Simple (PO-QT-2025-001)
                  </SelectItem>
                  <SelectItem value="financial-year">
                    Financial Year (PO/QT/24-25/001)
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="nextPo">Next PO Number</Label>
              <Input
                id="nextPo"
                type="number"
                min="1"
                value={nextPoNumber}
                onChange={(e) => setNextPoNumber(parseInt(e.target.value) || 1)}
              />
            </div>
          </div>

          <Separator />

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="defaultPayment">Default Payment Terms</Label>
              <Textarea
                id="defaultPayment"
                value={defaultPaymentTerms}
                onChange={(e) => setDefaultPaymentTerms(e.target.value)}
                placeholder="e.g., 100% payment within 30 days from invoice date"
                className="min-h-[60px]"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="defaultDelivery">Default Delivery Terms</Label>
              <Textarea
                id="defaultDelivery"
                value={defaultDeliveryTerms}
                onChange={(e) => setDefaultDeliveryTerms(e.target.value)}
                placeholder="e.g., 2-4 Weeks from PO date"
                className="min-h-[60px]"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="defaultTC">Default Terms & Conditions (for Annexure)</Label>
            <Textarea
              id="defaultTC"
              value={defaultTermsAndConditions}
              onChange={(e) => setDefaultTermsAndConditions(e.target.value)}
              placeholder="Enter default terms and conditions that will be used as a template for PO annexures..."
              className="min-h-[200px] font-mono text-sm"
            />
          </div>
        </CardContent>
      </Card>

      {/* Save Button */}
      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving || !hasChanges}>
          {saving ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Save className="mr-2 h-4 w-4" />
              Save Changes
            </>
          )}
        </Button>
      </div>
    </div>
  );
};

export default CompanySettingsTab;
