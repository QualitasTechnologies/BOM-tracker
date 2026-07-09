export const EXPENSE_CATEGORIES = [
  'Transport',
  'Accommodation',
  'Food & Per Diem',
  'Client Entertainment',
  'Communication',
  'Miscellaneous',
] as const;
export type ExpenseCategory = typeof EXPENSE_CATEGORIES[number];

export const MEAL_TYPES = ['Breakfast', 'Lunch', 'Dinner', 'Snacks', 'Other'] as const;
export type MealType = typeof MEAL_TYPES[number];

export type ReimbursementStatus = 'draft' | 'pending' | 'approved' | 'rejected';

export interface TravelExpenseItem {
  id: string;
  category: ExpenseCategory;
  date?: string;                // YYYY-MM-DD — optional, tags expense to a specific day
  description?: string;         // Transport / Entertainment / Communication / Miscellaneous
  amount: number;               // INR total for this line (auto-calculated for Accommodation)
  receiptUrl?: string;          // Firebase Storage download URL
  receiptName?: string;         // Original filename for display
  // Accommodation-specific
  rooms?: number;
  nights?: number;
  peoplePerRoom?: number;
  ratePerRoomPerNight?: number;
  // Food & Per Diem-specific
  mealType?: MealType;
  people?: number;
}

export interface TravelVisit {
  id: string;
  startDate: string;            // YYYY-MM-DD (canonical — replaces legacy `date`)
  endDate: string;              // YYYY-MM-DD (= startDate for single-day visits)
  date?: string;                // DEPRECATED: only on legacy records — read startDate ?? date
  attendees: string[];          // userIds of project members who went
  location?: string;
  purpose?: string;
  expenses: TravelExpenseItem[];
  totalCost: number;            // denormalized sum of expenses; backward compat field
  reimbursementStatus: ReimbursementStatus;
  notes?: string;
  createdAt: string;            // ISO timestamp
  createdBy: string;            // userId
}

export const OTHER_OVERHEAD_CATEGORIES = [
  'Testing & Certification',
  'Freight & Logistics',
  'Admin & Documentation',
  'Training',
  'Other',
] as const;

export type OtherOverheadCategory = typeof OTHER_OVERHEAD_CATEGORIES[number];

export interface OverheadEntry {
  id: string;
  date: string;                 // YYYY-MM-DD
  category: OtherOverheadCategory;
  description: string;
  amount: number;               // INR
  notes?: string;
  createdAt: string;
  createdBy: string;
}

export interface ProjectOverheads {
  travelVisits: TravelVisit[];
  otherEntries: OverheadEntry[];
}
