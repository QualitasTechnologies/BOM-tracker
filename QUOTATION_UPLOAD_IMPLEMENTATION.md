# Quotation Upload Implementation - Phase 1 Complete

## ✅ Implemented Components

### 1. Type Definitions (`src/types/quotation.ts`)
- `QuotationDocument` interface with all required fields
- `QuotationStatus` type for tracking processing stages
- `QuotationData` interface (placeholder for Phase 2)
- Firestore converter for type-safe operations

### 2. Firestore Utilities (`src/utils/quotationFirestore.ts`)
- `uploadQuotation()` - Uploads PDF to Storage + creates Firestore doc
- `getQuotationsForItem()` - Retrieves all quotations for a BOM item
- `updateQuotationStatus()` - Updates processing status
- `updateQuotationText()` - Saves extracted text after parsing
- `deleteQuotation()` - Removes quotation from Storage + Firestore

### 3. Firebase Function (`functions/index.js`)
- `extractQuotationText` - Cloud Function to extract text from uploaded PDFs
- Uses `pdf-parse` library
- Downloads PDF from Storage, extracts text, updates Firestore
- Error handling and status updates

### 4. Firebase Storage Rules (`storage.rules`)
- Authenticated users can upload PDFs to `/quotations/{projectId}/{bomItemId}/`
- PDF-only validation (application/pdf)
- 10MB file size limit
- Proper read/write/delete permissions

### 5. Dependencies Added (`functions/package.json`)
- `pdf-parse` - PDF text extraction
- `busboy` - File upload handling

## 📝 Next Steps to Complete Phase 1

### Add to `BOMPartDetails.tsx`:

```typescript
// Add after existing state declarations (around line 100)
const [quotations, setQuotations] = useState<QuotationDocument[]>([]);
const [uploadingQuotation, setUploadingQuotation] = useState(false);
const { toast } = useToast();

// Load quotations for this item
useEffect(() => {
  if (part?.id) {
    getQuotationsForItem(part.id).then(setQuotations);
  }
}, [part?.id]);

// Handle quotation PDF upload
const handleQuotationUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
  if (!e.target.files || !e.target.files[0] || !partState) return;

  const file = e.target.files[0];

  // Validate file type
  if (file.type !== 'application/pdf') {
    toast({
      title: 'Invalid File Type',
      description: 'Please upload a PDF file',
      variant: 'destructive',
    });
    return;
  }

  // Validate file size (10MB max)
  if (file.size > 10 * 1024 * 1024) {
    toast({
      title: 'File Too Large',
      description: 'Maximum file size is 10MB',
      variant: 'destructive',
    });
    return;
  }

  setUploadingQuotation(true);

  try {
    const user = auth.currentUser;
    if (!user) throw new Error('User not authenticated');

    // Upload quotation
    const quotation = await uploadQuotation(
      file,
      partState.projectId || '',
      partState.id,
      user.uid
    );

    toast({
      title: 'Quotation Uploaded',
      description: 'Extracting text from PDF...',
    });

    // Call Firebase Function to extract text
    const extractQuotationText = httpsCallable(functions, 'extractQuotationText');
    await extractQuotationText({
      quotationId: quotation.id,
      fileUrl: quotation.fileUrl,
    });

    // Reload quotations
    const updated = await getQuotationsForItem(partState.id);
    setQuotations(updated);

    toast({
      title: 'Success!',
      description: 'Quotation uploaded and text extracted',
    });
  } catch (error) {
    console.error('Error uploading quotation:', error);
    toast({
      title: 'Upload Failed',
      description: error instanceof Error ? error.message : 'Failed to upload quotation',
      variant: 'destructive',
    });
  } finally {
    setUploadingQuotation(false);
    e.target.value = ''; // Reset file input
  }
};
```

### Update Documents Section UI:

Replace the existing Documents section (around line 430) with:

