import { useState, useEffect, useMemo } from 'react';
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
import {
  uploadProjectDocument,
  getProjectDocuments,
  deleteProjectDocument,
  linkDocumentToBOMItems
} from '@/utils/projectDocumentFirestore';
import { validateDocumentDeletion } from '@/utils/bomDocumentLinking';
import { ProjectDocument, DocumentType, DOCUMENT_SECTIONS } from '@/types/projectDocument';
import { BOMItem } from '@/types/bom';

interface ProjectDocumentsProps {
  projectId: string;
  bomItems: BOMItem[]; // All BOM items for linking
  onDocumentsChange?: () => void;
  onBOMItemUpdate?: (itemId: string, updates: Partial<BOMItem>) => Promise<void>; // Callback to update BOM items
  fullPage?: boolean; // When true, renders without collapsible wrapper for tab view
}

const ProjectDocuments = ({ projectId, bomItems, onDocumentsChange, onBOMItemUpdate, fullPage = false }: ProjectDocumentsProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [documents, setDocuments] = useState<ProjectDocument[]>([]);
  const [uploading, setUploading] = useState(false);
  const [selectedType, setSelectedType] = useState<DocumentType>('vendor-quote');
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [selectedDocument, setSelectedDocument] = useState<ProjectDocument | null>(null);
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const { toast } = useToast();

  // Load documents
  useEffect(() => {
    if (projectId) {
      loadDocuments();
    }
  }, [projectId]);

  const loadDocuments = async () => {
    try {
      const docs = await getProjectDocuments(projectId);
      setDocuments(docs);
      onDocumentsChange?.(); // Notify parent of document changes
    } catch (error) {
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

    const file = e.target.files[0];
    setUploading(true);

    try {
      const user = auth.currentUser;
      if (!user) throw new Error('User not authenticated');

      await uploadProjectDocument(file, projectId, type, user.uid);
      await loadDocuments();

      toast({
        title: 'Success',
        description: 'Document uploaded successfully'
      });
    } catch (error) {
      console.error('Error uploading document:', error);
      toast({
        title: 'Upload Failed',
        description: error instanceof Error ? error.message : 'Failed to upload document',
        variant: 'destructive'
      });
    } finally {
      setUploading(false);
      e.target.value = ''; // Reset input
    }
  };

  const handleDelete = async (doc: ProjectDocument) => {
    // Validate deletion based on document type and linked BOM items
    const validation = validateDocumentDeletion(doc, bomItems);

    if (!validation.canDelete) {
      const title = doc.type === 'outgoing-po' ? 'Cannot Delete PO' : 'Cannot Delete Invoice';
      toast({
        title,
        description: validation.reason,
        variant: 'destructive'
      });
      return;
    }

    if (!window.confirm(`Delete "${doc.name}"?`)) return;

    try {
      await deleteProjectDocument(doc.id, doc.url);
      await loadDocuments();

      toast({
        title: 'Success',
        description: 'Document deleted successfully'
      });
    } catch (error) {
      console.error('Error deleting document:', error);
      toast({
        title: 'Delete Failed',
        description: 'Failed to delete document',
        variant: 'destructive'
      });
    }
  };

  const handleOpenLinkDialog = (doc: ProjectDocument) => {
    setSelectedDocument(doc);
    setSelectedItemIds(doc.linkedBOMItems || []);
    setLinkDialogOpen(true);
  };

  const handleSaveLinks = async () => {
    if (!selectedDocument) return;

    try {
      await linkDocumentToBOMItems(selectedDocument.id, selectedItemIds);
      
      // For outgoing-po documents, also update BOM items' linkedPODocumentId field
      if (selectedDocument.type === 'outgoing-po' && onBOMItemUpdate) {
        // Get previous linked items to know which ones to unlink
        const previousLinkedIds = selectedDocument.linkedBOMItems || [];
        
        // Update items that are now linked: set their linkedPODocumentId
        for (const itemId of selectedItemIds) {
          await onBOMItemUpdate(itemId, { linkedPODocumentId: selectedDocument.id });
        }
        
        // Update items that are no longer linked: clear their linkedPODocumentId
        const unlinkedIds = previousLinkedIds.filter(id => !selectedItemIds.includes(id));
        for (const itemId of unlinkedIds) {
          await onBOMItemUpdate(itemId, { linkedPODocumentId: undefined });
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
        description: 'Failed to update document links',
        variant: 'destructive'
      });
    }
  };

  const getDocumentsByType = (type: DocumentType) => {
    return documents.filter(doc => doc.type === type);
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
  const DocumentSection = ({ section, isFullPage }: { section: typeof DOCUMENT_SECTIONS[0]; isFullPage: boolean }) => {
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
          <label className="cursor-pointer">
            <input
              type="file"
              className="hidden"
              onChange={(e) => handleFileUpload(e, section.type)}
              disabled={uploading}
              accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg"
            />
            <Button
              variant="outline"
              size={isFullPage ? 'default' : 'sm'}
              disabled={uploading}
              asChild
            >
              <span>
                <Upload className="mr-2 h-4 w-4" />
                {uploading ? 'Uploading...' : 'Upload'}
              </span>
            </Button>
          </label>
        </div>

        {/* Document List */}
        <div className={`space-y-${isFullPage ? '3' : '2'}`}>
          {sectionDocs.length === 0 ? (
            <div className={`text-center py-${isFullPage ? '8' : '6'} text-gray-400 ${isFullPage ? 'text-sm' : 'text-xs'} italic bg-gray-50 rounded border border-dashed`}>
              No {section.label.toLowerCase()} uploaded yet
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
                    {doc.linkedBOMItems && doc.linkedBOMItems.length > 0 && (
                      <Badge variant="outline" className="text-xs">
                        <LinkIcon size={10} className="mr-1" />
                        {doc.linkedBOMItems.length} items
                      </Badge>
                    )}
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    {formatDate(doc.uploadedAt)} • {formatFileSize(doc.fileSize)}
                    {doc.linkedBOMItems && doc.linkedBOMItems.length > 0 && (
                      <span className="ml-2 text-gray-400">
                        → {isFullPage
                          ? doc.linkedBOMItems
                              .map(id => bomItems.find(item => item.id === id)?.name)
                              .filter(Boolean)
                              .join(', ')
                          : <>
                              {doc.linkedBOMItems
                                .map(id => bomItems.find(item => item.id === id)?.name)
                                .filter(Boolean)
                                .slice(0, 2)
                                .join(', ')}
                              {doc.linkedBOMItems.length > 2 && ` +${doc.linkedBOMItems.length - 2} more`}
                            </>
                        }
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleOpenLinkDialog(doc)}
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
  const TabsDocumentView = () => (
    <Tabs value={selectedType} onValueChange={(value) => setSelectedType(value as DocumentType)}>
      <TabsList className="grid w-full grid-cols-3">
        {DOCUMENT_SECTIONS.map(section => (
          <TabsTrigger key={section.type} value={section.type}>
            {section.label} ({getDocumentsByType(section.type).length})
          </TabsTrigger>
        ))}
      </TabsList>

      {DOCUMENT_SECTIONS.map(section => (
        <TabsContent key={section.type} value={section.type} className="space-y-3">
          <DocumentSection section={section} isFullPage={false} />
        </TabsContent>
      ))}
    </Tabs>
  );

  // Full page mode - render all sections vertically
  if (fullPage) {
    return (
      <>
        <div className="space-y-6">
          {DOCUMENT_SECTIONS.map(section => (
            <DocumentSection key={section.type} section={section} isFullPage={true} />
          ))}
        </div>

        {/* Link to BOM Items Dialog */}
        <Dialog open={linkDialogOpen} onOpenChange={setLinkDialogOpen}>
          <DialogContent className="max-w-md max-h-[80vh] flex flex-col">
            <DialogHeader>
              <DialogTitle>Link Document to BOM Items</DialogTitle>
            </DialogHeader>

            <div className="flex-1 overflow-y-auto">
              <p className="text-sm text-gray-600 mb-3">
                Select BOM items to link with: <strong>{selectedDocument?.name}</strong>
              </p>

              {/* For PO documents, show 1-to-1 constraint notice */}
              {selectedDocument?.type === 'outgoing-po' && (
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
                    const isOutgoingPO = selectedDocument?.type === 'outgoing-po';
                    const itemLinkedToOtherPO = isOutgoingPO && documents.some(
                      doc => doc.type === 'outgoing-po' &&
                             doc.id !== selectedDocument?.id &&
                             doc.linkedBOMItems?.includes(item.id)
                    );
                    const isCurrentlyLinked = selectedItemIds.includes(item.id);
                    const isDisabled = itemLinkedToOtherPO && !isCurrentlyLinked;

                    // Find which PO it's linked to (for display)
                    const linkedPOName = itemLinkedToOtherPO
                      ? documents.find(
                          doc => doc.type === 'outgoing-po' &&
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
                          disabled={isDisabled}
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
              <Button variant="outline" onClick={() => setLinkDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleSaveLinks}>
                Save Links ({selectedItemIds.length})
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
            <TabsDocumentView />
          </CardContent>
        </CollapsibleContent>
      </Collapsible>

      {/* Link to BOM Items Dialog */}
      <Dialog open={linkDialogOpen} onOpenChange={setLinkDialogOpen}>
        <DialogContent className="max-w-md max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Link Document to BOM Items</DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto">
            <p className="text-sm text-gray-600 mb-3">
              Select BOM items to link with: <strong>{selectedDocument?.name}</strong>
            </p>

            {/* For PO documents, show 1-to-1 constraint notice */}
            {selectedDocument?.type === 'outgoing-po' && (
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
                  const isOutgoingPO = selectedDocument?.type === 'outgoing-po';
                  const itemLinkedToOtherPO = isOutgoingPO && documents.some(
                    doc => doc.type === 'outgoing-po' &&
                           doc.id !== selectedDocument?.id &&
                           doc.linkedBOMItems?.includes(item.id)
                  );
                  const isCurrentlyLinked = selectedItemIds.includes(item.id);
                  const isDisabled = itemLinkedToOtherPO && !isCurrentlyLinked;

                  // Find which PO it's linked to (for display)
                  const linkedPOName = itemLinkedToOtherPO
                    ? documents.find(
                        doc => doc.type === 'outgoing-po' &&
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
                        disabled={isDisabled}
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
            <Button variant="outline" onClick={() => setLinkDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveLinks}>
              Save Links ({selectedItemIds.length})
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
};

export default ProjectDocuments;
