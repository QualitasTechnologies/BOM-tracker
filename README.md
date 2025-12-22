# BOM Tracker

A Bill of Materials (BOM) management system for engineering and procurement teams. Track components, services, vendors, costs, and project timelines in one place.

## What is BOM Tracker?

BOM Tracker helps teams manage everything related to building products:

- **Track what you need to buy** - Components, parts, and services organized by category
- **Manage your vendors** - Keep a database of suppliers with lead times and payment terms
- **Monitor deliveries** - See what's ordered, what's arriving soon, and what's overdue
- **Control costs** - Real-time cost calculations and budget tracking
- **Store documents** - Upload and link vendor quotes, purchase orders, and invoices

---

## Key Features

### BOM Management

Create and manage your Bill of Materials with two types of items:

| Type | Used For | Tracked By |
|------|----------|------------|
| **Components** | Physical parts | Quantity, Make, SKU, Unit Price |
| **Services** | Labor, consulting | Duration (days), Rate per day |

**Smart Import**: Upload a PDF, Word doc, or text file and let AI extract the parts list automatically.

### Vendor Database

Maintain your supplier database with:
- Company details and contact info
- Lead times (e.g., "14 days", "2 weeks")
- Payment terms
- Categories (Electrical, Mechanical, etc.)
- Import/export via CSV

### Inward Tracking

Track items from order to delivery:

1. **Order an item** - Capture order date, PO number, and link to PO document
2. **Track arrival** - System calculates expected arrival based on vendor lead time
3. **Visual status** - See at a glance what's overdue (red), arriving soon (yellow), or on track
4. **Mark received** - Record actual arrival date and link to invoice

### Document Management

Organize project documents by type:
- **Vendor Quotes** - Quotations received from suppliers
- **POs Outgoing** - Purchase orders you've sent
- **Customer PO** - The customer's purchase order for the project
- **Vendor Invoices** - Invoices for received items

Documents can be linked to multiple BOM items for easy reference.

### Purchase Requests

Generate internal purchase requests to send to your supply chain team:
- Select which items to include
- Assign vendors to each item
- Email is sent with items grouped by vendor
- Recipients configured in Settings

### Analytics Dashboard

For admins, a KPI dashboard shows:
- Project counts (active, completed, overdue)
- Budget utilization
- Cost trends over time
- Project status distribution

---

## Getting Started

### For Users

1. **Sign in** with Google or email/password
2. **Create a project** - Link it to a client and set the budget
3. **Add BOM items** - Manually or import from a file
4. **Assign vendors** - Choose suppliers from your vendor database
5. **Track orders** - Update status as items are ordered and received
6. **Upload documents** - Link quotes, POs, and invoices to items

### Settings to Configure

Before you start, set up these in **Settings**:

| Setting | Purpose |
|---------|---------|
| Clients | Companies you work with |
| Vendors | Your supplier database |
| Default Categories | Standard BOM categories |
| Brands/Makes | Manufacturer list |
| Purchase Request | Email recipients for PRs |

---

## Tech Stack

- **Frontend**: React, TypeScript, Tailwind CSS
- **Backend**: Firebase (Authentication, Database, Storage, Cloud Functions)
- **AI**: OpenAI GPT-4o-mini for document parsing
- **Email**: SendGrid for purchase requests

---

## Development

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Run tests
npm run test:run

# Build for production
npm run build

# Deploy
firebase deploy
```

---

## Support

For issues or questions, check the browser console for error messages or review Firebase Console logs for backend issues.
