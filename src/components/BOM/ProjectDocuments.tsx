import React, { useState, useEffect, useMemo, useRef } from 'react';
import { FileText, Upload, Trash2, Link as LinkIcon, X, AlertCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/components/ui/use-toast';
import { auth } from '@/firebase';
import { isNativeMaterialCommandEnabled, submitNativeMaterialCommand } from '@/utils/nativeMaterialCommands';
import {
  uploadProjectDocument,
  getProjectDocuments,
  deleteProjectDocument,
  linkDocumentToBOMItems,
  acknowledgeProjectDocumentUpload,
  acknowledgeProjectDocumentDeletion
} from '@/utils/projectDocumentFirestore';
import {nativeProjectDocumentsEnabled} from '@/utils/projectDocumentMode';
import {isScopedProjectReadEnabled} from '@/utils/projectReadMode';
import {getPendingNativeProjectDocumentTypes} from '@/utils/nativeProjectDocumentUpload';
import ProjectDocumentRecovery from './ProjectDocumentRecovery';
import { validateDocumentDeletion } from '@/utils/bomDocumentLinking';
import { ProjectDocument, DocumentType, DocumentTypeSection, BOM_DOCUMENT_SECTIONS } from '@/types/projectDocument';
import { BOMItem } from '@/types/bom';

interface ProjectDocumentsProps {
  projectId: string;
  bomItems: BOMItem[]; // BOM items for linking (pass only visible items for partners)
  onDocumentsChange?: (documents: ProjectDocument[]) => void | Promise<void>;
  onBOMItemUpdate?: (itemId: string, updates: Partial<BOMItem>) => Promise<void>; // Callback to update BOM items
  fullPage?: boolean; // When true, renders without collapsible wrapper for tab view
  sections?: DocumentTypeSection[]; // Document sections to show (defaults to BOM_DOCUMENT_SECTIONS)
  renderAfterSection?: { sectionType: DocumentType; content: React.ReactNode }; // Render content after specific section
  filterItemIds?: string[]; // When set, only show documents linked to these BOM item IDs (used for partner scoping)
  awaitConfirmation?: boolean; // Opt in: link saves go only through onSaveDocumentLinks, awaited, with no direct Firestore link/item writes
  confirmationContext?: string; // Identity of the data the dialog opened against; a change discards the open dialog and any pending result
  onDocumentLinkOpen?: (document: ProjectDocument) => void;
  onSaveDocumentLinks?: (document: ProjectDocument, addedItemIds: string[], removedItemIds: string[]) => Promise<void>;
  materialVersion?: string | null;
}

const ProjectDocuments = ({ projectId, bomItems, onDocumentsChange, onBOMItemUpdate, fullPage = false, sections = BOM_DOCUMENT_SECTIONS, renderAfterSection, filterItemIds, awaitConfirmation = false, confirmationContext, onDocumentLinkOpen, onSaveDocumentLinks, materialVersion }: ProjectDocumentsProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [documents, setDocuments] = useState<ProjectDocument[]>([]);
  const [uploading, setUploading] = useState(false);
  const [documentBusy,setDocumentBusy] = useState(false);
  const documentBusyRef = useRef(false);
  const documentMounted = useRef(true);
  const documentScope = JSON.stringify([projectId,auth.currentUser?.uid]);
  const documentScopeRef = useRef(documentScope);
  documentScopeRef.current = documentScope;
  const [selectedType, setSelectedType] = useState<DocumentType>('vendor-quote');
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [selectedDocument, setSelectedDocument] = useState<ProjectDocument | null>(null);
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const [savingLinks, setSavingLinks] = useState(false);
  const { toast } = useToast();
  const savingLinksRef = useRef(false);
  const generationRef = useRef(0);
  const openingActorUidRef = useRef<string | undefined>(undefined);
  const openingLinkedIdsRef = useRef<string[]>([]);
  const openingContextRef = useRef<string | undefined>(undefined);

  // A native dialog is bound to the context and account it was opened against.
  const nativeContext = confirmationContext;
  const scopedReadsOn = isScopedProjectReadEnabled();
  const documentWritesUnavailable = scopedReadsOn && !nativeProjectDocumentsEnabled();
  const linkWritesUnavailable = scopedReadsOn && (awaitConfirmation ? !onSaveDocumentLinks : !isNativeMaterialCommandEnabled());
  useEffect(() => {
    // Keep an open form visible but locked if its paired write route closes;
    // still discard it when the account or project context changes.
    if (!awaitConfirmation && scopedReadsOn && openingContextRef.current === nativeContext) {
      savingLinksRef.current = false;
      setSavingLinks(false);
      return;
    }
    if (!awaitConfirmation) return;
    generationRef.current += 1;
    savingLinksRef.current = false;
    setSavingLinks(false);
    setLinkDialogOpen(false);
    setSelectedDocument(null);
    setSelectedItemIds([]);
  }, [awaitConfirmation, nativeContext]);

  useEffect(()=>{documentMounted.current=true;return()=>{documentMounted.current=false;};},[]);
  // Clear old rows immediately when switching project/account. Every async
  // completion checks the captured scope before updating this view.
  useEffect(() => {
    documentBusyRef.current=false;setDocumentBusy(false);setUploading(false);setDocuments([]);
    if (projectId) void loadDocuments();
  }, [documentScope]);

  const loadDocuments = async (throwOnError = false) => {
    const scope=documentScope,uid=auth.currentUser?.uid;
    const current=()=>documentMounted.current && documentScopeRef.current===scope && auth.currentUser?.uid===uid;
    try {
      const docs = await getProjectDocuments(projectId,{isCurrent:current});
      if(!current()) {if(throwOnError)throw Error('The document context changed.');return;}
      setDocuments(docs);
      await onDocumentsChange?.(docs); // Keep the parent in sync with the verified list
    } catch (error) {
      if(throwOnError)throw error;
      if(!current())return;
      console.error('Error loading documents:', error);
      toast({
        title: 'Error',
        description: 'Failed to load documents',
        variant: 'destructive'
      });
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, type: DocumentType) => {
    if (!e.target.files || !e.target.files[0]) return;
    if (documentWritesUnavailable) { e.target.value = ''; return; }
    if(documentBusyRef.current){e.target.value='';return;}
    const file = e.target.files[0];
    const input=e.target,scope=documentScope,uid=auth.currentUser?.uid;
    const current=()=>documentMounted.current && documentScopeRef.current===scope && auth.currentUser?.uid===uid;
    let saved=false;
    documentBusyRef.current=true;setDocumentBusy(true);
    setUploading(true);

    try {
      const user = auth.currentUser;
      if (!user) throw new Error('User not authenticated');

      const native=nativeProjectDocumentsEnabled() || getPendingNativeProjectDocumentTypes(user.uid,projectId).includes(type);
      const result=native
        ? await uploadProjectDocument(file,projectId,type,user.uid,{isCurrent:current})
        : await uploadProjectDocument(file,projectId,type,user.uid);
      saved=true;if(!current())return;
      await loadDocuments(true);if(!current())return;
      if(result.pulseNativeDocument){await acknowledgeProjectDocumentUpload(projectId,type,user.uid,{isCurrent:current});if(!current())return;}

      toast({
        title: 'Success',
        description: 'Document uploaded successfully'
      });
    } catch (error) {
      if(!current())return;
      console.error('Error uploading document:', error);
      toast({
        title: saved?'Document saved':'Upload Failed',
        description: saved?'The document was saved, but the view could not refresh. Retry its saved request before uploading again.':error instanceof Error ? error.message : 'Failed to upload document',
        variant: 'destructive'
      });
    } finally {
      if(current()){documentBusyRef.current=false;setDocumentBusy(false);setUploading(false);}
      input.value = '';
    }
  };

  const handleDelete = async (doc: ProjectDocument) => {
    if (documentWritesUnavailable) return;
    if(documentBusyRef.current)return;
    // Validate deletion based on document type and linked BOM items
    const validation = validateDocumentDeletion(doc, bomItems);

    if (!validation.canDelete) {
      const title = doc.type === 'vendor-po' ? 'Cannot Delete PO' : 'Cannot Delete Invoice';
      toast({
        title,
        description: validation.reason,
        variant: 'destructive'
      });
      return;
    }

    if (!window.confirm(`Delete "${doc.name}"?`)) return;
    const scope=documentScope,uid=auth.currentUser?.uid;
    const current=()=>documentMounted.current && documentScopeRef.current===scope && auth.currentUser?.uid===uid;
    let saved=false;documentBusyRef.current=true;setDocumentBusy(true);
    try {
      const native=nativeProjectDocumentsEnabled() || !!doc.nativeOpening || !!doc.pulseNativeDocument;
      if(native)await deleteProjectDocument(doc.id,doc.url,doc,{isCurrent:current});
      else await deleteProjectDocument(doc.id,doc.url);
      saved=true;if(!current())return;
      await loadDocuments(true);if(!current())return;
      if(native && uid){await acknowledgeProjectDocumentDeletion(projectId,doc.id,uid,{isCurrent:current});if(!current())return;}

      toast({
        title: 'Success',
        description: 'Document deleted successfully'
      });
    } catch (error) {
      if(!current())return;
      console.error('Error deleting document:', error);
      toast({
        title: saved?'Deletion saved':'Delete Failed',
        description: saved?'The deletion is confirmed, but the view could not refresh. Retry its saved request to refresh.':error instanceof Error?error.message:'Failed to delete document',
        variant: 'destructive'
      });
    } finally {
      if(current()){documentBusyRef.current=false;setDocumentBusy(false);}
    }
  };

  const handleOpenLinkDialog = (doc: ProjectDocument) => {
    if (linkWritesUnavailable) return;
    if (awaitConfirmation) {
      try { onDocumentLinkOpen?.(doc); }
      catch (error) { toast({ title: 'Cannot open material links', description: (error as Error).message, variant: 'destructive' }); return; }
    }
    setSelectedDocument(doc);
    setSelectedItemIds(doc.linkedBOMItems || []);
    openingLinkedIdsRef.current = [...(doc.linkedBOMItems || [])];
    openingActorUidRef.current = auth.currentUser?.uid;
    openingContextRef.current = nativeContext;
    setLinkDialogOpen(true);
  };

  const handleLinkDialogOpenChange = (open: boolean) => {
    if (awaitConfirmation && savingLinksRef.current && !open) return;
    setLinkDialogOpen(open);
  };

  const closeLinkDialog = () => {
    setLinkDialogOpen(false);
    setSelectedDocument(null);
    setSelectedItemIds([]);
  };

  const handleSaveNativeLinks = async () => {
    if (linkWritesUnavailable) return;
    if (!selectedDocument || savingLinksRef.current) return;

    if (!onSaveDocumentLinks) {
      toast({ title: 'Error', description: 'Document links cannot be saved right now', variant: 'destructive' });
      return;
    }
    const actorUid = openingActorUidRef.current;
    if (!actorUid || auth.currentUser?.uid !== actorUid || openingContextRef.current !== nativeContext) {
      toast({ title: 'Error', description: 'The account or project data changed. Close this dialog and try again.', variant: 'destructive' });
      return;
    }

    const opening = openingLinkedIdsRef.current;
    const selected = Array.from(new Set(selectedItemIds));
    const addedItemIds = selected.filter(id => !opening.includes(id));
    const removedItemIds = opening.filter(id => !selected.includes(id));
    if (addedItemIds.length === 0 && removedItemIds.length === 0) {
      closeLinkDialog();
      return;
    }

    const document = selectedDocument;
    const generation = generationRef.current;
    savingLinksRef.current = true;
    setSavingLinks(true);
    try {
      await onSaveDocumentLinks(document, addedItemIds, removedItemIds);
    } catch (error) {
      if (generationRef.current !== generation) return;
      console.error('Error updating links:', error);
      savingLinksRef.current = false;
      setSavingLinks(false);
      toast({
        title: 'Error',
        description: error instanceof Error && error.message ? error.message : 'Failed to update document links',
        variant: 'destructive'
      });
      return;
    }
    if (generationRef.current !== generation) return;
    savingLinksRef.current = false;
    setSavingLinks(false);
    if (auth.currentUser?.uid !== actorUid) {
      generationRef.current += 1;
      closeLinkDialog();
      return;
    }
    await loadDocuments();
    if (generationRef.current !== generation) return;
    toast({ title: 'Success', description: 'Document links updated' });
    closeLinkDialog();
  };

  const handleSaveLinks = async () => {
    if (linkWritesUnavailable) return;
    if (awaitConfirmation) return handleSaveNativeLinks();
    if (!selectedDocument) return;

    try {
      // Get previous linked items to know which ones to unlink
      const previousLinkedIds = selectedDocument.linkedBOMItems || [];
      const unlinkedIds = previousLinkedIds.filter(id => !selectedItemIds.includes(id));

      if (isNativeMaterialCommandEnabled()) {
        if (!materialVersion) throw new Error('BOM revision is still loading. Refresh the page before changing document links.');
        const addedIds = selectedItemIds.filter(id => !previousLinkedIds.includes(id));
        if (addedIds.length || unlinkedIds.length) {
          await submitNativeMaterialCommand(projectId, {
            kind: 'link_document_delta', document_id: selectedDocument.id,
            add_item_ids: addedIds, remove_item_ids: unlinkedIds,
          }, materialVersion);
        }
      } else {
        await linkDocumentToBOMItems(selectedDocument.id, selectedItemIds);

        if (selectedDocument.type === 'vendor-quote' && onBOMItemUpdate) {
          for (const itemId of selectedItemIds) await onBOMItemUpdate(itemId, { linkedQuoteDocumentId: selectedDocument.id });
          for (const itemId of unlinkedIds) await onBOMItemUpdate(itemId, { linkedQuoteDocumentId: undefined });
        }

        if (selectedDocument.type === 'vendor-po' && onBOMItemUpdate) {
          for (const itemId of selectedItemIds) await onBOMItemUpdate(itemId, { linkedPODocumentId: selectedDocument.id });
          for (const itemId of unlinkedIds) await onBOMItemUpdate(itemId, { linkedPODocumentId: undefined });
        }
      }

      await loadDocuments();

      toast({
        title: 'Success',
        description: 'Document links updated'
      });

      setLinkDialogOpen(false);
      setSelectedDocument(null);
      setSelectedItemIds([]);
    } catch (error) {
      console.error('Error updating links:', error);
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to update document links',
        variant: 'destructive'
      });
    }
  };

  const getDocumentsByType = (type: DocumentType) => {
    const byType = documents.filter(doc => doc.type === type);
    if (!filterItemIds) return byType;
    return byType.filter(doc =>
      doc.linkedBOMItems?.some(id => filterItemIds.includes(id))
    );
  };

  const formatFileSize = (bytes?: number) => {
    if (!bytes) return '';
    const mb = bytes / (1024 * 1024);
    return mb < 1 ? `${Math.round(bytes / 1024)} KB` : `${mb.toFixed(2)} MB`;
  };

  const formatDate = (date: Date) => {
    return new Date(date).toLocaleDateString('en-IN', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  // Document section component for rendering a single document type section
  const DocumentSection = ({ section, isFullPage }: { section: DocumentTypeSection; isFullPage: boolean }) => {
    const sectionDocs = getDocumentsByType(section.type);

    return (
      <div className={isFullPage ? 'mb-8' : ''}>
        {/* Section Header */}
        <div className={`flex items-center justify-between ${isFullPage ? 'mb-4 pb-3 border-b' : 'border-b pb-3'}`}>
          <div>
            <h3 className={`font-semibold ${isFullPage ? 'text-lg' : 'text-sm'} text-gray-900`}>
              {section.label}
              <Badge variant="outline" className="ml-2">{sectionDocs.length}</Badge>
            </h3>
            <p className={`${isFullPage ? 'text-sm' : 'text-xs'} text-gray-500 mt-1`}>{section.description}</p>
          </div>
          {/* Hide upload button for vendor-po - POs are generated via the app */}
          {section.type !== 'vendor-po' && (
            <label className={documentWritesUnavailable ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}>
              <input
                type="file"
                className="hidden"
                onChange={(e) => handleFileUpload(e, section.type)}
                disabled={documentBusy || documentWritesUnavailable}
                aria-label={`Upload ${section.label}`}
                accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg"
              />
              <Button
                variant="outline"
                size={isFullPage ? 'default' : 'sm'}
                disabled={documentBusy || documentWritesUnavailable}
                asChild
              >
                <span>
                  <Upload className="mr-2 h-4 w-4" />
                  {uploading ? 'Uploading...' : 'Upload'}
                </span>
              </Button>
            </label>
          )}
        </div>

        {/* Document List */}
        <div className={`space-y-${isFullPage ? '3' : '2'}`}>
          {sectionDocs.length === 0 ? (
            <div className={`text-center py-${isFullPage ? '8' : '6'} text-gray-400 ${isFullPage ? 'text-sm' : 'text-xs'} italic bg-gray-50 rounded border border-dashed`}>
              {section.type === 'vendor-po'
                ? 'POs will appear here when sent from the Vendor POs section'
                : `No ${section.label.toLowerCase()} uploaded yet`}
            </div>
          ) : (
            sectionDocs.map(doc => (
              <div
                key={doc.id}
                className={`flex items-center gap-3 p-${isFullPage ? '3' : '2'} bg-gray-50 rounded border border-gray-200 hover:bg-gray-100 transition-colors`}
              >
                <FileText className="text-blue-600 flex-shrink-0" size={isFullPage ? 20 : 18} />

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <a
                      href={doc.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`font-medium text-blue-700 hover:underline truncate ${isFullPage ? '' : 'text-sm'}`}
                      title={doc.name}
                    >
                      {doc.name}
                    </a>
                    {doc.linkedBOMItems && doc.linkedBOMItems.length > 0 && (() => {
                      const resolvedCount = doc.linkedBOMItems.filter(id =>
                        bomItems.some(item => item.id === id)
                      ).length;

                      if (resolvedCount === 0) return null;

                      return (
                        <Badge variant="outline" className="text-xs">
                          <LinkIcon size={10} className="mr-1" />
                          {resolvedCount} item{resolvedCount !== 1 ? 's' : ''}
                        </Badge>
                      );
                    })()}
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    {formatDate(doc.uploadedAt)} • {formatFileSize(doc.fileSize)}
                    {doc.linkedBOMItems && doc.linkedBOMItems.length > 0 && (() => {
                      const resolvedNames = doc.linkedBOMItems
                        .map(id => bomItems.find(item => item.id === id)?.name)
                        .filter(Boolean) as string[];

                      if (resolvedNames.length === 0) {
                        return null;
                      }

                      return (
                        <span className="ml-2 text-gray-400">
                          → {isFullPage
                            ? resolvedNames.join(', ')
                            : <>
                                {resolvedNames.slice(0, 2).join(', ')}
                                {resolvedNames.length > 2 && ` +${resolvedNames.length - 2} more`}
                              </>
                          }
                        </span>
                      );
                    })()}
                  </div>
                </div>

                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleOpenLinkDialog(doc)}
                    disabled={savingLinks || documentBusy || linkWritesUnavailable}
                    title="Link to BOM items"
                  >
                    <LinkIcon size={16} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDelete(doc)}
                    className="text-red-600 hover:text-red-700 hover:bg-red-50"
                    title="Delete document"
                    disabled={documentBusy || documentWritesUnavailable}
                  >
                    <Trash2 size={16} />
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    );
  };

  // Collapsible mode content (uses tabs)
  const tabsDocumentView = (
    <><ProjectDocumentRecovery projectId={projectId} types={sections.map(section=>section.type)} documents={documents} refreshKey={documentBusy} onRefresh={()=>loadDocuments(true)} disabled={documentBusy||savingLinks}/>
    <Tabs value={selectedType} onValueChange={(value) => setSelectedType(value as DocumentType)}>
      <TabsList className="grid w-full" style={{ gridTemplateColumns: `repeat(${sections.length}, minmax(0, 1fr))` }}>
        {sections.map(section => (
          <TabsTrigger key={section.type} value={section.type}>
            {section.label} ({getDocumentsByType(section.type).length})
          </TabsTrigger>
        ))}
      </TabsList>

      {sections.map(section => (
        <TabsContent key={section.type} value={section.type} className="space-y-3">
          <DocumentSection section={section} isFullPage={false} />
        </TabsContent>
      ))}
    </Tabs></>
  );

  // Full page mode - render all sections vertically
  if (fullPage) {
    return (
      <>
        <div className="space-y-6">
          <ProjectDocumentRecovery projectId={projectId} types={sections.map(section=>section.type)} documents={documents} refreshKey={documentBusy} onRefresh={()=>loadDocuments(true)} disabled={documentBusy||savingLinks}/>
          {sections.map(section => (
            <React.Fragment key={section.type}>
              <DocumentSection section={section} isFullPage={true} />
              {renderAfterSection?.sectionType === section.type && renderAfterSection.content}
            </React.Fragment>
          ))}
        </div>

        {/* Link to BOM Items Dialog */}
        <Dialog open={linkDialogOpen} onOpenChange={handleLinkDialogOpenChange}>
          <DialogContent className="max-w-md max-h-[80vh] flex flex-col">
            <DialogHeader>
              <DialogTitle>Link Document to BOM Items</DialogTitle>
            </DialogHeader>

            <div className="flex-1 overflow-y-auto">
              <p className="text-sm text-gray-600 mb-3">
                Select BOM items to link with: <strong>{selectedDocument?.name}</strong>
              </p>

              {/* For PO documents, show 1-to-1 constraint notice */}
              {selectedDocument?.type === 'vendor-po' && (
                <div className="flex items-start gap-2 p-2 mb-3 bg-amber-50 border border-amber-200 rounded text-xs text-amber-800">
                  <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
                  <span>Each item can only be linked to one PO. Items already linked to another PO are disabled.</span>
                </div>
              )}

              <div className="space-y-2">
                {bomItems.length === 0 ? (
                  <p className="text-sm text-gray-400 italic">No BOM items available</p>
                ) : (
                  bomItems.map(item => {
                    // For PO documents: check if item is already linked to ANOTHER PO
                    const isVendorPO = selectedDocument?.type === 'vendor-po';
                    const itemLinkedToOtherPO = isVendorPO && documents.some(
                      doc => doc.type === 'vendor-po' &&
                             doc.id !== selectedDocument?.id &&
                             doc.linkedBOMItems?.includes(item.id)
                    );
                    const isCurrentlyLinked = selectedItemIds.includes(item.id);
                    const isDisabled = itemLinkedToOtherPO && !isCurrentlyLinked;

                    // Find which PO it's linked to (for display)
                    const linkedPOName = itemLinkedToOtherPO
                      ? documents.find(
                          doc => doc.type === 'vendor-po' &&
                                 doc.id !== selectedDocument?.id &&
                                 doc.linkedBOMItems?.includes(item.id)
                        )?.name
                      : null;

                    return (
                      <div
                        key={item.id}
                        className={`flex items-center space-x-2 p-2 rounded ${isDisabled ? 'bg-gray-100 opacity-60' : 'hover:bg-gray-50'}`}
                      >
                        <Checkbox
                          id={item.id}
                          checked={isCurrentlyLinked}
                          disabled={isDisabled || savingLinks || linkWritesUnavailable}
                          onCheckedChange={(checked) => {
                            if (checked) {
                              setSelectedItemIds([...selectedItemIds, item.id]);
                            } else {
                              setSelectedItemIds(selectedItemIds.filter(id => id !== item.id));
                            }
                          }}
                        />
                        <label htmlFor={item.id} className={`flex-1 text-sm ${isDisabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}>
                          <div className="font-medium">{item.name}</div>
                          <div className="text-xs text-gray-500">
                            {item.category} • Qty: {item.quantity}
                            {linkedPOName && (
                              <span className="text-amber-600 ml-2">
                                (linked to: {linkedPOName.length > 20 ? linkedPOName.substring(0, 20) + '...' : linkedPOName})
                              </span>
                            )}
                          </div>
                        </label>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            <DialogFooter className="mt-4">
              <Button variant="outline" disabled={savingLinks} onClick={() => setLinkDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleSaveLinks} disabled={savingLinks || linkWritesUnavailable}>
                {savingLinks ? 'Saving...' : `Save Links (${selectedItemIds.length})`}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </>
    );
  }

  // Collapsible mode (default)
  return (
    <Card className="mb-4">
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer hover:bg-gray-50 transition-colors py-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileText className="text-blue-500" size={20} />
                <CardTitle className="text-lg">Project Documents</CardTitle>
                <Badge variant="outline">{documents.length} files</Badge>
              </div>
              <Button variant="ghost" size="sm">
                {isOpen ? 'Hide' : 'Show'}
              </Button>
            </div>
          </CardHeader>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <CardContent className="pt-0">
            {tabsDocumentView}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>

      {/* Link to BOM Items Dialog */}
      <Dialog open={linkDialogOpen} onOpenChange={handleLinkDialogOpenChange}>
        <DialogContent className="max-w-md max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Link Document to BOM Items</DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto">
            <p className="text-sm text-gray-600 mb-3">
              Select BOM items to link with: <strong>{selectedDocument?.name}</strong>
            </p>

            {/* For PO documents, show 1-to-1 constraint notice */}
            {selectedDocument?.type === 'vendor-po' && (
              <div className="flex items-start gap-2 p-2 mb-3 bg-amber-50 border border-amber-200 rounded text-xs text-amber-800">
                <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
                <span>Each item can only be linked to one PO. Items already linked to another PO are disabled.</span>
              </div>
            )}

            <div className="space-y-2">
              {bomItems.length === 0 ? (
                <p className="text-sm text-gray-400 italic">No BOM items available</p>
              ) : (
                bomItems.map(item => {
                  // For PO documents: check if item is already linked to ANOTHER PO
                  const isVendorPO = selectedDocument?.type === 'vendor-po';
                  const itemLinkedToOtherPO = isVendorPO && documents.some(
                    doc => doc.type === 'vendor-po' &&
                           doc.id !== selectedDocument?.id &&
                           doc.linkedBOMItems?.includes(item.id)
                  );
                  const isCurrentlyLinked = selectedItemIds.includes(item.id);
                  const isDisabled = itemLinkedToOtherPO && !isCurrentlyLinked;

                  // Find which PO it's linked to (for display)
                  const linkedPOName = itemLinkedToOtherPO
                    ? documents.find(
                        doc => doc.type === 'vendor-po' &&
                               doc.id !== selectedDocument?.id &&
                               doc.linkedBOMItems?.includes(item.id)
                      )?.name
                    : null;

                  return (
                    <div
                      key={item.id}
                      className={`flex items-center space-x-2 p-2 rounded ${isDisabled ? 'bg-gray-100 opacity-60' : 'hover:bg-gray-50'}`}
                    >
                      <Checkbox
                        id={item.id}
                        checked={isCurrentlyLinked}
                        disabled={isDisabled || savingLinks || linkWritesUnavailable}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            setSelectedItemIds([...selectedItemIds, item.id]);
                          } else {
                            setSelectedItemIds(selectedItemIds.filter(id => id !== item.id));
                          }
                        }}
                      />
                      <label htmlFor={item.id} className={`flex-1 text-sm ${isDisabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}>
                        <div className="font-medium">{item.name}</div>
                        <div className="text-xs text-gray-500">
                          {item.category} • Qty: {item.quantity}
                          {linkedPOName && (
                            <span className="text-amber-600 ml-2">
                              (linked to: {linkedPOName.length > 20 ? linkedPOName.substring(0, 20) + '...' : linkedPOName})
                            </span>
                          )}
                        </div>
                      </label>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <DialogFooter className="mt-4">
            <Button variant="outline" disabled={savingLinks} onClick={() => setLinkDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveLinks} disabled={savingLinks || linkWritesUnavailable}>
              {savingLinks ? 'Saving...' : `Save Links (${selectedItemIds.length})`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
};

export default ProjectDocuments;
