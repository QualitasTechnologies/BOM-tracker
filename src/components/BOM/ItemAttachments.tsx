import { FileText, ClipboardList, Receipt, Camera } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { BOMItem } from '@/types/bom';
import { ProjectDocument } from '@/types/projectDocument';

interface ItemAttachmentsProps {
  item: BOMItem;
  documents: ProjectDocument[];
  size?: 'sm' | 'md';
  showLabels?: boolean;
  onPhotoClick?: () => void;
}

const ItemAttachments = ({
  item,
  documents,
  size = 'sm',
  showLabels = false,
  onPhotoClick
}: ItemAttachmentsProps) => {
  const iconSize = size === 'sm' ? 14 : 16;
  const iconClass = size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4';

  // Find linked documents
  const quoteDoc = item.linkedQuoteDocumentId
    ? documents.find(d => d.id === item.linkedQuoteDocumentId)
    : undefined;

  const poDoc = item.linkedPODocumentId
    ? documents.find(d => d.id === item.linkedPODocumentId)
    : undefined;

  const invoiceDoc = item.linkedInvoiceDocumentId
    ? documents.find(d => d.id === item.linkedInvoiceDocumentId)
    : undefined;

  const hasPhoto = !!item.receivedPhotoUrl;

  // Check if there are any attachments
  const hasAnyAttachment = quoteDoc || poDoc || invoiceDoc || hasPhoto;

  if (!hasAnyAttachment) {
    return <span className="text-gray-300 text-xs">-</span>;
  }

  const attachments = [
    {
      key: 'quote',
      doc: quoteDoc,
      icon: FileText,
      color: 'text-teal-600 hover:text-teal-700',
      bgColor: 'bg-teal-50',
      label: 'Quote',
      url: quoteDoc?.url,
    },
    {
      key: 'po',
      doc: poDoc,
      icon: ClipboardList,
      color: 'text-blue-600 hover:text-blue-700',
      bgColor: 'bg-blue-50',
      label: 'PO',
      url: poDoc?.url,
    },
    {
      key: 'invoice',
      doc: invoiceDoc,
      icon: Receipt,
      color: 'text-purple-600 hover:text-purple-700',
      bgColor: 'bg-purple-50',
      label: 'Invoice',
      url: invoiceDoc?.url,
    },
    {
      key: 'photo',
      doc: hasPhoto ? { name: 'Receipt Photo' } : undefined,
      icon: Camera,
      color: 'text-green-600 hover:text-green-700',
      bgColor: 'bg-green-50',
      label: 'Photo',
      url: item.receivedPhotoUrl,
      isPhoto: true,
    },
  ].filter(a => a.doc);

  return (
    <TooltipProvider>
      <div className="flex items-center gap-1.5 flex-wrap">
        {attachments.map((attachment) => {
          const Icon = attachment.icon;

          if (showLabels) {
            // Compact badge style with label
            return (
              <a
                key={attachment.key}
                href={attachment.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => {
                  e.stopPropagation();
                  if (attachment.isPhoto && onPhotoClick) {
                    e.preventDefault();
                    onPhotoClick();
                  }
                }}
                className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs ${attachment.bgColor} ${attachment.color} hover:opacity-80 transition-opacity`}
              >
                <Icon className={iconClass} />
                <span>{attachment.label}</span>
              </a>
            );
          }

          // Icon-only style with tooltip
          return (
            <Tooltip key={attachment.key}>
              <TooltipTrigger asChild>
                <a
                  href={attachment.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (attachment.isPhoto && onPhotoClick) {
                      e.preventDefault();
                      onPhotoClick();
                    }
                  }}
                  className={`inline-flex items-center justify-center p-1 rounded ${attachment.bgColor} ${attachment.color} hover:opacity-80 transition-opacity`}
                >
                  <Icon size={iconSize} />
                </a>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">
                <p>{attachment.label}: {attachment.doc?.name || 'View'}</p>
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </TooltipProvider>
  );
};

export default ItemAttachments;
