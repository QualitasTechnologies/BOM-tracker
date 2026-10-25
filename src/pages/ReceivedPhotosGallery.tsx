import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { onAuthStateChanged } from 'firebase/auth';
import { ArrowLeft, Image as ImageIcon, FileText, Calendar, Package, X, ZoomIn } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { auth } from '@/firebase';
import { subscribeToBOM } from '@/utils/projectFirestore';
import { getProjectDocuments, getReceivedPhotoInvoice } from '@/utils/projectDocumentFirestore';
import { isScopedProjectReadEnabled } from '@/utils/projectReadMode';
import { BOMItem, BOMCategory } from '@/types/bom';
import { ProjectDocument } from '@/types/projectDocument';

// Helper to format dates
const formatDate = (dateStr: string | undefined): string => {
  if (!dateStr) return '-';
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};

const MAX_CONCURRENT_INVOICE_LOOKUPS = 4;
// Failures carrying one of these codes have curated, user-safe messages; anything else gets the generic text.
const CURATED_ERROR_CODES = new Set(['access', 'not_found', 'paused', 'integrity', 'identity_changed', 'request_failed', 'sign_in_required', 'invalid_request']);
const GENERIC_ERROR = 'The received items could not be loaded. Try again.';
const ACCOUNT_CHANGED = 'Your signed-in account changed. Try again to reload the received items.';
const SIGN_IN_REQUIRED = 'Sign in again to view the received items.';
const describeError = (error: unknown): string => {
  const code = (error as { code?: unknown } | null)?.code;
  const message = (error as { message?: unknown } | null)?.message;
  return typeof code === 'string' && CURATED_ERROR_CODES.has(code) && typeof message === 'string' && message ? message : GENERIC_ERROR;
};

type BOMSubscriber = (projectId: string, callback: (categories: BOMCategory[]) => void, onError?: (error: Error) => void) => () => void;

// Received physical items with a photo, from whichever categories the signed-in user can see.
const receivedPhotoItems = (categories: BOMCategory[]): BOMItem[] => categories
  .flatMap(cat => cat.items)
  .filter(item =>
    item.itemType !== 'service' &&
    item.status === 'received' &&
    item.receivedPhotoUrl
  );

