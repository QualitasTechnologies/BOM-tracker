import { Project } from "@/types/project";

export const mockProjects: Project[] = [
  {
    id: "1",
    name: "ITC Vision System",
    category: "Customer",
    owner: "Rahul Kumar",
    status: "active",
    budgeted: 1000000,
    spent: 920000,
    budgetPercent: 92,
    kickoffDate: new Date("2025-01-03"),
    originalTargetEnd: new Date("2025-03-01"),
    currentTargetEnd: new Date("2025-03-22"),
    daysElapsed: 45,
    totalDays: 78,
    timelinePercent: 58,
    progress: 45,
    lastActivity: new Date(Date.now() - 5 * 60 * 60 * 1000), // 5 hours ago
    healthStatus: "critical",
    cumulativeDelay: 21,
    redFlags: [
      {
        id: "f1",
        severity: "critical",
        type: "budget",
        description: "92% budget consumed with 42% timeline remaining"
      },
      {
        id: "f2",
        severity: "critical",
        type: "timeline",
        description: "21 days behind schedule"
      },
      {
        id: "f3",
        severity: "warning",
        type: "progress",
        description: "Progress (45%) lagging timeline (58%) by 13%"
      }
    ],
    milestones: [
      {
        id: "m1",
        name: "Setup & Planning",
        originalPlannedStart: new Date("2025-01-03"),
        originalPlannedEnd: new Date("2025-01-10"),
        currentPlannedEnd: new Date("2025-01-15"),
        actualStart: new Date("2025-01-03"),
        actualEnd: new Date("2025-01-15"),
        status: "completed",
        progress: 100,
        estimatedDays: 7,
        actualDays: 12
      },
      {
        id: "m2",
        name: "Hardware Integration",
        originalPlannedStart: new Date("2025-01-11"),
        originalPlannedEnd: new Date("2025-02-20"),
        currentPlannedEnd: new Date("2025-03-07"),
        actualStart: new Date("2025-01-16"),
        actualEnd: new Date("2025-03-07"),
        status: "completed",
        progress: 100,
        estimatedDays: 40,
        actualDays: 50
      },
      {
        id: "m3",
        name: "Testing & Deployment",
        originalPlannedStart: new Date("2025-02-21"),
        originalPlannedEnd: new Date("2025-03-01"),
        currentPlannedEnd: new Date("2025-03-22"),
        actualStart: new Date("2025-03-08"),
        status: "in-progress",
        progress: 30,
        estimatedDays: 9,
      }
    ],
    delayLogs: [
      {
        id: "d1",
        date: new Date("2025-01-15"),
        milestoneId: "m1",
        milestoneName: "Setup & Planning",
        originalDate: new Date("2025-01-10"),
        newDate: new Date("2025-01-15"),
        delayDays: 5,
        reason: "Client delayed requirements sign-off by 1 week. We sent requirements document on Jan 3, client scheduled review meeting for Jan 12, final approval received Jan 14.",
        attribution: "External-Client",
        loggedBy: "Rahul Kumar",
        cumulativeDelay: 5
      },
      {
        id: "d2",
        date: new Date("2025-02-08"),
        milestoneId: "m2",
        milestoneName: "Hardware Integration",
        originalDate: new Date("2025-02-20"),
        newDate: new Date("2025-02-28"),
        delayDays: 8,
        reason: "Camera mounting brackets required custom fabrication not in original scope. Client requested higher precision mounts after seeing prototype on Jan 28. Custom brackets ordered Feb 1, delivery delayed to Feb 10.",
        attribution: "External-Client",
        loggedBy: "Rahul Kumar",
        cumulativeDelay: 13
      },
      {
        id: "d3",
        date: new Date("2025-02-20"),
        milestoneId: "m2",
        milestoneName: "Hardware Integration",
        originalDate: new Date("2025-02-28"),
        newDate: new Date("2025-03-07"),
        delayDays: 7,
        reason: "Engineer underestimated cable routing complexity in tight spaces. Original estimate was 8 hours, actual took 30 hours. Required custom cable lengths and multiple iterations to achieve clean routing.",
        attribution: "Internal-Team",
        loggedBy: "Rahul Kumar",
        cumulativeDelay: 20
      },
      {
        id: "d4",
        date: new Date("2025-02-25"),
        milestoneId: "m3",
        milestoneName: "Testing & Deployment",
        originalDate: new Date("2025-03-01"),
        newDate: new Date("2025-03-22"),
        delayDays: 21,
        reason: "Client site not ready for installation. HVAC and electrical work delayed by 3 weeks due to contractor scheduling issues on client side.",
        attribution: "External-Client",
        loggedBy: "Rahul Kumar",
        cumulativeDelay: 21
      }
    ]
  },
  {
    id: "2",
    name: "Inventory Management Portal",
    category: "Customer",
    owner: "Priya Singh",
    status: "active",
    budgeted: 800000,
    spent: 560000,
    budgetPercent: 70,
    kickoffDate: new Date("2025-01-15"),
    originalTargetEnd: new Date("2025-04-15"),
    currentTargetEnd: new Date("2025-04-15"),
    daysElapsed: 30,
    totalDays: 90,
    timelinePercent: 33,
    progress: 38,
    lastActivity: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hours ago
    healthStatus: "on-track",
    cumulativeDelay: 0,
    redFlags: [],
    milestones: [],
    delayLogs: []
  },
  {
    id: "3",
    name: "Internal DevOps Pipeline",
    category: "Internal",
    owner: "Amit Patel",
    status: "active",
    budgeted: 400000,
    spent: 380000,
    budgetPercent: 95,
    kickoffDate: new Date("2024-12-01"),
    originalTargetEnd: new Date("2025-02-28"),
    currentTargetEnd: new Date("2025-03-15"),
    daysElapsed: 75,
    totalDays: 89,
    timelinePercent: 84,
    progress: 82,
    lastActivity: new Date(Date.now() - 50 * 60 * 60 * 1000), // 50 hours ago
    healthStatus: "critical",
    cumulativeDelay: 15,
    redFlags: [
      {
        id: "f4",
        severity: "critical",
        type: "budget",
        description: "95% budget consumed"
      },
      {
        id: "f5",
        severity: "critical",
        type: "activity",
        description: "No activity for 50 hours on active milestone"
      }
    ],
    milestones: [],
    delayLogs: []
  },
  {
    id: "4",
    name: "ERP Module Integration",
    category: "Customer",
    owner: "Deepak Sharma",
    status: "active",
    budgeted: 1500000,
    spent: 1100000,
    budgetPercent: 73,
    kickoffDate: new Date("2024-12-15"),
    originalTargetEnd: new Date("2025-05-15"),
    currentTargetEnd: new Date("2025-05-15"),
    daysElapsed: 61,
    totalDays: 151,
    timelinePercent: 40,
    progress: 55,
    lastActivity: new Date(Date.now() - 4 * 60 * 60 * 1000), // 4 hours ago
    healthStatus: "on-track",
    cumulativeDelay: 0,
    redFlags: [],
    milestones: [],
    delayLogs: []
  },
  {
    id: "5",
    name: "Mobile App MVP",
    category: "Internal",
    owner: "Sneha Reddy",
    status: "active",
    budgeted: 600000,
    spent: 480000,
    budgetPercent: 80,
    kickoffDate: new Date("2025-01-08"),
    originalTargetEnd: new Date("2025-04-08"),
    currentTargetEnd: new Date("2025-04-20"),
    daysElapsed: 37,
    totalDays: 90,
    timelinePercent: 41,
    progress: 35,
    lastActivity: new Date(Date.now() - 8 * 60 * 60 * 1000), // 8 hours ago
    healthStatus: "warning",
    cumulativeDelay: 12,
    redFlags: [
      {
        id: "f6",
        severity: "warning",
        type: "progress",
        description: "Falling behind: Timeline 41% but progress only 35%"
      }
    ],
    milestones: [],
    delayLogs: []
  },
  {
    id: "6",
    name: "Customer Analytics Dashboard",
    category: "Customer",
    owner: "Vikram Gupta",
    status: "active",
    budgeted: 900000,
    spent: 270000,
    budgetPercent: 30,
    kickoffDate: new Date("2025-02-01"),
    originalTargetEnd: new Date("2025-05-01"),
    currentTargetEnd: new Date("2025-05-01"),
    daysElapsed: 14,
    totalDays: 89,
    timelinePercent: 16,
    progress: 20,
    lastActivity: new Date(Date.now() - 1 * 60 * 60 * 1000), // 1 hour ago
    healthStatus: "on-track",
    cumulativeDelay: 0,
    redFlags: [],
    milestones: [],
    delayLogs: []
  }
];
