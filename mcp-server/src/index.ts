#!/usr/bin/env node
/**
 * BOM Tracker MCP Server
 *
 * Auth (in order of precedence):
 *   1. FIREBASE_SERVICE_ACCOUNT_KEY = /path/to/service-account.json
 *   2. GOOGLE_APPLICATION_CREDENTIALS = /path/to/adc.json  (picked up by applicationDefault())
 *   3. applicationDefault() will also find gcloud / firebase CLI ADC automatically
 *
 * Claude Desktop env vars needed:
 *   FIREBASE_PROJECT_ID        (default: "visionbomtracker")
 *   FIREBASE_SERVICE_ACCOUNT_KEY  OR  GOOGLE_APPLICATION_CREDENTIALS
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { initializeApp, cert, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { readFileSync } from "fs";

// ─── Firebase Init ────────────────────────────────────────────────────────────

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID ?? "visionbomtracker";
const SA_KEY_PATH = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;

try {
  if (SA_KEY_PATH) {
    const key = JSON.parse(readFileSync(SA_KEY_PATH, "utf-8"));
    initializeApp({ credential: cert(key), projectId: PROJECT_ID });
    console.error("[BOM MCP] Auth: service account key →", SA_KEY_PATH);
  } else {
    initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
    console.error("[BOM MCP] Auth: application default credentials");
  }
  console.error(`[BOM MCP] Firebase project: ${PROJECT_ID}`);
} catch (err) {
  console.error("[BOM MCP] Firebase init failed:", err);
  process.exit(1);
}

const db = getFirestore();

// ─── Types ────────────────────────────────────────────────────────────────────

interface BOMItem {
  id: string;
  name: string;
  description?: string;
  itemType?: "component" | "service";
  category: string;
  quantity: number;
  price?: number;
  make?: string;
  sku?: string;
  status: "not-ordered" | "ordered" | "received";
  finalizedVendor?: { name: string; price: number; leadTime: string };
  expectedArrival?: string;
  actualArrival?: string;
  orderDate?: string;
  poNumber?: string;
  fulfillmentTranches?: Array<{ id: string; quantity: number; loggedAt: string }>;
  vendors: Array<{ name: string; price: number; leadTime: string; availability: string }>;
}

interface BOMCategory {
  name: string;
  items: BOMItem[];
}

interface Project {
  projectId: string;
  projectName: string;
  clientName: string;
  status: string;
  deadline?: string;
  poValue?: number;
  description?: string;
}

interface Vendor {
  id: string;
  name: string;
  type: "OEM" | "Dealer";
  makes?: string[];
  contactInfo?: { email?: string; phone?: string; website?: string };
  address?: string;
  notes?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const INR = (n: number) => `₹${n.toLocaleString("en-IN")}`;

function fmtDate(iso?: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function getTotalReceived(item: BOMItem): number {
  if (item.fulfillmentTranches?.length) {
    return item.fulfillmentTranches.reduce((s, t) => s + t.quantity, 0);
  }
  return item.status === "received" ? item.quantity : 0;
}

type InwardStatus = "not-ordered" | "received" | "partial" | "overdue" | "arriving-soon" | "on-track";

function inwardStatus(item: BOMItem): InwardStatus {
  if (item.status === "not-ordered") return "not-ordered";
  if (item.status === "received") return "received";
  const received = getTotalReceived(item);
  if (received > 0 && received < item.quantity) return "partial";
  if (!item.expectedArrival) return "on-track";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const exp = new Date(item.expectedArrival);
  exp.setHours(0, 0, 0, 0);
  const days = Math.ceil((exp.getTime() - today.getTime()) / 86_400_000);
  if (days < 0) return "overdue";
  if (days <= 7) return "arriving-soon";
  return "on-track";
}

const STATUS_EMOJI: Record<InwardStatus, string> = {
  received: "✅",
  partial: "🟠",
  overdue: "🔴",
  "arriving-soon": "🟡",
  "on-track": "🔵",
  "not-ordered": "⚪",
};

async function fetchProjects(): Promise<Project[]> {
  const snap = await db.collection("projects").get();
  return snap.docs.map((d) => ({ projectId: d.id, ...d.data() } as Project));
}

async function fetchBOM(projectId: string): Promise<BOMCategory[]> {
  const doc = await db
    .collection("projects")
    .doc(projectId)
    .collection("bom")
    .doc("data")
    .get();
  return (doc.data()?.categories ?? []) as BOMCategory[];
}

function flatItems(cats: BOMCategory[]): BOMItem[] {
  return cats.flatMap((c) => c.items);
}

function text(t: string) {
  return { content: [{ type: "text" as const, text: t }] };
}

// ─── MCP Server ───────────────────────────────────────────────────────────────

const server = new Server(
  { name: "bom-tracker", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

// ─── Tool Definitions ─────────────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "projects_list",
      description:
        "List all BOM Tracker projects with their status, deadline, PO value, item count, and total BOM cost. Defaults to active projects only; pass status_filter to see all.",
      inputSchema: {
        type: "object",
        properties: {
          status_filter: {
            type: "string",
            description:
              "Filter by exact status: Planning | Procurement | Ongoing | Delayed | Completed | Archived. Omit for all active (non-archived/completed) projects.",
          },
        },
        required: [],
      },
    },
    {
      name: "project_bom",
      description:
        "Get the full Bill of Materials for a specific project, grouped by category. Shows unit price, total cost, vendor, and inward tracking status per item.",
      inputSchema: {
        type: "object",
        properties: {
          project_id: {
            type: "string",
            description: "Project ID, e.g. PRJ-004",
          },
        },
        required: ["project_id"],
      },
    },
    {
      name: "daily_briefing",
      description:
        "Cross-project morning briefing: overdue inward items, items arriving this week, partial receipts, unpriced components, and active project summary.",
      inputSchema: { type: "object", properties: {}, required: [] },
    },
    {
      name: "inward_tracking",
      description:
        "Inward tracking status for all ordered items. Shows overdue, arriving-soon, partial receipts, and fully received items. Filter to a single project by passing project_id.",
      inputSchema: {
        type: "object",
        properties: {
          project_id: {
            type: "string",
            description: "Specific project ID, or omit for all active projects.",
          },
        },
        required: [],
      },
    },
    {
      name: "vendors_search",
      description:
        "Search the global vendor database by name, brand/make, or product type. Optionally filter by vendor type (OEM vs Dealer).",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search term: vendor name, brand (e.g. Siemens), or product category.",
          },
          type: {
            type: "string",
            enum: ["OEM", "Dealer"],
            description: "Filter by vendor type (optional).",
          },
        },
        required: [],
      },
    },
    {
      name: "bom_add_item",
      description:
        "Add a new component or service item to a project's BOM. The category must already exist in the project. Returns the new item ID.",
      inputSchema: {
        type: "object",
        properties: {
          project_id: { type: "string", description: "Project ID, e.g. PRJ-004" },
          category: {
            type: "string",
            description: "Category name to add the item to (case-insensitive match).",
          },
          name: { type: "string", description: "Item name" },
          description: { type: "string", description: "Brief item description" },
          quantity: {
            type: "number",
            description: "Quantity in units (component) or days (service)",
          },
          price: { type: "number", description: "Unit price in INR (optional)" },
          make: { type: "string", description: "Make / brand, e.g. Siemens (optional, components)" },
          sku: { type: "string", description: "Part number or SKU (optional)" },
          item_type: {
            type: "string",
            enum: ["component", "service"],
            description: "Item type. Default: component.",
          },
        },
        required: ["project_id", "category", "name", "description", "quantity"],
      },
    },
  ],
}));

// ─── Tool Dispatcher ──────────────────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  const a = (args ?? {}) as Record<string, unknown>;
  try {
    switch (name) {
      case "projects_list":  return await toolProjectsList(a);
      case "project_bom":    return await toolProjectBOM(a);
      case "daily_briefing": return await toolDailyBriefing();
      case "inward_tracking":return await toolInwardTracking(a);
      case "vendors_search": return await toolVendorsSearch(a);
      case "bom_add_item":   return await toolBomAddItem(a);
      default:
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }
  } catch (err) {
    if (err instanceof McpError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    return { ...text(`Error: ${msg}`), isError: true };
  }
});

// ─── Tool Implementations ─────────────────────────────────────────────────────

async function toolProjectsList(args: Record<string, unknown>) {
  const projects = await fetchProjects();
  const statusFilter = (args.status_filter as string | undefined)?.toLowerCase();
  const list = statusFilter
    ? projects.filter((p) => p.status?.toLowerCase() === statusFilter)
    : projects.filter((p) => !["Completed", "Archived"].includes(p.status));

  list.sort((a, b) => a.projectId.localeCompare(b.projectId));

  const lines: string[] = [`# BOM Tracker Projects (${list.length})\n`];
  for (const p of list) {
    const cats = await fetchBOM(p.projectId);
    const items = flatItems(cats);
    const totalCost = items.reduce((s, i) => s + (i.price ?? 0) * i.quantity, 0);
    const priced = items.filter((i) => i.price != null).length;

    lines.push(`## ${p.projectId} — ${p.projectName}`);
    lines.push(`- **Client:** ${p.clientName}  |  **Status:** ${p.status}  |  **Deadline:** ${fmtDate(p.deadline)}`);
    if (p.poValue) lines.push(`- **PO Value:** ${INR(p.poValue)}`);
    lines.push(`- **BOM:** ${items.length} items  |  **Cost:** ${INR(totalCost)}  |  Priced: ${priced}/${items.length}`);
    if (p.description) lines.push(`- _${p.description}_`);
    lines.push("");
  }
  return text(lines.join("\n"));
}

async function toolProjectBOM(args: Record<string, unknown>) {
  const projectId = args.project_id as string;
  if (!projectId) throw new McpError(ErrorCode.InvalidParams, "project_id is required");

  const projSnap = await db.collection("projects").doc(projectId).get();
  if (!projSnap.exists) {
    throw new McpError(ErrorCode.InvalidParams, `Project ${projectId} not found`);
  }
  const proj = projSnap.data() as Project;
  const cats = await fetchBOM(projectId);

  const lines: string[] = [
    `# BOM — ${proj.projectName} (${projectId})`,
    `**Client:** ${proj.clientName}  |  **Status:** ${proj.status}  |  **Deadline:** ${fmtDate(proj.deadline)}\n`,
  ];

  let grandTotal = 0;
  for (const cat of cats) {
    const catCost = cat.items.reduce((s, i) => s + (i.price ?? 0) * i.quantity, 0);
    grandTotal += catCost;
    lines.push(`## ${cat.name}  [${INR(catCost)}]`);
    for (const item of cat.items) {
      const st = inwardStatus(item);
      const received = getTotalReceived(item);
      const emoji = st !== "not-ordered" ? ` ${STATUS_EMOJI[st]}` : "";
      const partialStr = st === "partial" ? ` (${received}/${item.quantity} rcvd)` : "";
      const vendor =
        item.finalizedVendor?.name ?? item.vendors?.[0]?.name ?? "—";
      lines.push(
        `- **${item.name}**${item.make ? ` (${item.make})` : ""}  ×${item.quantity}${emoji}${partialStr}`
      );
      lines.push(
        `  ${item.price ? INR(item.price) + "/unit" : "— (unpriced)"}  Total: ${INR((item.price ?? 0) * item.quantity)}  Vendor: ${vendor}`
      );
      if (item.sku) lines.push(`  SKU: ${item.sku}`);
      if (item.expectedArrival) lines.push(`  Expected: ${fmtDate(item.expectedArrival)}`);
    }
    lines.push("");
  }
  lines.push(`---\n**Grand Total: ${INR(grandTotal)}**`);
  return text(lines.join("\n"));
}

async function toolDailyBriefing() {
  const projects = await fetchProjects();
  const active = projects.filter((p) => !["Completed", "Archived"].includes(p.status));

  const overdue: string[] = [];
  const arrivingSoon: string[] = [];
  const partial: string[] = [];
  const unpricedByProject: string[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (const p of active) {
    const cats = await fetchBOM(p.projectId);
    const items = flatItems(cats);

    const unpricedCount = items.filter(
      (i) => !i.price && (i.itemType ?? "component") !== "service"
    ).length;
    if (unpricedCount > 0) {
      unpricedByProject.push(
        `${p.projectId} ${p.projectName}: ${unpricedCount} item${unpricedCount > 1 ? "s" : ""}`
      );
    }

    for (const item of items) {
      const st = inwardStatus(item);
      const label = `**${p.projectId}** / ${item.name} ×${item.quantity}`;
      if (st === "overdue" && item.expectedArrival) {
        const d = Math.ceil(
          (today.getTime() - new Date(item.expectedArrival).getTime()) / 86_400_000
        );
        overdue.push(`${label} — ${d}d overdue (exp ${item.expectedArrival})`);
      } else if (st === "arriving-soon" && item.expectedArrival) {
        const d = Math.ceil(
          (new Date(item.expectedArrival).getTime() - today.getTime()) / 86_400_000
        );
        arrivingSoon.push(`${label} — arrives in ${d}d (${item.expectedArrival})`);
      } else if (st === "partial") {
        partial.push(
          `${label} — ${getTotalReceived(item)}/${item.quantity} received`
        );
      }
    }
  }

  const section = (header: string, items: string[], emptyMsg = "None") =>
    `\n## ${header}\n${items.length ? items.map((s) => `- ${s}`).join("\n") : `- ${emptyMsg}`}`;

  const dateStr = today.toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return text(
    [
      `# Daily BOM Briefing — ${dateStr}`,
      section(`🔴 Overdue (${overdue.length})`, overdue),
      section(`🟡 Arriving Soon / This Week (${arrivingSoon.length})`, arrivingSoon),
      section(`🟠 Partial Receipts (${partial.length})`, partial),
      section(`⚪ Unpriced Components`, unpricedByProject, "All components priced ✅"),
      `\n## 📋 Active Projects (${active.length})`,
      active
        .map(
          (p) =>
            `- **${p.projectId}** ${p.projectName} [${p.status}] — due ${fmtDate(p.deadline)}`
        )
        .join("\n"),
    ].join("\n")
  );
}

async function toolInwardTracking(args: Record<string, unknown>) {
  const projectFilter = args.project_id as string | undefined;
  const projects = await fetchProjects();
  const scope = projectFilter
    ? projects.filter((p) => p.projectId === projectFilter)
    : projects.filter((p) => !["Completed", "Archived"].includes(p.status));

  if (scope.length === 0) {
    throw new McpError(
      ErrorCode.InvalidParams,
      projectFilter ? `Project ${projectFilter} not found` : "No active projects found"
    );
  }

  const lines: string[] = [
    `# Inward Tracking — ${projectFilter ?? "All Active Projects"}\n`,
  ];

  let anyFound = false;
  for (const p of scope) {
    const cats = await fetchBOM(p.projectId);
    const orderedItems = flatItems(cats).filter((i) => i.status !== "not-ordered");
    if (!orderedItems.length) continue;
    anyFound = true;
    lines.push(`## ${p.projectId} — ${p.projectName}`);
    for (const item of orderedItems) {
      const st = inwardStatus(item);
      const received = getTotalReceived(item);
      lines.push(
        `${STATUS_EMOJI[st]} **${item.name}** ×${item.quantity}  [${st}${st === "partial" ? ` — ${received}/${item.quantity} rcvd` : ""}]`
      );
      lines.push(
        `  PO#: ${item.poNumber ?? "—"}  |  Ordered: ${fmtDate(item.orderDate)}  |  Expected: ${fmtDate(item.expectedArrival)}`
      );
      if (item.actualArrival) lines.push(`  Received: ${fmtDate(item.actualArrival)}`);
    }
    lines.push("");
  }

  if (!anyFound) return text("No ordered items found.");
  return text(lines.join("\n"));
}

async function toolVendorsSearch(args: Record<string, unknown>) {
  const q = ((args.query as string) ?? "").toLowerCase();
  const typeFilter = args.type as "OEM" | "Dealer" | undefined;

  const snap = await db.collection("vendors").get();
  const vendors = snap.docs.map((d) => ({ id: d.id, ...d.data() })) as Vendor[];

  const results = vendors.filter((v) => {
    if (typeFilter && v.type !== typeFilter) return false;
    if (!q) return true;
    return (
      v.name?.toLowerCase().includes(q) ||
      v.makes?.some((m) => m.toLowerCase().includes(q)) ||
      (v.notes ?? "").toLowerCase().includes(q)
    );
  });

  if (!results.length) {
    return text(
      `No vendors found${q ? ` matching "${args.query as string}"` : ""}${typeFilter ? ` with type ${typeFilter}` : ""}.`
    );
  }

  results.sort((a, b) => a.name.localeCompare(b.name));
  const lines = [`# Vendors (${results.length} result${results.length === 1 ? "" : "s"})\n`];
  for (const v of results) {
    lines.push(`## ${v.name} [${v.type}]`);
    if (v.makes?.length) lines.push(`- **Makes:** ${v.makes.join(", ")}`);
    if (v.contactInfo?.email) lines.push(`- **Email:** ${v.contactInfo.email}`);
    if (v.contactInfo?.phone) lines.push(`- **Phone:** ${v.contactInfo.phone}`);
    if (v.contactInfo?.website) lines.push(`- **Web:** ${v.contactInfo.website}`);
    if (v.address) lines.push(`- **Address:** ${v.address}`);
    if (v.notes) lines.push(`- **Notes:** ${v.notes}`);
    lines.push("");
  }
  return text(lines.join("\n"));
}

async function toolBomAddItem(args: Record<string, unknown>) {
  const {
    project_id,
    category,
    name,
    description,
    quantity,
    price,
    make,
    sku,
    item_type = "component",
  } = args as {
    project_id: string;
    category: string;
    name: string;
    description: string;
    quantity: number;
    price?: number;
    make?: string;
    sku?: string;
    item_type?: string;
  };

  if (!project_id || !category || !name || !description || !quantity) {
    throw new McpError(
      ErrorCode.InvalidParams,
      "project_id, category, name, description, and quantity are all required"
    );
  }

  const bomRef = db
    .collection("projects")
    .doc(project_id)
    .collection("bom")
    .doc("data");
  const bomSnap = await bomRef.get();
  if (!bomSnap.exists) {
    throw new McpError(ErrorCode.InvalidParams, `Project ${project_id} has no BOM yet`);
  }

  const categories: BOMCategory[] = bomSnap.data()?.categories ?? [];
  const catIdx = categories.findIndex(
    (c) => c.name.toLowerCase() === category.toLowerCase()
  );
  if (catIdx === -1) {
    const available = categories.map((c) => c.name).join(", ");
    throw new McpError(
      ErrorCode.InvalidParams,
      `Category "${category}" not found in ${project_id}. Available: ${available}`
    );
  }

  const itemId = `mcp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const newItem: Record<string, unknown> = {
    id: itemId,
    name,
    description,
    itemType: item_type,
    category: categories[catIdx].name,
    quantity: Number(quantity),
    status: "not-ordered",
    vendors: [],
  };
  if (price != null) newItem.price = Number(price);
  if (make) newItem.make = make;
  if (sku) newItem.sku = sku;

  categories[catIdx].items = [
    ...categories[catIdx].items,
    newItem as unknown as BOMItem,
  ];
  await bomRef.update({ categories });

  const costStr = price != null ? INR(Number(price) * Number(quantity)) : "no price yet";
  return text(
    `✅ Added **${name}** ×${quantity} to **${project_id} / ${categories[catIdx].name}**\n` +
      `Total cost: ${costStr}\nItem ID: ${itemId}`
  );
}

// ─── Start ────────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("[BOM MCP] Ready — listening on stdio");
