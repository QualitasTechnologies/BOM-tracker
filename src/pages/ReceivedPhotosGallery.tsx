import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, Image as ImageIcon, FileText, Calendar, Package, X, ZoomIn } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { subscribeToBOM } from '@/utils/projectFirestore';
import { getProjectDocuments } from '@/utils/projectDocumentFirestore';
import { BOMItem, BOMCategory } from '@/types/bom';
import { ProjectDocument } from '@/types/projectDocument';

// Helper to format dates
const formatDate = (dateStr: string | undefined): string => {
  if (!dateStr) return '-';
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};

const ReceivedPhotosGallery = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const [categories, setCategories] = useState<BOMCategory[]>([]);
  const [documents, setDocuments] = useState<ProjectDocument[]>([]);
  const [selectedImage, setSelectedImage] = useState<{ url: string; item: BOMItem } | null>(null);
  const [loading, setLoading] = useState(true);

  // Get all received items with photos
  const receivedItemsWithPhotos = categories
    .flatMap(cat => cat.items)
    .filter(item => 
      item.itemType !== 'service' && 
      item.status === 'received' && 
      item.receivedPhotoUrl
    );

  // Get invoice document for an item
  const getInvoiceDocument = (item: BOMItem): ProjectDocument | undefined => {
    if (!item.linkedInvoiceDocumentId) return undefined;
    return documents.find(d => d.id === item.linkedInvoiceDocumentId);
  };

  useEffect(() => {
    if (!projectId) return;

    setLoading(true);

    // Subscribe to BOM data
    const unsubscribeBOM = subscribeToBOM(projectId, (bomData) => {
      if (bomData) {
        setCategories(bomData.categories || []);
      }
      setLoading(false);
    });

    // Load project documents
    getProjectDocuments(projectId).then(setDocuments).catch(console.error);

    return () => {
      unsubscribeBOM();
    };
  }, [projectId]);

  if (loading) {
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
        {receivedItemsWithPhotos.length === 0 ? (
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
        <Dialog open={!!selectedImage} onOpenChange={() => setSelectedImage(null)}>
          <DialogContent className="max-w-4xl p-0">
            {selectedImage && (
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
                  src={selectedImage.url}
                  alt={selectedImage.item.name}
                  className="w-full h-auto max-h-[80vh] object-contain"
                />
                <div className="p-4 bg-white border-t">
                  <h3 className="font-medium text-gray-900">{selectedImage.item.name}</h3>
                  <p className="text-sm text-gray-500 mt-1">
                    Received: {formatDate(selectedImage.item.actualArrival)}
                  </p>
                  {getInvoiceDocument(selectedImage.item) && (
                    <a
                      href={getInvoiceDocument(selectedImage.item)!.url}
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