```tsx
{/* Documents & Quotations Section */}
<div className="relative mb-3">
  <Collapsible>
    <CollapsibleTrigger asChild>
      <div className="flex w-full items-center justify-between font-medium text-gray-900 px-0 py-2 bg-transparent border-none cursor-pointer">
        <span>Documents & Quotations</span>
        <div className="flex items-center gap-2">
          {/* Upload Quotation */}
          <label className="cursor-pointer">
            <input
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={handleQuotationUpload}
              disabled={uploadingQuotation}
            />
            <span className={`px-3 py-1 ${uploadingQuotation ? 'bg-gray-400' : 'bg-green-600 hover:bg-green-700'} text-white rounded text-sm font-medium`} title="Upload quotation PDF">
              {uploadingQuotation ? 'Uploading...' : 'Upload Quotation'}
            </span>
          </label>

          {/* Add regular file */}
          <label className="cursor-pointer">
            <input type="file" multiple className="hidden" onChange={handleUploadDocs} />
            <span className="px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm font-medium" title="Add file">
              Add File
            </span>
          </label>

          <button
            className={`p-1 rounded-full ${docDeleteMode ? 'bg-red-100 text-red-600' : ''}`}
            style={{ minWidth: 32, minHeight: 32, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            title={docDeleteMode ? 'Cancel' : 'Delete'}
            onClick={e => {
              e.stopPropagation();
              setDocDeleteMode(mode => !mode);
              setSelectedDocs([]);
            }}
          >
            <Trash2 size={18} />
          </button>

          <span className="transition-transform duration-200">
            <svg width="20" height="20" fill="none" viewBox="0 0 24 24">
              <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </span>
        </div>
      </div>
    </CollapsibleTrigger>
    <CollapsibleContent>
      <div className="space-y-2">
        {/* Quotations Section */}
        {quotations.length > 0 && (
          <div className="mb-3">
            <h5 className="text-xs font-semibold text-gray-700 mb-2">Quotations ({quotations.length})</h5>
            {quotations.map(quote => (
              <div key={quote.id} className="flex items-center gap-2 bg-green-50 rounded px-2 py-1 border border-green-200">
                <FileText size={16} className="text-green-600 mr-1" />
                <a
                  href={quote.fileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 text-left text-green-700 text-sm truncate hover:underline font-medium"
                  title={quote.fileName}
                >
                  {quote.fileName}
                </a>
                <Badge variant="outline" className="text-xs">
                  {quote.status === 'text_extracted' ? '✓ Extracted' : quote.status}
                </Badge>
              </div>
            ))}
          </div>
        )}

        {/* Regular Documents */}
        {documents.length === 0 && quotations.length === 0 && (
          <div className="text-gray-400 text-sm italic flex items-center gap-2 p-2">
            <FileText size={16} />No documents uploaded yet.
          </div>
        )}
        {documents.map(doc => (
          <div key={doc.url} className="flex items-center gap-2 bg-gray-50 rounded px-2 py-1 border border-gray-200">
            {docDeleteMode && (
              <input
                type="checkbox"
                checked={selectedDocs.includes(doc.name)}
                onChange={e => setSelectedDocs(prev =>
                  e.target.checked
                    ? [...prev, doc.name]
                    : prev.filter(d => d !== doc.name)
                )}
              />
            )}
            <FileText size={16} className="text-blue-600 mr-1" />
            <a
              href={doc.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 text-left text-blue-700 text-sm truncate hover:underline"
              title={doc.name}
            >
              {doc.name}
            </a>
          </div>
        ))}
        {docDeleteMode && (
          <Button
            variant="destructive"
            size="sm"
            className="mt-2"
            disabled={selectedDocs.length === 0}
            onClick={() => {
              setDocuments(documents.filter(doc => !selectedDocs.includes(doc.name)));
              setSelectedDocs([]);
              setDocDeleteMode(false);
            }}
          >
            Delete Selected
          </Button>
        )}
      </div>
    </CollapsibleContent>
  </Collapsible>
</div>
```

## 🚀 Deployment Instructions

1. **Deploy Firebase Functions:**
   ```bash
   cd functions
   npm install
   cd ..
   firebase deploy --only functions
   ```

2. **Deploy Storage Rules:**
   ```bash
   firebase deploy --only storage
   ```

3. **Test the Upload:**
   - Navigate to a BOM item details
   - Click "Upload Quotation"
   - Select a PDF file
   - Verify it appears under "Quotations" section with "✓ Extracted" badge

## 📊 Data Flow

```
User selects PDF → uploadQuotation() → Firebase Storage
                         ↓
                    Creates Firestore doc
                         ↓
                    Calls extractQuotationText()
                         ↓
                    Downloads PDF from Storage
                         ↓
                    Extracts text with pdf-parse
                         ↓
                    Updates Firestore with text
                         ↓
                    Status: "text_extracted"
```

## 🔜 Phase 2 Preview

Once Phase 1 is tested and working, Phase 2 will:
- Send extracted text to OpenAI GPT-4
- Parse structured quotation data
- Display parsed vendor info, line items, pricing
- Show preview dialog before saving

## 🔜 Phase 3 Preview

Phase 3 will:
- Match vendor names using fuzzy matching
- Auto-populate vendor comparison fields
- Handle multi-item quotations
- Link quotations to vendor entries

