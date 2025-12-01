# BOM Tracker

A comprehensive Bill of Materials (BOM) management system built for engineering and procurement teams. Track components, services, vendors, costs, and project timelines in one unified platform.

## Table of Contents

- [Overview](#overview)
- [Quick Start](#quick-start)
- [Features](#features)
  - [BOM Management](#bom-management)
  - [Project Management](#project-management)
  - [Vendor Management](#vendor-management)
  - [Document Management](#document-management)
  - [Analytics & Dashboards](#analytics--dashboards)
- [Architecture](#architecture)
- [Configuration](#configuration)
- [Firebase Functions](#firebase-functions)
- [Development](#development)
- [Deployment](#deployment)
- [Troubleshooting](#troubleshooting)

---

## Overview

BOM Tracker helps engineering teams manage Bills of Materials across multiple projects. Key capabilities:

- **Component & Service Tracking** - Track physical parts and service items with costs
- **AI-Powered Import** - Extract BOM data from PDFs, DOCX, and text using GPT-4o-mini
- **Vendor Database** - Manage suppliers with lead times, payment terms, and categories
- **Inward Tracking** - Monitor ordered items, expected arrivals, and receipts
- **Purchase Requests** - Generate and email PRs to supply chain teams
- **Cost Analysis** - Track project budgets, costs, and profit/loss

### Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 18, TypeScript, Vite |
| UI | shadcn/ui, Tailwind CSS, Radix UI |
| Backend | Firebase (Auth, Firestore, Storage, Functions) |
| AI | OpenAI GPT-4o-mini |
| Email | SendGrid |

---

## Quick Start

### Prerequisites

- Node.js 18+
- Firebase project with Firestore, Auth, and Storage enabled
- OpenAI API key (for AI import feature)
- SendGrid API key (for purchase request emails)

### Installation

```bash
# Clone and install
git clone <repository-url>
cd BOM-tracker
npm install

# Install Firebase Functions dependencies
cd functions && npm install && cd ..
```

### Environment Setup

Create `.env` in the project root:

```env
# Firebase Configuration
VITE_FIREBASE_API_KEY=your_api_key
VITE_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your_project_id
VITE_FIREBASE_STORAGE_BUCKET=your_project.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
VITE_FIREBASE_APP_ID=your_app_id
```

### Firebase Secrets

Set secrets for Firebase Functions:

```bash
firebase functions:secrets:set OPENAI_API_KEY
firebase functions:secrets:set SENDGRID_API_KEY
```

### Run Development Server

```bash
npm run dev
# Opens at http://localhost:8080
```

---

## Features

### BOM Management

**Core Functionality**
- Add, edit, delete BOM items organized by category
- Inline editing for all fields (name, quantity, price, vendor, etc.)
- Real-time total cost calculation (quantity x unit price)

**Item Types**
- **Components**: Physical parts with make, SKU, vendor, quantity, unit price
- **Services**: Labor/consulting tracked by duration (days) and rate (per day)

**AI-Powered Import**
- Upload PDF, DOCX, or TXT files
- GPT-4o-mini extracts items, quantities, and suggests categories
- Fallback keyword-based parsing if AI unavailable
- Category mapping to existing BOM categories

**CSV Import/Export**
- Export BOM with all fields including pricing
- Import from CSV with duplicate detection
- Supports item type column (Component/Service)

**Status Tracking**
- Item statuses: Not Started, In Progress, Ordered, Received
- Visual status badges on each item

### Inward Tracking

Track ordered items through delivery:

**Order Capture** (when status changes to "Ordered")
- Order date (defaults to today)
- PO number and linked PO document
- Vendor selection with lead time display
- Auto-calculated expected arrival date

**Arrival Indicators**
- Red: Overdue (past expected arrival)
- Yellow: Arriving soon (within 7 days)
- Gray: On track (> 7 days away)
- Green: Received (with actual date)

**Inward Dashboard**
- Summary cards: Ordered, Arriving Soon, Overdue, Received
- Filterable table sorted by urgency
- Direct links to PO documents

### Project Management

- Create projects linked to clients
- Track project status: Planning, Ongoing, Delayed, Completed
- Set deadlines and budgets
- BOM snapshots when project status changes
- Project-level cost tracking

### Vendor Management

**Vendor Database**
- Name, type (OEM/Dealer), category, contact info
- Lead times (supports: "14 days", "2 weeks", "1 month")
- Payment terms
- Search and filter by category

**CSV Operations**
- Import vendors with duplicate detection
- Preview changes before merge
- Export vendor list

### Document Management

Project-level document organization:

**Document Types**
- Vendor Quotes
- POs Outgoing (Purchase Orders sent)
- Customer PO (received from customer)

**Features**
- Upload to Firebase Storage
- Link documents to multiple BOM items
- Visual indicators on items showing linked documents
- Collapsible document sections

### Purchase Request System

Generate internal PRs for supply chain:

- Select items to include in PR
- Assign/change vendor per item
- Items grouped by vendor in email
- Mandatory CC to logged-in user
- SendGrid email delivery
- Configure recipients in Settings

### Analytics & Dashboards

**KPI Dashboard** (Admin only)
- Project summary: total, active, completed, overdue
- Financial metrics: budget, spent, utilization
- Status distribution pie chart
- Cost trend line chart
- Project productivity bar chart

**Cost Analysis**
- Project cost per hour configuration
- Miscellaneous costs tracking
- PO value tracking
- BOM material cost aggregation
- Profit/Loss gauge visualization

---

## Architecture

### Project Structure

```
BOM-tracker/
├── src/
│   ├── components/
│   │   ├── BOM/              # BOM-specific components
│   │   │   ├── BOMHeader.tsx
│   │   │   ├── BOMCategoryCard.tsx
│   │   │   ├── BOMPartRow.tsx
│   │   │   ├── ImportBOMDialog.tsx
│   │   │   ├── OrderItemDialog.tsx
│   │   │   ├── ReceiveItemDialog.tsx
│   │   │   ├── InwardTracking.tsx
│   │   │   ├── ProjectDocuments.tsx
│   │   │   └── PurchaseRequestDialog.tsx
│   │   ├── Project/          # Project management
│   │   ├── TimeTracking/     # Time entry components
│   │   ├── settings/         # Settings tabs
│   │   └── ui/               # shadcn/ui components
│   ├── pages/
│   │   ├── Index.tsx         # KPI Dashboard
│   │   ├── Projects.tsx      # Project list
│   │   ├── BOM.tsx           # BOM management
│   │   ├── Settings.tsx      # System settings
│   │   ├── CostAnalysis.tsx  # Cost tracking
│   │   └── TimeTracking.tsx  # Time entry
│   ├── utils/                # Firebase & helper utilities
│   ├── hooks/                # Custom React hooks
│   └── lib/                  # Shared libraries
├── functions/                # Firebase Functions
│   └── index.js              # Cloud functions
├── docs/                     # Documentation
└── firebase.json             # Firebase configuration
```

### Data Model

**Projects Collection** (`projects`)
```typescript
interface Project {
  projectId: string;
  projectName: string;
  clientName: string;
  description: string;
  status: "Planning" | "Ongoing" | "Delayed" | "Completed";
  deadline: string;
  poValue?: number;
  estimatedBudget?: number;
  costPerHour?: number;
  miscCost?: number;
}
```

**BOM Items** (`projects/{projectId}/bom/data`)
```typescript
interface BOMItem {
  id: string;
  name: string;
  category: string;
  itemType: "component" | "service";
  quantity: number;
  unit: string;
  unitPrice?: number;
  make?: string;           // Components only
  sku?: string;            // Components only
  finalizedVendor?: string;
  status: "Not Started" | "In Progress" | "Ordered" | "Received";
  orderDate?: string;
  expectedArrival?: string;
  actualArrival?: string;
  linkedPODocumentId?: string;
}
```

**Vendors Collection** (`vendors` in settings)
```typescript
interface Vendor {
  id: string;
  name: string;
  type: "OEM" | "Dealer";
  category: string;
  leadTime: string;
  paymentTerms: string;
  contactEmail?: string;
  contactPhone?: string;
}
```

---

## Configuration

### Settings Page

Access via sidebar: **Settings**

| Tab | Purpose |
|-----|---------|
| Clients | Manage client list for projects |
| Vendors | Supplier database with lead times |
| Default Categories | Canonical BOM categories (single source of truth) |
| Brands/Makes | Manufacturer list for components |
| Purchase Request | Email recipients for PR system |
| User Management | Admin approval and role management |

### Category Management

Categories are defined centrally in Settings → Default Categories:
- New BOM items must use canonical categories
- Warning banner shows if project has non-canonical categories
- Merge functionality to realign categories

---

## Firebase Functions

### Available Functions

| Function | Type | Purpose |
|----------|------|---------|
| `analyzeBOM` | HTTP | AI-powered BOM text extraction |
| `sendPurchaseRequest` | Callable | Send PR emails via SendGrid |
| `extractQuotationText` | Callable | OCR extraction from quotation PDFs |
| `bootstrapAdmin` | HTTP | Initial admin user setup |
| `setupNewUser` | Auth trigger | New user approval workflow |
| `manageUserStatus` | Callable | Approve/reject user requests |
| `getPendingUsers` | Callable | List pending approvals |
| `getAllUsers` | Callable | List all users with roles |

### Deploying Functions

```bash
# Deploy all functions
firebase deploy --only functions

# Deploy specific function
firebase deploy --only functions:analyzeBOM
```

---

## Development

### Available Scripts

```bash
npm run dev          # Start dev server (localhost:8080)
npm run build        # Production build
npm run preview      # Preview production build
npm run test         # Run tests in watch mode
npm run test:run     # Run tests once
npm run test:coverage # Run tests with coverage
npm run lint         # ESLint check
```

### Code Standards

- TypeScript strict mode
- React functional components with hooks
- shadcn/ui for UI components
- Tailwind CSS for styling
- Firebase real-time listeners for data sync

### Testing

Tests use Vitest with React Testing Library:

```bash
# Run all tests
npm run test:run

# Run with coverage
npm run test:coverage
```

---

## Deployment

### Firebase Hosting

```bash
# Build and deploy everything
npm run deploy

# Or step by step:
npm run build
firebase deploy --only hosting
firebase deploy --only functions
```

### Production URL

After deployment, access at your Firebase Hosting URL or custom domain.

---

## Troubleshooting

### Authentication Issues

**"auth/unauthorized-domain"**
1. Go to Firebase Console → Authentication → Settings
2. Add your domain to Authorized domains
3. For local dev, ensure `localhost` is listed

**Google Sign-in popup blocked**
- Allow popups for your domain
- Try incognito mode to clear cached credentials

### AI Import Issues

**"AI service not configured"**
- Verify OPENAI_API_KEY secret is set in Firebase
- Redeploy functions after setting secrets

**Low quality extractions**
- Use cleaner input text (remove headers/footers)
- Ensure quantities are clearly formatted
- System falls back to keyword matching if AI fails

### Firebase Functions

**Function timeout**
- Default timeout is 60s; increase in function options if needed
- Check Firebase console logs for errors

**CORS errors**
- Functions include CORS headers; verify deployment succeeded
- Check browser console for specific error details

### Build Issues

**TypeScript errors**
```bash
# Check for type issues
npm run build 2>&1 | head -50
```

**Dependency issues**
```bash
rm -rf node_modules package-lock.json
npm install
```

---

## Support

- Check browser console for error messages
- Review Firebase Console logs for backend issues
- Verify environment variables are correctly set

---

## License

Private - Internal use only.
