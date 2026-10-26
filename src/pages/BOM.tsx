import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Search, Plus, Download, Filter, X, Upload, Package, FileText, ChevronDown, ChevronUp, Milestone, Brain, UserCheck, Video } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import BOMHeader from '@/components/BOM/BOMHeader';
import BOMCategoryCard from '@/components/BOM/BOMCategoryCard';
import BOMPartRow from '@/components/BOM/BOMPartRow';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import ImportBOMDialog from '@/components/BOM/ImportBOMDialog';
import PurchaseRequestDialog from '@/components/BOM/PurchaseRequestDialog';
import CreatePODialog from '@/components/BOM/CreatePODialog';
import OrderItemDialog from '@/components/BOM/OrderItemDialog';
import ReceiveItemDialog from '@/components/BOM/ReceiveItemDialog';
import InwardTracking from '@/components/BOM/InwardTracking';
import ProjectDocuments from '@/components/BOM/ProjectDocuments';
import POListSection from '@/components/BOM/POListSection';
import ComplianceChecker from '@/components/BOM/ComplianceChecker';
import { MilestoneList } from '@/components/Milestones';
import { ProjectActivityTimeline } from '@/components/Transcripts';
import ProjectContextEditor from '@/components/Project/ProjectContextEditor';
import { saveAs } from 'file-saver';
import {
  getBOMData,
  getProject,
  subscribeToBOM,
  updateBOMData,
  updateBOMItem,
  deleteBOMItem,
  updateProject,
  Project,
} from '@/utils/projectFirestore';
import { useAuth } from '@/hooks/useAuth';
import { getVisibleCategories } from '@/utils/accessControl';
import ProjectMembersTab from '@/components/Project/ProjectMembersTab';
import { ProjectCommunicationsTab } from '@/components/Project/ProjectCommunicationsTab';
import { isNativeMaterialCommandEnabled, loadNativeMaterialSnapshot, submitNativeMaterialCommand, submitNativeMaterialFulfillment } from '@/utils/nativeMaterialCommands';
import { isScopedProjectReadEnabled } from '@/utils/projectReadMode';
import { isNativeProjectLifecycleEnabled } from '@/utils/projectLifecycleAccess';
import { createNativeProjectWorkspace } from '@/utils/nativeProjectOperations';
import { createDocumentLinkAction, isDefinitiveDocumentLinkFailure, type DocumentLinkAction } from '@/utils/documentLinkAction';
import OverheadsTab from '@/components/BOM/OverheadsTab';
import ProjectCostBar from '@/components/BOM/ProjectCostBar';
import { fetchAllUsers } from '@/utils/userService';
import { getVendors, getBOMSettings } from '@/utils/settingsFirestore';
import { getBrands } from '@/utils/brandFirestore';
import type { Vendor, BOMCategory as SettingsCategory } from '@/utils/settingsFirestore';
import { BOMItem, BOMCategory, BOMStatus, FulfillmentTranche } from '@/types/bom';
import { getProjectDocuments, linkDocumentToBOMItems } from '@/utils/projectDocumentFirestore';
import { ProjectDocument } from '@/types/projectDocument';
import { syncPODocumentLinks, getOutgoingPODocuments } from '@/utils/bomDocumentLinking';
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

// The scoped project read reports a missing or inaccessible project by code; keep the wording of the legacy path.
const projectLoadErrorMessage = (error: unknown) => ['project_not_found', 'project_forbidden'].includes((error as { code?: string } | null)?.code ?? '')
  ? 'Project not found or you no longer have access.'
  : error instanceof Error ? error.message : 'Could not load project details. Please retry.';