const ReceivedPhotosGallery = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const scoped = isScopedProjectReadEnabled();
  const uid = scoped ? auth.currentUser?.uid ?? '' : '';
  const contextKey = JSON.stringify([projectId ?? '', scoped ? uid : 'legacy']);
  const [categories, setCategories] = useState<BOMCategory[]>([]);
  const [documents, setDocuments] = useState<ProjectDocument[]>([]);
  // Scoped reads: invoices found through each visible item's own invoice link, keyed by that link.
  const [invoices, setInvoices] = useState<ReadonlyMap<string, ProjectDocument>>(new Map());
  const [selectedImage, setSelectedImage] = useState<{ url: string; item: BOMItem } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [stateContext, setStateContext] = useState(contextKey);
  // Gate the render itself: passive effect cleanup happens after React commits a route/account change.
  const contextMatches = stateContext === contextKey;
  const visibleCategories = contextMatches ? categories : [];
  const visibleDocuments = contextMatches ? documents : [];
  const visibleInvoices = contextMatches ? invoices : new Map<string, ProjectDocument>();
  const visibleSelectedImage = contextMatches ? selectedImage : null;
  const visibleError = contextMatches ? error : null;
  const visibleLoading = !contextMatches || loading;

  // Get all received items with photos
  const receivedItemsWithPhotos = receivedPhotoItems(visibleCategories);

  // Get invoice document for an item
  const getInvoiceDocument = (item: BOMItem): ProjectDocument | undefined => {
    if (!item.linkedInvoiceDocumentId) return undefined;
    return visibleInvoices.get(item.linkedInvoiceDocumentId) ?? visibleDocuments.find(d => d.id === item.linkedInvoiceDocumentId);
  };

  useEffect(() => {
    if (!projectId) return;

    // The account is captured once; every callback and await below is tied to it and to this run.
    let active = true;
    let emission = 0;
    const authCurrent = () => !scoped || (!!uid && auth.currentUser?.uid === uid);

    const clear = () => {
      setCategories([]);
      setDocuments([]);
      setInvoices(new Map());
      setSelectedImage(null);
    };
    const fail = (message: string) => {
      clear();
      setError(message);
      setLoading(false);
    };
    // The signed-in account changed: nothing from this run may be shown or revived.
    const lose = () => {
      if (!active) return;
      active = false;
      emission++;
      setStateContext(JSON.stringify([projectId ?? '', scoped ? auth.currentUser?.uid ?? '' : 'legacy']));
      fail(ACCOUNT_CHANGED);
    };
    const live = (sequence: number) => {
      if (!active) return false;
      if (!authCurrent()) { lose(); return false; }
      return sequence === emission;
    };

    clear();
    setStateContext(contextKey);
    setError(null);
    setLoading(true);

    if (scoped && !uid) {
      active = false;
      fail(SIGN_IN_REQUIRED);
      return;
    }

    const loadInvoices = async (list: BOMCategory[], sequence: number) => {
      // One lookup per distinct invoice; the server authorizes it through the visible item.
      const requests = new Map<string, string>();
      for (const item of receivedPhotoItems(list)) {
        if (item.linkedInvoiceDocumentId && !requests.has(item.linkedInvoiceDocumentId)) requests.set(item.linkedInvoiceDocumentId, item.id);
      }
      const queue = [...requests];
      const found = new Map<string, ProjectDocument>();
      let aborted = false;
      const worker = async () => {
        for (let next = queue.shift(); next; next = queue.shift()) {
          if (aborted || !live(sequence)) return;
          const invoice = await getReceivedPhotoInvoice(projectId, next[1], { isCurrent: () => live(sequence) });
          if (invoice) found.set(next[0], invoice);
        }
      };
      try {
        await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENT_INVOICE_LOOKUPS, queue.length) }, worker));
        if (!live(sequence)) return;
        setInvoices(found);
      } catch (lookupError) {
        aborted = true;
        if (!live(sequence)) return;
        fail(describeError(lookupError));
      }
    };

    // The listener may accept an error callback; without one a failed listener would spin forever.
    const subscribe: BOMSubscriber = subscribeToBOM;
    const unsubscribeBOM = subscribe(projectId, (updatedCategories) => {
      if (!active) return;
      if (!authCurrent()) { lose(); return; }
      const sequence = ++emission;
      const next = updatedCategories ?? [];
      setCategories(next);
      if (scoped) setInvoices(new Map());
      setError(null);
      setLoading(false);
      if (scoped) void loadInvoices(next, sequence);
    }, (subscriptionError) => {
      if (!active) return;
      if (!authCurrent()) { lose(); return; }
      emission++;
      fail(describeError(subscriptionError));
    });

    const unsubscribeAuth = scoped
      ? onAuthStateChanged(auth, user => {
        if (active && (user?.uid ?? '') !== uid) lose();
      })
      : undefined;

    // Load project documents
    if (!scoped) {
      getProjectDocuments(projectId).then(docs => { if (active) setDocuments(docs); }).catch(console.error);
    }

    return () => {
      active = false;
      emission++;
      unsubscribeBOM();
      unsubscribeAuth?.();
    };
  }, [projectId, attempt]);

  // Keep the full-size image in step with what is currently visible.
  useEffect(() => {
    setSelectedImage(current => {
      if (!current) return current;
      const visible = receivedPhotoItems(visibleCategories).find(item => item.id === current.item.id && item.receivedPhotoUrl === current.url);
      if (!visible) return null;
      return visible === current.item ? current : { url: current.url, item: visible };
    });
  }, [visibleCategories]);

  if (visibleLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mx-auto"></div>
          <p className="mt-2 text-sm text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link
              to={`/project/${projectId}/bom`}
              className="text-gray-600 hover:text-gray-900"
            >
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Received Items Gallery</h1>
              <p className="text-sm text-gray-500 mt-1">
                {receivedItemsWithPhotos.length} item{receivedItemsWithPhotos.length !== 1 ? 's' : ''} with photos
              </p>
            </div>
          </div>
        </div>

        {/* Gallery Grid */}
        {visibleError ? (
          <Card>
            <CardContent className="p-12 text-center" role="alert">
              <p className="text-lg font-medium text-gray-900 mb-2">Received items could not be shown</p>
              <p className="text-sm text-gray-500 mb-4">{visibleError}</p>
              <Button onClick={() => setAttempt(count => count + 1)}>Try again</Button>
            </CardContent>
          </Card>
        ) : receivedItemsWithPhotos.length === 0 ? (
          <Card>
            <CardContent className="p-12 text-center">
              <ImageIcon className="h-12 w-12 text-gray-300 mx-auto mb-4" />
              <p className="text-lg font-medium text-gray-900 mb-2">No photos available</p>
              <p className="text-sm text-gray-500">
                Photos will appear here once items are marked as received with photos.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {receivedItemsWithPhotos.map((item) => {
              const invoiceDoc = getInvoiceDocument(item);

              return (
                <Card key={item.id} className="overflow-hidden hover:shadow-lg transition-shadow">
                  <div className="relative aspect-square bg-gray-100 cursor-pointer group">
                    <img
                      src={item.receivedPhotoUrl}
                      alt={item.name}
                      className="w-full h-full object-cover"
                      onClick={() => setSelectedImage({ url: item.receivedPhotoUrl!, item })}
                    />
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center">
                      <ZoomIn className="h-8 w-8 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                  </div>
                  <CardContent className="p-4">
                    <div className="space-y-2">
                      <div>
                        <h3 className="font-medium text-gray-900 truncate" title={item.name}>
                          {item.name}
                        </h3>
                        {item.make && (
                          <p className="text-xs text-gray-500 mt-0.5">Make: {item.make}</p>
                        )}
                      </div>

                      <div className="flex items-center gap-2 text-xs text-gray-500">
                        <Calendar className="h-3 w-3" />
                        <span>Received: {formatDate(item.actualArrival)}</span>
                      </div>

                      {invoiceDoc && (
                        <a
                          href={invoiceDoc.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-2 text-xs text-blue-600 hover:text-blue-700 hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <FileText className="h-3 w-3" />
                          <span className="truncate" title={invoiceDoc.name}>
                            {invoiceDoc.name}
                          </span>
                        </a>
                      )}

                      {item.poNumber && (
                        <div className="flex items-center gap-2 text-xs text-gray-500">
                          <Package className="h-3 w-3" />
                          <span>PO: {item.poNumber}</span>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {/* Full-size Image Modal */}
        <Dialog open={!!visibleSelectedImage} onOpenChange={() => setSelectedImage(null)}>
          <DialogContent className="max-w-4xl p-0">
            {visibleSelectedImage && (
              <div className="relative">
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute top-2 right-2 z-10 bg-white/90 hover:bg-white"
                  onClick={() => setSelectedImage(null)}
                >
                  <X className="h-4 w-4" />
                </Button>
                <img
                  src={visibleSelectedImage.url}
                  alt={visibleSelectedImage.item.name}
                  className="w-full h-auto max-h-[80vh] object-contain"
                />
                <div className="p-4 bg-white border-t">
                  <h3 className="font-medium text-gray-900">{visibleSelectedImage.item.name}</h3>
                  <p className="text-sm text-gray-500 mt-1">
                    Received: {formatDate(visibleSelectedImage.item.actualArrival)}
                  </p>
                  {getInvoiceDocument(visibleSelectedImage.item) && (
                    <a
                      href={getInvoiceDocument(visibleSelectedImage.item)!.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 text-sm text-blue-600 hover:text-blue-700 hover:underline mt-2"
                    >
                      <FileText className="h-4 w-4" />
                      View Invoice
                    </a>
                  )}
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
};

export default ReceivedPhotosGallery;
