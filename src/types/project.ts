export type ProjectCategory = "Customer" | "Internal";
export type ProjectStatus = "active" | "on-hold" | "completed";
export type HealthStatus = "critical" | "warning" | "on-track";
export type MilestoneStatus = "not-started" | "in-progress" | "completed" | "blocked";
export type DelayAttribution = 
  | "Internal-Team" 
  | "Internal-Process" 
  | "External-Client" 
  | "External-Vendor" 
  | "External-Other";

export interface RedFlag {
  id: string;
  severity: "critical" | "warning";
  type: string;
  description: string;
}

export interface Milestone {
  id: string;
  name: string;
  originalPlannedStart: Date;
  originalPlannedEnd: Date;
  currentPlannedEnd: Date;
  actualStart?: Date;
  actualEnd?: Date;
  status: MilestoneStatus;
  progress: number;
  estimatedDays: number;
  actualDays?: number;
}

export interface DelayLog {
  id: string;
  date: Date;
  milestoneId?: string;
  milestoneName?: string;
  originalDate: Date;
  newDate: Date;
  delayDays: number;
  reason: string;
  attribution: DelayAttribution;
  loggedBy: string;
  cumulativeDelay: number;
}

export interface WeeklyActivity {
  id: string;
  weekStartDate: Date;
  weekEndDate: Date;
  weekNumber: number;
  activities: string[];
  runningBudgetSpent: number;
  runningTimeCost: number;
  runningMaterialCost: number;
  runningDaysElapsed: number;
  weekSpent: number;
  weekTimeCost: number;
  weekMaterialCost: number;
  weekDaysElapsed: number;
}

export interface Project {
  id: string;
  name: string;
  category: ProjectCategory;
  owner: string;
  status: ProjectStatus;
  
  // Budget
  budgeted: number;
  budgetedTime: number;
  budgetedMaterial: number;
  spent: number;
  spentTime: number;
  spentMaterial: number;
  budgetPercent: number;
  
  // Timeline
  kickoffDate: Date;
  originalTargetEnd: Date;
  currentTargetEnd: Date;
  daysElapsed: number;
  totalDays: number;
  timelinePercent: number;
  progress: number;
  
  // Activity
  lastActivity: Date;
  
  // Health
  healthStatus: HealthStatus;
  redFlags: RedFlag[];
  
  // Detailed data
  milestones: Milestone[];
  delayLogs: DelayLog[];
  weeklyActivities: WeeklyActivity[];
  cumulativeDelay: number;
}