const BOMContent = () => {
  const [searchParams] = useSearchParams();
  const initialTab = searchParams.get('tab') || 'costs';

  const [searchTerm, setSearchTerm] = useState('');
  const [categories, setCategories] = useState<BOMCategory[]>([]);
  const [nativeMaterialVersion, setNativeMaterialVersion] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState(initialTab);
  const [groupBy, setGroupBy] = useState<'category' | 'vendor'>('category');
  const [expandedVendors, setExpandedVendors] = useState<Set<string>>(new Set());

  const toggleVendor = (vendorName: string) => {
    setExpandedVendors(prev => {
      const next = new Set(prev);
      if (next.has(vendorName)) {
        next.delete(vendorName);
      } else {
        next.add(vendorName);
      }
      return next;
    });
  };
  const { projectId } = useParams<{ projectId: string }>();
  console.log('projectId from URL params:', projectId);
  const [projectDetails, setProjectDetails] = useState<{ projectName: string; projectId: string; clientName: string } | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>([]);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [addPartOpen, setAddPartOpen] = useState(false);
  const [importBOMOpen, setImportBOMOpen] = useState(false);
  const [prDialogOpen, setPRDialogOpen] = useState(false);
  const [poDialogOpen, setPODialogOpen] = useState(false);
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
  const [materialActionError, setMaterialActionError] = useState<string | null>(null);
  const [emailStatus, setEmailStatus] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState<string | null>(null);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [availableMakes, setAvailableMakes] = useState<string[]>([]);
  const [canonicalCategories, setCanonicalCategories] = useState<SettingsCategory[]>([]);
  const [projectDocuments, setProjectDocuments] = useState<ProjectDocument[]>([]);
  const [overheadTotal, setOverheadTotal] = useState(0);
  const { user, isAdmin } = useAuth();
  const legacyWritesDisabled = isScopedProjectReadEnabled() && !isNativeMaterialCommandEnabled();
  // Document links in native mode: the dialog captures the revision, account and project it opened against.
  // A background refresh never rebases that draft, and an uncertain reply keeps its request identity.
  const documentContext = JSON.stringify([projectId, user?.uid]);
  const currentDocumentContext = useRef(documentContext);
  currentDocumentContext.current = documentContext;
  const nativeVersionContext = useRef<string | null>(null);
  const documentLinkAction = useRef<DocumentLinkAction | null>(null);
  const uncertainDocumentLinks = useRef(new Map<string, DocumentLinkAction>());
  useEffect(() => { documentLinkAction.current = null; uncertainDocumentLinks.current.clear(); }, [documentContext]);
  const openDocumentLinks = (document: ProjectDocument) => {
    if (!isNativeMaterialCommandEnabled()) return;
    const uid = user?.uid;
    if (!projectId || !uid) throw new Error('Sign in again before changing document links.');
    const retained = uncertainDocumentLinks.current.get(document.id);
    if (retained && retained.projectId === projectId && retained.uid === uid) { documentLinkAction.current = retained; return; }
    uncertainDocumentLinks.current.delete(document.id);
    if (!nativeMaterialVersion || nativeVersionContext.current !== documentContext) throw new Error('BOM revision is still loading. Refresh the page before changing document links.');
    const context = documentContext;
    documentLinkAction.current = createDocumentLinkAction({ projectId, uid, version: nativeMaterialVersion, isCurrent: () => currentDocumentContext.current === context });
  };
  const saveDocumentLinks = async (document: ProjectDocument, addedIds: string[], removedIds: string[]) => {
    const action = documentLinkAction.current;
    if (!action || action.projectId !== projectId || action.uid !== user?.uid) throw new Error('Reopen the document links before saving.');
    try {
      await action.submit({ kind: 'link_document_delta', document_id: document.id, add_item_ids: addedIds, remove_item_ids: removedIds });
    } catch (error) {
      if (isDefinitiveDocumentLinkFailure(error)) uncertainDocumentLinks.current.delete(document.id);
      else uncertainDocumentLinks.current.set(document.id, action);
      throw error;
    }
    uncertainDocumentLinks.current.delete(document.id);
  };
  const [fullProject, setFullProject] = useState<Project | null>(null);
  const budgetProjectWorkspace = useRef<ReturnType<typeof createNativeProjectWorkspace> | null>(null);
  type BudgetAction = ReturnType<ReturnType<typeof createNativeProjectWorkspace>['capture']>;
  const budgetRecoveryAction = useRef<BudgetAction | null>(null);
  // The action opened with the editor binds the version the visible draft was based on; a refresh never rebases it.
  const budgetDraft = useRef<{ workspace: ReturnType<typeof createNativeProjectWorkspace>; action: BudgetAction } | null>(null);
  const [hasPendingBudget, setHasPendingBudget] = useState(false);
  const [pendingBudgetValue, setPendingBudgetValue] = useState<number | null | undefined>(undefined);
  const [projectRefreshVersion, setProjectRefreshVersion] = useState(0);
  const projectReadGeneration = useRef(0);
  const materialReadGeneration = useRef(0);
  const refreshMaterialRef = useRef<(() => Promise<void>) | null>(null);
  const poContextRef = useRef({ projectId, uid: user?.uid });
  poContextRef.current = { projectId, uid: user?.uid };
  const [approvedUsers, setApprovedUsers] = useState<Array<{ uid: string; email: string; displayName: string }>>([]);
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
    let active = true;
    const uid = user?.uid;
    const isCurrent = () => active && !!uid && user?.uid === uid;
    if (!projectId || !uid) { setCategories([]); setNativeMaterialVersion(null); setFullProject(null); setProjectDetails(null); setProjectDocuments([]); return () => { active = false; }; }
    const nativeMode = isNativeMaterialCommandEnabled();

    const refreshBOM = async () => {
      const request = ++materialReadGeneration.current;
      const generation = projectReadGeneration.current;
      const currentRead = () => isCurrent() && request === materialReadGeneration.current && generation === projectReadGeneration.current;
      if (nativeMode) {
        try {
          const snapshot = await loadNativeMaterialSnapshot(projectId);
          if (!currentRead()) return;
          setCategories(snapshot.categories as BOMCategory[]);
          nativeVersionContext.current = JSON.stringify([projectId, uid]);
          setNativeMaterialVersion(snapshot.version);
          setMaterialActionError(null);
        } catch (error) {
          if (currentRead()) { setCategories([]); setNativeMaterialVersion(null); setMaterialActionError(error instanceof Error ? error.message : 'Could not load the current BOM revision.'); }
        }
      } else {
        try {
        const data = await getBOMData(projectId, uid, () => { if (!currentRead()) throw new Error('Account or project changed. Reopen the project.'); });
        if (!currentRead()) return;
        setCategories(data);
        setNativeMaterialVersion(null);
        setMaterialActionError(null);
        } catch (error) { if (currentRead()) { setCategories([]); setMaterialActionError(error instanceof Error ? error.message : 'Could not load materials. Retry the project.'); } }
      }
    };
    refreshMaterialRef.current = refreshBOM;
    refreshBOM();

    // Subscribe to real-time updates
    const unsubscribe = subscribeToBOM(projectId, (updatedCategories) => {
      if (!isCurrent()) return;
      projectReadGeneration.current += 1;
      setProjectRefreshVersion(version => version + 1);
      if (nativeMode || isScopedProjectReadEnabled()) {
        // The version and categories must come from the same trusted server snapshot.
        refreshBOM();
      } else {
        setCategories(updatedCategories);
      }
    }, (error) => { if (isCurrent()) { projectReadGeneration.current += 1; materialReadGeneration.current += 1; setCategories([]); setNativeMaterialVersion(null); setFullProject(null); setProjectDetails(null); setProjectDocuments([]); setMaterialActionError(error.message || 'Could not load materials. Please retry.'); } });

    return () => { active = false; unsubscribe(); if (refreshMaterialRef.current === refreshBOM) refreshMaterialRef.current = null; };
  }, [projectId, user?.uid]);

  // Load project details and documents
  useEffect(() => {
    let active = true;
    const uid = user?.uid;
    const generation = projectReadGeneration.current;
    let nativeWorkspace: ReturnType<typeof createNativeProjectWorkspace> | null = null;
    const isCurrent = () => active && generation === projectReadGeneration.current && !!uid && user?.uid === uid;
    budgetProjectWorkspace.current = null; budgetRecoveryAction.current = null; budgetDraft.current = null;
    setHasPendingBudget(false); setPendingBudgetValue(undefined);
    const loadProjectDetails = async () => {
      if (!projectId || !uid) { setFullProject(null); setProjectDetails(null); setProjectDocuments([]); return; }

      try {
        let projectData: Project | null;
        if (isScopedProjectReadEnabled() || isNativeProjectLifecycleEnabled()) {
          nativeWorkspace = createNativeProjectWorkspace(projectId, undefined, uid);
          const snapshot = await nativeWorkspace.load();
          projectData = snapshot.project as unknown as Project;
          if (isCurrent()) {
            budgetProjectWorkspace.current = nativeWorkspace;
            try {
              budgetRecoveryAction.current = nativeWorkspace.recover('budget');
              const pendingBudget = budgetRecoveryAction.current?.pendingCommand;
              setHasPendingBudget(!!pendingBudget);
              setPendingBudgetValue(pendingBudget?.kind === 'budget' ? pendingBudget.amount : undefined);
            } catch {
              // An unreadable saved request still blocks new edits; it just has no amount to show.
              budgetRecoveryAction.current = null;
              setHasPendingBudget(true);
              setPendingBudgetValue(undefined);
            }
          }
        } else {
          projectData = await getProject(projectId, uid, () => { if (!isCurrent()) throw new Error('Account or project changed. Reopen this project.'); });
        }
        if (!isCurrent()) return;
        if (projectData) {
          const detail = projectData as Project & { projectName: string; clientName: string };
          setFullProject(detail);
          setProjectDetails({
            projectName: detail.projectName,
            projectId: detail.projectId,
            clientName: detail.clientName,
          });
        } else {
          projectReadGeneration.current += 1; materialReadGeneration.current += 1;
          setFullProject(null); setProjectDetails(null); setProjectDocuments([]); setCategories([]); setNativeMaterialVersion(null); setMaterialActionError('Project not found or you no longer have access.'); return;
        }

        // Load project documents
        const docs = await getProjectDocuments(projectId, { isCurrent });
        if (!isCurrent()) return;
        setProjectDocuments(docs);

        // Load approved users for Members tab (admins only — non-admins get permission denied)
        try {
          const result = await fetchAllUsers() as { users: Array<{ uid: string; email?: string; displayName?: string; customClaims?: { status?: string } }> };
          if (!isCurrent()) return;
          const approved = (result.users || [])
            .filter(u => u.customClaims?.status === 'approved')
            .map(u => ({ uid: u.uid, email: u.email || '', displayName: u.displayName || u.email || '' }));
          setApprovedUsers(approved);
        } catch {
          // Non-admin users won't have access to fetchAllUsers — silently ignore
        }
      } catch (error) {
        if (isCurrent()) {
          projectReadGeneration.current += 1; materialReadGeneration.current += 1;
          setFullProject(null); setProjectDetails(null); setProjectDocuments([]); setCategories([]); setNativeMaterialVersion(null); setMaterialActionError(projectLoadErrorMessage(error));
        }
      }
    };

    loadProjectDetails();
    return () => {
      active = false; nativeWorkspace?.invalidate();
      if (nativeWorkspace && budgetProjectWorkspace.current === nativeWorkspace) { budgetProjectWorkspace.current = null; budgetRecoveryAction.current = null; budgetDraft.current = null; }
    };
  }, [projectId, user?.uid, projectRefreshVersion]);

  // Load settings data (vendors, makes/brands, categories)
  useEffect(() => {
    const loadSettingsData = async () => {
      try {
        // Load vendors and brands in parallel
        const [vendorsData, brandsData] = await Promise.all([
          getVendors(),
          getBrands()
        ]);
        setVendors(vendorsData);

        // Extract brand names (active brands only) - these are the manufacturers/makes
        // Vendors are who we buy from, brands are who makes the part
        const brandNames = brandsData
          .filter(brand => brand.status === 'active')
          .map(brand => brand.name)
          .filter(name => name.trim() !== '');

        // Sort alphabetically
        const sortedBrands = [...new Set(brandNames)].sort();
        setAvailableMakes(sortedBrands);

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

    if (isNativeMaterialCommandEnabled()) {
      try {
        const current = categories.find(cat => cat.name === categoryName);
        if (!current) return;
        if (!nativeMaterialVersion) throw new Error('BOM revision is still loading. Refresh the page before editing.');
        await submitNativeMaterialCommand(projectId, { kind: 'category_state', category: categoryName, isExpanded: !current.isExpanded }, nativeMaterialVersion);
        setMaterialActionError(null);
      } catch (error) {
        setMaterialActionError(error instanceof Error ? error.message : 'Could not update this BOM category.');
      }
      return;
    }
    
    const updatedCategories = categories.map(cat => 
      cat.name === categoryName 
        ? { ...cat, isExpanded: !cat.isExpanded }
        : cat
    );
    await updateBOMData(projectId, updatedCategories);
  };

  const updateItemSafely = async (itemId: string, updates: Partial<BOMItem>) => {
    if (!projectId) return;
    try {
      if (isNativeMaterialCommandEnabled() && !nativeMaterialVersion) throw new Error('BOM revision is still loading. Refresh the page before editing.');
      await updateBOMItem(projectId, categories, itemId, updates, isNativeMaterialCommandEnabled() ? nativeMaterialVersion ?? undefined : undefined);
      setMaterialActionError(null);
      return true;
    } catch (error) {
      setMaterialActionError(error instanceof Error ? error.message : 'Could not update this BOM item.');
      return false;
    }
  };

  const handleQuantityChange = async (itemId: string, newQuantity: number) => {
    if (!projectId) return;
    await updateItemSafely(itemId, { quantity: newQuantity });
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

    const addedItem: BOMItem = {
      id: Date.now().toString(),
      itemType: newPart.itemType,
      name: newPart.name,
      description: newPart.description,
      category: finalCategory || '',
      quantity: newPart.quantity,
      vendors: [],
      status: 'not-ordered' as BOMStatus,
      ...(newPart.price !== undefined && { price: newPart.price }),
      ...(newPart.itemType === 'component' && newPart.make && { make: newPart.make }),
      ...(newPart.itemType === 'component' && newPart.sku && { sku: newPart.sku }),
    };
    const newCategories = updatedCategories.map(cat =>
      cat.name === finalCategory
        ? {
            ...cat,
            items: [...cat.items, addedItem]
          }
        : cat
    );

    if (isNativeMaterialCommandEnabled()) {
      try {
        if (!nativeMaterialVersion) throw new Error('BOM revision is still loading. Refresh the page before editing.');
        await submitNativeMaterialCommand(projectId, { kind: 'add_items', items: [addedItem as unknown as Record<string, unknown>] }, nativeMaterialVersion);
        setMaterialActionError(null);
      } catch (error) {
        setMaterialActionError(error instanceof Error ? error.message : 'Could not add this BOM item.');
        return;
      }
    } else {
      await updateBOMData(projectId, newCategories);
    }

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

    if (isNativeMaterialCommandEnabled()) {
      try {
        if (!nativeMaterialVersion) throw new Error('BOM revision is still loading. Refresh the page before editing.');
        await submitNativeMaterialCommand(projectId, { kind: 'move_category', category: oldName, destination: newName }, nativeMaterialVersion);
        setMaterialActionError(null);
      } catch (error) {
        setMaterialActionError(error instanceof Error ? error.message : 'Could not rename this BOM category.');
      }
    } else {
      await updateBOMData(projectId, remainingCategories);
    }
  };

  const handleDeletePart = async (itemId: string) => {
    if (!projectId) return;
    try {
      if (isNativeMaterialCommandEnabled() && !nativeMaterialVersion) throw new Error('BOM revision is still loading. Refresh the page before editing.');
      await deleteBOMItem(projectId, categories, itemId, isNativeMaterialCommandEnabled() ? nativeMaterialVersion ?? undefined : undefined);
      setMaterialActionError(null);
    } catch (error) {
      setMaterialActionError(error instanceof Error ? error.message : 'Could not delete this BOM item.');
    }
  };

  const handleUpdatePart = async (updatedPart: BOMItem) => {
    if (!projectId) return;
    await updateItemSafely(updatedPart.id, updatedPart);
  };

  const handleEditPart = async (itemId: string, updates: Partial<BOMItem>) => {
    if (!projectId) return;
    await updateItemSafely(itemId, updates);
  };

  // Calculate document count for a BOM item
  // Checks: 1) document's linkedBOMItems array, 2) item's linkedQuoteDocumentId, 3) item's linkedPODocumentId, 4) item's linkedInvoiceDocumentId
  const getDocumentCountForItem = (itemId: string): number => {
    // Find the item to check its linked document IDs
    let linkedQuoteDocId: string | undefined;
    let linkedPODocId: string | undefined;
    let linkedInvoiceDocId: string | undefined;
    for (const cat of categories) {
      const item = cat.items.find(i => i.id === itemId);
      if (item) {
        linkedQuoteDocId = item.linkedQuoteDocumentId;
        linkedPODocId = item.linkedPODocumentId;
        linkedInvoiceDocId = item.linkedInvoiceDocumentId;
        break;
      }
    }

    return projectDocuments.filter(doc => {
      const linkedViaDocument = doc.linkedBOMItems && doc.linkedBOMItems.includes(itemId);
      const linkedViaQuote = linkedQuoteDocId && doc.id === linkedQuoteDocId;
      const linkedViaPO = linkedPODocId && doc.id === linkedPODocId;
      const linkedViaInvoice = linkedInvoiceDocId && doc.id === linkedInvoiceDocId;
      return linkedViaDocument || linkedViaQuote || linkedViaPO || linkedViaInvoice;
    }).length;
  };

  // Get linked documents for a BOM item
  // Checks: 1) document's linkedBOMItems array, 2) item's linkedQuoteDocumentId, 3) item's linkedPODocumentId, 4) item's linkedInvoiceDocumentId
  const getDocumentsForItem = (itemId: string) => {
    // Find the item to check its linked document IDs
    let linkedQuoteDocId: string | undefined;
    let linkedPODocId: string | undefined;
    let linkedInvoiceDocId: string | undefined;
    for (const cat of categories) {
      const item = cat.items.find(i => i.id === itemId);
      if (item) {
        linkedQuoteDocId = item.linkedQuoteDocumentId;
        linkedPODocId = item.linkedPODocumentId;
        linkedInvoiceDocId = item.linkedInvoiceDocumentId;
        break;
      }
    }

    return projectDocuments
      .filter(doc => {
        const linkedViaDocument = doc.linkedBOMItems && doc.linkedBOMItems.includes(itemId);
        const linkedViaQuote = linkedQuoteDocId && doc.id === linkedQuoteDocId;
        const linkedViaPO = linkedPODocId && doc.id === linkedPODocId;
        const linkedViaInvoice = linkedInvoiceDocId && doc.id === linkedInvoiceDocId;
        return linkedViaDocument || linkedViaQuote || linkedViaPO || linkedViaInvoice;
      })
      .map(doc => ({
        id: doc.id,
        name: doc.name,
        type: doc.type,
        url: doc.url
      }));
  };

  // Unlink a document from a BOM item
  // Handles: 1) removing from document's linkedBOMItems, 2) clearing item's linkedPODocumentId/linkedInvoiceDocumentId
  const handleUnlinkDocument = async (documentId: string, itemId: string) => {
    const doc = projectDocuments.find(d => d.id === documentId);
    if (!doc) return;

    try {
      if (projectId && isNativeMaterialCommandEnabled()) {
        if (!nativeMaterialVersion) throw new Error('BOM revision is still loading. Refresh the page before editing.');
        await submitNativeMaterialCommand(projectId, { kind: 'link_document_delta', document_id: documentId, add_item_ids: [], remove_item_ids: [itemId] }, nativeMaterialVersion);
        setProjectDocuments(prev => prev.map(d => d.id === documentId ? { ...d, linkedBOMItems: (d.linkedBOMItems || []).filter(id => id !== itemId) } : d));
        setMaterialActionError(null);
        return;
      }
      // Check if document is linked via linkedBOMItems
      if (doc.linkedBOMItems && doc.linkedBOMItems.includes(itemId)) {
        const updatedLinkedItems = doc.linkedBOMItems.filter(id => id !== itemId);
        await linkDocumentToBOMItems(documentId, updatedLinkedItems);
        // Update local state
        setProjectDocuments(prev =>
          prev.map(d =>
            d.id === documentId
              ? { ...d, linkedBOMItems: updatedLinkedItems }
              : d
          )
        );
      }

      // Check if item has this document as linkedQuoteDocumentId, linkedPODocumentId, or linkedInvoiceDocumentId
      if (projectId) {
        for (const cat of categories) {
          const item = cat.items.find(i => i.id === itemId);
          if (item) {
            const updates: Partial<BOMItem> = {};
            if (item.linkedQuoteDocumentId === documentId) {
              updates.linkedQuoteDocumentId = undefined; // Clear the quote link
            }
            if (item.linkedPODocumentId === documentId) {
              updates.linkedPODocumentId = '' as any; // Empty string to clear
            }
            if (item.linkedInvoiceDocumentId === documentId) {
              updates.linkedInvoiceDocumentId = '' as any; // Empty string to clear
            }
            if (Object.keys(updates).length > 0) {
              await updateItemSafely(itemId, updates);
            }
            break;
          }
        }
      }
    } catch (error) {
      console.error('Error unlinking document:', error);
      setMaterialActionError(error instanceof Error ? error.message : 'Could not unlink this document from the BOM.');
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
      
      if (isNativeMaterialCommandEnabled()) {
        try {
          if (!nativeMaterialVersion) throw new Error('BOM revision is still loading. Refresh the page before editing.');
          await submitNativeMaterialCommand(projectId, { kind: 'patch_items', updates: [{ item_id: itemId, patch: { category: newCategory } }] }, nativeMaterialVersion);
          setMaterialActionError(null);
        } catch (error) {
          setMaterialActionError(error instanceof Error ? error.message : 'Could not move this BOM item.');
        }
      } else {
        await updateBOMData(projectId, updatedCategories);
      }
    }
  };

  const handleCreatePurchaseOrder = () => {
    setPRDialogOpen(true);
  };

  // Category scoping: external partners see only their assigned categories
  const currentMember = fullProject?.members?.find(m => m.userId === user?.uid);
  const visibleCategories = user
    ? getVisibleCategories(user.email || '', user.claims?.role || 'user', currentMember, categories)
    : categories;
  // Partners are non-admin, non-internal users — hide write actions outside their scope
  const isPartner = !!user && !isAdmin && !user.email?.toLowerCase().endsWith('@qualitastech.com');
  // IDs of BOM items that are within this partner's visible categories (used to scope Documents tab)
  const visibleItemIds = visibleCategories.flatMap(cat => cat.items.map(item => item.id));

  // Filtered categories based on search and filter selections
  const filteredCategories = visibleCategories
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

  // Group items by vendor for vendor view
  const itemsByVendor = useMemo(() => {
    const allFilteredItems = filteredCategories.flatMap(cat => 
      cat.items.map(item => ({ ...item, categoryName: cat.name }))
    );
    
    const grouped: Record<string, typeof allFilteredItems> = {};
    
    allFilteredItems.forEach(item => {
      const vendorName = item.finalizedVendor?.name || 'No Vendor Assigned';
      if (!grouped[vendorName]) {
        grouped[vendorName] = [];
      }
      grouped[vendorName].push(item);
    });
    
    // Sort: "No Vendor Assigned" first, then alphabetically
    const sortedKeys = Object.keys(grouped).sort((a, b) => {
      if (a === 'No Vendor Assigned') return -1;
      if (b === 'No Vendor Assigned') return 1;
      return a.localeCompare(b);
    });
    
    return sortedKeys.map(vendorName => ({
      vendorName,
      items: grouped[vendorName]
    }));
  }, [filteredCategories]);

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
          item.unit || (isService ? 'days' : 'pcs'),
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
    const allParts = visibleCategories.flatMap(cat => cat.items);
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

  const handleUpdateBudget = async (budget: number | undefined) => {
    if (!projectId) return;
    if (isScopedProjectReadEnabled()) {
      if (!isNativeProjectLifecycleEnabled()) throw new Error('Project budget changes are paused until the versioned project writer is enabled.');
      const workspace = budgetProjectWorkspace.current;
      if (!workspace) throw new Error('Reopen the project before changing its budget.');
      const isCurrent = () => budgetProjectWorkspace.current === workspace;
      const draft = budgetDraft.current;
      const action = budgetRecoveryAction.current || (draft?.workspace === workspace ? draft.action : null);
      if (!action) throw new Error('Reopen the budget editor before saving.');
      const requested = budget ?? null;
      const pending = action.pendingCommand;
      if (pending && (pending.kind !== 'budget' || pending.amount !== requested)) throw new Error('A different budget change is awaiting confirmation. Check it before editing again.');
      // Publish the recoverable state before the request leaves so a first transport failure is already recoverable.
      budgetRecoveryAction.current = action;
      setHasPendingBudget(true);
      setPendingBudgetValue(requested);
      try {
        await action.submit({ kind: 'budget', amount: requested });
        // Reconcile with a fresh authoritative read before the saved request is released.
        const snapshot = await workspace.load();
        if (!isCurrent()) throw new Error('The project changed while saving. Reopen it to confirm the budget.');
        await action.acknowledge();
        setFullProject(snapshot.project as unknown as Project);
        budgetRecoveryAction.current = null; budgetDraft.current = null;
        setHasPendingBudget(false);
        setPendingBudgetValue(undefined);
      } catch (error) {
        if (isCurrent()) {
          // Only a request that never reached the journal (validation, storage) may fall back to an editable draft.
          let stillPending = true;
          try { stillPending = !!action.pendingCommand; } catch { /* an unreadable saved request stays pending */ }
          if (!stillPending) { budgetRecoveryAction.current = null; setHasPendingBudget(false); setPendingBudgetValue(undefined); }
        }
        throw error;
      }
      return;
    }
    await updateProject(projectId, { internalBudget: budget });
    setFullProject(prev => prev ? { ...prev, internalBudget: budget } : prev);
  };

  const beginBudgetEdit = () => {
    if (!isScopedProjectReadEnabled()) return;
    const workspace = budgetProjectWorkspace.current;
    if (!workspace) throw new Error('Reopen the project before changing its budget.');
    budgetDraft.current = budgetRecoveryAction.current ? null : { workspace, action: workspace.capture('budget') };
  };

  const resolveBudgetRequest = async () => {
    const workspace = budgetProjectWorkspace.current;
    if (!workspace) throw new Error('Reopen the project before checking its saved budget change.');
    const action = budgetRecoveryAction.current;
    if (!action) throw new Error('The saved budget change cannot be read. Restore browser session storage, then reopen the project.');
    const isCurrent = () => budgetProjectWorkspace.current === workspace;
    // The outcome may be established first, but the saved request is only released after a fresh read.
    await action.resolve();
    const snapshot = await workspace.load();
    if (!isCurrent()) return;
    await action.acknowledge();
    if (!isCurrent()) return;
    setFullProject(snapshot.project as unknown as Project);
    budgetRecoveryAction.current = null; budgetDraft.current = null;
    setHasPendingBudget(false);
    setPendingBudgetValue(undefined);
  };

  const handleOrderDialogConfirm = async (data: OrderDialogData) => {
    if (!projectId || !selectedItemForOrder) {
      return;
    }

    const saved = await updateItemSafely(selectedItemForOrder.id, {
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
    if (saved === false) return;

    try {
      if (isNativeMaterialCommandEnabled()) {
        setOrderDialogOpen(false);
        return;
      }
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
    <div className="min-h-screen bg-background">
      {materialActionError && <div role="alert" className="mx-4 mt-4 rounded border border-destructive bg-destructive/10 p-3 text-sm text-destructive">{materialActionError}</div>}
      {legacyWritesDisabled && <div role="status" className="mx-4 mt-2 rounded border bg-muted p-3 text-sm">Material changes are currently read only.</div>}
      <main className="p-4">
        <div className="max-w-full mx-auto px-2">
            {/* BOM Header */}
            <BOMHeader
              projectName={projectDetails?.projectName || ''}
              projectId={projectDetails?.projectId || ''}
              clientName={projectDetails?.clientName || ''}
              {...calculateBOMMetrics()}
            />

            {/* Tab-based Layout */}
            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
              <TabsList className={`grid w-full mb-4 ${isPartner ? 'grid-cols-3' : 'grid-cols-7'}`}>
                <TabsTrigger value="costs" className="flex items-center gap-2">
                  <Package size={16} />
                  Costs
                  <Badge variant="secondary" className="ml-1 text-xs">
                    {visibleCategories.flatMap(cat => cat.items).length}
                  </Badge>
                </TabsTrigger>
                <TabsTrigger value="inward-tracking" className="flex items-center gap-2">
                  <Package size={16} />
                  Inward Tracking
                  {(() => {
                    const orderedCount = visibleCategories.flatMap(cat => cat.items)
                      .filter(item => item.status === 'ordered' || item.status === 'received').length;
                    return orderedCount > 0 ? (
                      <Badge variant="secondary" className="ml-1 text-xs">{orderedCount}</Badge>
                    ) : null;
                  })()}
                </TabsTrigger>
                <TabsTrigger value="documents" className="flex items-center gap-2">
                  <FileText size={16} />
                  Documents
                  <Badge variant="secondary" className="ml-1 text-xs">
                    {projectDocuments.length}
                  </Badge>
                </TabsTrigger>
                {!isPartner && (
                  <TabsTrigger value="communications" className="flex items-center gap-2">
                    <Video size={16} />
                    Communications
                  </TabsTrigger>
                )}
                {!isPartner && (
                  <TabsTrigger value="milestones" className="flex items-center gap-2">
                    <Milestone size={16} />
                    Milestones
                  </TabsTrigger>
                )}
                {!isPartner && (
                  <TabsTrigger value="context" className="flex items-center gap-2">
                    <Brain size={16} />
                    Context
                  </TabsTrigger>
                )}
                {!isPartner && (
                  <TabsTrigger value="members" className="flex items-center gap-2">
                    <UserCheck size={16} />
                    Members
                    <Badge variant="secondary" className="ml-1 text-xs">
                      {fullProject?.members?.length ?? 0}
                    </Badge>
                  </TabsTrigger>
                )}
              </TabsList>

              {/* Costs Tab (BOM Items + Overheads) */}
              <TabsContent value="costs" className="mt-0">
                {/* Budget bar */}
                {projectId && !isPartner && (
                  <ProjectCostBar
                    budget={fullProject?.internalBudget}
                    bomCost={calculateBOMMetrics().totalCost}
                    overheadCost={overheadTotal}
                    canEdit={isAdmin && (!isScopedProjectReadEnabled() || isNativeProjectLifecycleEnabled())}
                    onUpdateBudget={handleUpdateBudget}
                    onBeginEdit={beginBudgetEdit}
                    hasPendingRequest={hasPendingBudget}
                    pendingBudget={pendingBudgetValue}
                    onResolvePendingRequest={resolveBudgetRequest}
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
                    {!isPartner && (
                    <Button variant="outline" disabled={legacyWritesDisabled} onClick={() => setAddPartOpen(true)}>
                        <Plus className="mr-2 h-4 w-4" />
                        Add Part
                      </Button>
                    )}
                    {!isPartner && (
                    <Button variant="outline" disabled={legacyWritesDisabled} onClick={() => setImportBOMOpen(true)}>
                        <Upload className="mr-2 h-4 w-4" />
                        Import BOM
                      </Button>
                    )}
                  </div>

                  <div className="flex gap-2">
                    <Button variant="outline" onClick={() => setFilterOpen(true)}>
                      <Filter className="mr-2 h-4 w-4" />
                      Filter
                    </Button>
                    {!isPartner && (
                      <Button variant="outline" onClick={handleExportCSV}>
                        <Download className="mr-2 h-4 w-4" />
                        Export
                      </Button>
                    )}
                    <Button variant="outline" disabled={legacyWritesDisabled} onClick={handleCreatePurchaseOrder}>
                      Create PR
                    </Button>
                    {!isPartner && (
                      <Button variant="outline" disabled={legacyWritesDisabled} onClick={() => setPODialogOpen(true)}>
                        <FileText className="mr-2 h-4 w-4" />
                        Create PO
                      </Button>
                    )}
                    {!isPartner && <ComplianceChecker
                      projectId={projectId || ''}
                      categories={visibleCategories}
                      vendorQuotes={projectDocuments.filter(d => d.type === 'vendor-quote')}
                      existingMakes={availableMakes}
                      existingCategories={canonicalCategoryNames}
                      onFixApplied={async (itemId, updates) => {
                        if (!projectId) return;
                        await updateItemSafely(itemId, updates);
                      }}
                    />}
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

                {/* Group By Toggle */}
                <div className="flex items-center gap-2 mb-4">
                  <span className="text-sm text-gray-500">Group by:</span>
                  <div className="flex rounded-md border">
                    <Button
                      variant={groupBy === 'category' ? 'default' : 'ghost'}
                      size="sm"
                      onClick={() => setGroupBy('category')}
                      className="rounded-r-none"
                    >
                      Category
                    </Button>
                    <Button
                      variant={groupBy === 'vendor' ? 'default' : 'ghost'}
                      size="sm"
                      onClick={() => setGroupBy('vendor')}
                      className="rounded-l-none"
                    >
                      Vendor
                    </Button>
                  </div>
                </div>

                {/* BOM Content - Single Column Layout */}
                <div className="space-y-4">
                  {groupBy === 'category' ? (
                    /* Category View */
                    <>
                      {filteredCategories.map((category) => (
                        <BOMCategoryCard
                      key={category.name}
                      category={category}
                      projectId={projectId}
                      onToggle={() => toggleCategory(category.name)}
                      onQuantityChange={legacyWritesDisabled ? undefined : handleQuantityChange}
                      onDeletePart={legacyWritesDisabled ? undefined : handleDeletePart}
                      onDeleteCategory={legacyWritesDisabled ? undefined : (categoryName) => {
                        // Handle category deletion - remove the entire category
                        if (projectId) {
                          if (isNativeMaterialCommandEnabled()) {
                            if (!nativeMaterialVersion) {
                              setMaterialActionError('BOM revision is still loading. Refresh the page before editing.');
                              return;
                            }
                            submitNativeMaterialCommand(projectId, { kind: 'delete_category', category: categoryName }, nativeMaterialVersion)
                              .then(() => setMaterialActionError(null))
                              .catch(error => setMaterialActionError(error instanceof Error ? error.message : 'Could not delete this BOM category.'));
                          } else {
                            const updatedCategories = categories.filter(cat => cat.name !== categoryName);
                            updateBOMData(projectId, updatedCategories);
                          }
                        }
                      }}
                      onStatusChange={legacyWritesDisabled ? undefined : (itemId, newStatus) => {
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

                        // If changing to "ordered", refresh documents and show the order dialog
                        if (newStatus === 'ordered' && targetItem) {
                          // Services don't use the PO order dialog.
                          if (targetItem.itemType === 'service') {
                            updateItemSafely(itemId, { status: newStatus as BOMStatus });
                            return;
                          }
                          // Refresh documents to get latest linkedBOMItems data
                          getProjectDocuments(projectId).then(docs => {
                            setProjectDocuments(docs);
                            setSelectedItemForOrder(targetItem);
                            setOrderDialogOpen(true);
                          });
                          return;
                        }

                        // If changing to "received", refresh documents and show the receive dialog
                        if (newStatus === 'received' && targetItem) {
                          // Refresh documents to get latest data
                          getProjectDocuments(projectId).then(docs => {
                            setProjectDocuments(docs);
                            setSelectedItemForReceive(targetItem);
                            setReceiveDialogOpen(true);
                          });
                          return;
                        }

                        // For other status changes, update directly
                        updateItemSafely(itemId, { status: newStatus as BOMStatus });
                      }}
                      onEditPart={legacyWritesDisabled ? undefined : handleEditPart}
                      onPartCategoryChange={legacyWritesDisabled ? undefined : handlePartCategoryChange}
                      availableCategories={canonicalCategoryNames}
                      onUpdatePart={legacyWritesDisabled ? undefined : handleUpdatePart}
                      getDocumentCount={getDocumentCountForItem}
                      getDocumentsForItem={getDocumentsForItem}
                      onUnlinkDocument={legacyWritesDisabled ? undefined : handleUnlinkDocument}
                      vendors={vendors}
                      projectDocuments={projectDocuments}
                    />
                  ))}

                      {filteredCategories.length === 0 && (
                        <Card>
                          <CardContent className="p-8 text-center">
                            <p className="text-muted-foreground">No parts found matching your search criteria.</p>
                          </CardContent>
                        </Card>
                      )}
                    </>
                  ) : (
                    /* Vendor View */
                    <>
                      {itemsByVendor.map(({ vendorName, items }) => (
                        <Collapsible
                          key={vendorName}
                          open={expandedVendors.has(vendorName)}
                          onOpenChange={() => toggleVendor(vendorName)}
                        >
                          <Card className="overflow-hidden">
                            <CollapsibleTrigger asChild>
                              <div className="p-4 bg-gray-50 border-b flex items-center justify-between cursor-pointer hover:bg-gray-100">
                                <div className="flex items-center gap-2">
                                  {expandedVendors.has(vendorName) ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                                  <span className={vendorName === 'No Vendor Assigned' ? 'text-orange-600 font-medium' : 'font-medium'}>
                                    {vendorName}
                                  </span>
                                  <Badge variant="outline">{items.length} item{items.length !== 1 ? 's' : ''}</Badge>
                                </div>
                              </div>
                            </CollapsibleTrigger>
                            <CollapsibleContent>
                              <CardContent className="p-0">
                                {items.map(item => (
                                  <BOMPartRow
                                    key={item.id}
                                    part={item}
                                    projectId={projectId}
                                    onClick={() => {}}
                                    onQuantityChange={legacyWritesDisabled ? undefined : handleQuantityChange}
                                    onDelete={legacyWritesDisabled ? undefined : handleDeletePart}
                                    onStatusChange={legacyWritesDisabled ? undefined : (itemId, newStatus) => {
                                      if (!projectId) return;

                                      // Find the item
                                      let targetItem: BOMItem | null = null;
                                      for (const cat of categories) {
                                        const found = cat.items.find(i => i.id === itemId);
                                        if (found) {
                                          targetItem = found;
                                          break;
                                        }
                                      }

                                      // If changing to "ordered", show the order dialog
                                      if (newStatus === 'ordered' && targetItem) {
                                        // Services don't use the PO order dialog.
                                        if (targetItem.itemType === 'service') {
                                          updateItemSafely(itemId, { status: newStatus as BOMStatus });
                                          return;
                                        }
                                        getProjectDocuments(projectId).then(docs => {
                                          setProjectDocuments(docs);
                                          setSelectedItemForOrder(targetItem);
                                          setOrderDialogOpen(true);
                                        });
                                        return;
                                      }

                                      // If changing to "received", show the receive dialog
                                      if (newStatus === 'received' && targetItem) {
                                        getProjectDocuments(projectId).then(docs => {
                                          setProjectDocuments(docs);
                                          setSelectedItemForReceive(targetItem);
                                          setReceiveDialogOpen(true);
                                        });
                                        return;
                                      }

                                      // For other status changes, update directly
                                      updateItemSafely(itemId, { status: newStatus as BOMStatus });
                                    }}
                                    onEdit={legacyWritesDisabled ? undefined : handleEditPart}
                                    onCategoryChange={legacyWritesDisabled ? undefined : handlePartCategoryChange}
                                    availableCategories={canonicalCategoryNames}
                                    linkedDocumentsCount={getDocumentCountForItem(item.id)}
                                    linkedDocuments={getDocumentsForItem(item.id)}
                                    onUnlinkDocument={legacyWritesDisabled ? undefined : handleUnlinkDocument}
                                    globalVendors={vendors.map(v => ({
                                      id: v.id,
                                      company: v.company,
                                      leadTime: v.leadTime,
                                      type: v.type,
                                      status: v.status
                                    }))}
                                    projectDocuments={projectDocuments}
                                  />
                                ))}
                              </CardContent>
                            </CollapsibleContent>
                          </Card>
                        </Collapsible>
                      ))}
                      {itemsByVendor.length === 0 && (
                        <Card>
                          <CardContent className="p-8 text-center">
                            <p className="text-muted-foreground">No parts found matching your search criteria.</p>
                          </CardContent>
                        </Card>
                      )}
                    </>
                  )}
                </div>

                {/* Overheads section (inside Costs tab) */}
                {projectId && user && !isPartner && (
                  <div className="mt-6 border-t pt-6">
                    <OverheadsTab
                      projectId={projectId}
                      projectName={fullProject?.projectName ?? ''}
                      members={fullProject?.members ?? []}
                      currentUserId={user.uid}
                      isAdmin={isAdmin}
                      onTotalChange={setOverheadTotal}
                    />
                  </div>
                )}
              </TabsContent>

              {/* Inward Tracking Tab */}
              <TabsContent value="inward-tracking" className="mt-0">
                <InwardTracking
                  categories={visibleCategories}
                  documents={projectDocuments}
                  onItemClick={(item) => {
                    console.log('Item clicked:', item.name);
                  }}
                  onUpdatePONumber={(itemId, poNumber) => {
                    if (projectId) {
                      updateItemSafely(itemId, { poNumber });
                    }
                  }}
                  fullPage={true}
                  projectId={projectId}
                />
              </TabsContent>

              {/* Milestones Tab */}
              <TabsContent value="milestones" className="mt-0 space-y-4">
                {/* Milestones List */}
                {projectId && <MilestoneList projectId={projectId} />}

                {/* Daily Updates - activities extracted from transcripts */}
                {projectId && projectDetails && (
                  <ProjectActivityTimeline
                    projectId={projectId}
                    projectName={projectDetails.projectName}
                  />
                )}
              </TabsContent>

              {/* Documents Tab */}
              <TabsContent value="documents" className="mt-0">
                {projectId && (
                  <ProjectDocuments
                    projectId={projectId}
                    bomItems={visibleCategories.flatMap(cat => cat.items)}
                    filterItemIds={isPartner ? visibleItemIds : undefined}
                    onDocumentsChange={documents => {
                      if (currentDocumentContext.current === documentContext) setProjectDocuments(documents);
                    }}
                    awaitConfirmation={isNativeMaterialCommandEnabled()}
                    confirmationContext={documentContext}
                    onDocumentLinkOpen={openDocumentLinks}
                    onSaveDocumentLinks={saveDocumentLinks}
                    onBOMItemUpdate={async (itemId: string, updates: Partial<BOMItem>) => {
                      if (projectId) {
                        await updateItemSafely(itemId, updates);
                      }
                    }}
                    fullPage={true}
                    renderAfterSection={{
                      sectionType: 'vendor-quote',
                      content: (
                        <POListSection
                          projectId={projectId}
                          onNativeSaved={() => {
                            // The server finalized the PO, linked materials and document atomically; re-read them
                            // instead of writing client state. A callback from another project/account is ignored.
                            const savedUid = user?.uid;
                            if (poContextRef.current.projectId !== projectId || poContextRef.current.uid !== savedUid) return;
                            projectReadGeneration.current += 1;
                            setProjectRefreshVersion(version => version + 1);
                            void refreshMaterialRef.current?.();
                          }}
                        />
                      )
                    }}
                  />
                )}
              </TabsContent>

              {/* Communications Tab */}
              <TabsContent value="communications" className="mt-0">
                {projectId && fullProject && (
                  <ProjectCommunicationsTab
                    projectId={projectId}
                    project={fullProject}
                    onProjectUpdated={(updated) => setFullProject(updated)}
                  />
                )}
              </TabsContent>

              {/* Context Tab - Project Intelligence for Transcripts */}
              <TabsContent value="context" className="mt-0">
                {projectId && projectDetails && (
                  <ProjectContextEditor
                    projectId={projectId}
                    project={{
                      projectId,
                      projectName: projectDetails.projectName,
                      clientName: projectDetails.clientName,
                      description: '',
                      status: 'Ongoing',
                      deadline: '',
                    }}
                    bomCategories={categories}
                  />
                )}
              </TabsContent>

              {/* Members Tab */}
              <TabsContent value="members" className="mt-0">
                {fullProject && (
                  <ProjectMembersTab
                    projectId={projectId || ''}
                    project={fullProject}
                    currentUserId={user?.uid || ''}
                    isAdmin={isAdmin}
                    categoryNames={categories.map(c => c.name)}
                    availableUsers={approvedUsers}
                    onProjectUpdated={(updated) => setFullProject(updated)}
                  />
                )}
              </TabsContent>
            </Tabs>
          </div>
        </main>

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
              {visibleCategories.map(cat => (
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
                        {availableMakes.length === 0 && (
                          <SelectItem value="__NO_BRANDS__" disabled>No brands found. Add brands in Settings.</SelectItem>
                        )}
                        {availableMakes
                          .filter(make => make && make.trim() !== '') // Filter out empty makes
                          .sort((a, b) => a.localeCompare(b))
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
            const showSuccess = () => {
              setImportBOMOpen(false);
              setImportSuccess(`Successfully imported ${importedItems.length} BOM items!`);
              setTimeout(() => setImportSuccess(null), 5000);
            };
            if (isNativeMaterialCommandEnabled()) {
              if (!nativeMaterialVersion) {
                setMaterialActionError('BOM revision is still loading. Refresh the page before importing.');
                return;
              }
              submitNativeMaterialCommand(projectId, { kind: 'add_items', items: importedItems as unknown as Array<Record<string, unknown>> }, nativeMaterialVersion)
                .then(() => { setMaterialActionError(null); showSuccess(); })
                .catch(error => setMaterialActionError(error instanceof Error ? error.message : 'Could not import these BOM items.'));
            } else {
              updateBOMData(projectId, updatedCategories).then(showSuccess).catch(error => setMaterialActionError(error instanceof Error ? error.message : 'Could not import these BOM items.'));
            }
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
          categories={visibleCategories}
          vendors={vendors}
          documents={projectDocuments}
        />
      )}

      {/* Create PO Dialog */}
      {projectDetails && (
        <CreatePODialog
          open={poDialogOpen}
          onOpenChange={setPODialogOpen}
          projectId={projectId!}
          projectName={projectDetails.projectName}
          projectBillingEntityId={projectDetails.billingEntityId}
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
          availablePODocuments={getOutgoingPODocuments(projectDocuments)}
          vendors={vendors}
          onConfirm={handleOrderDialogConfirm}
          onDocumentUploaded={(newDoc) => {
            // Add the new document to the list
            setProjectDocuments(prev => prev.some(document => document.id === newDoc.id) ? prev : [...prev, newDoc]);
          }}
        />
      )}

      {/* Receive Item Dialog - shown when changing status to "received" */}
      {projectId && (
        <ReceiveItemDialog
          open={receiveDialogOpen}
          onOpenChange={setReceiveDialogOpen}
          item={selectedItemForReceive}
          projectId={projectId}
          availableVendorQuotes={projectDocuments.filter(doc => doc.type === 'vendor-invoice')}
          onConfirm={(data) => {
            if (selectedItemForReceive && projectId) {
              const item = selectedItemForReceive;
              if (isNativeMaterialCommandEnabled()) {
                if (!nativeMaterialVersion) throw new Error('BOM revision is still loading. Refresh the page before recording receipt.');
                submitNativeMaterialFulfillment(projectId, item.id, {
                  kind: item.itemType === 'service' ? 'fulfillment' : 'receipt', quantity: data.receivedQty,
                  ...(item.itemType !== 'service' && { loggedAt: data.actualArrival, invoiceDocId: data.linkedInvoiceDocumentId, photoUrl: data.receivedPhotoUrl }),
                }, nativeMaterialVersion).then(() => setMaterialActionError(null))
                  .catch(error => setMaterialActionError(error instanceof Error ? error.message : 'Could not record this receipt.'));
                setSelectedItemForReceive(null);
                return;
              }
              const newTranche: FulfillmentTranche = {
                id: `tranche-${Date.now()}`,
                quantity: data.receivedQty,
                invoiceDocId: data.linkedInvoiceDocumentId,
                loggedAt: data.actualArrival,
              };
              const allTranches = [...(item.fulfillmentTranches || []), newTranche];
              const totalReceived = allTranches.reduce((sum, t) => sum + t.quantity, 0);
              updateItemSafely(item.id, {
                status: totalReceived >= item.quantity ? 'received' : 'ordered',
                actualArrival: item.actualArrival || data.actualArrival,
                linkedInvoiceDocumentId: data.linkedInvoiceDocumentId,
                receivedPhotoUrl: data.receivedPhotoUrl,
                fulfillmentTranches: allTranches,
              });
            }
            setSelectedItemForReceive(null);
          }}
          onDocumentUploaded={(newDoc) => {
            // Add the new invoice document to the list
            setProjectDocuments(prev => prev.some(document => document.id === newDoc.id) ? prev : [...prev, newDoc]);
          }}
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

const BOM = () => {
  const { projectId = '' } = useParams<{ projectId: string }>();
  const { user, isAdmin } = useAuth();
  return <BOMContent key={JSON.stringify([projectId, user?.uid ?? null, isAdmin])} />;
};

export default BOM;
