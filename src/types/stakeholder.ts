export interface Stakeholder {
  id: string;
  name: string;
  email: string;
  isInternalUser: boolean;
  userId: string | null; // Firebase user ID if internal, null if external
  notificationsEnabled: boolean;
  lastNotificationSentAt: Date | null;
  createdAt: Date;
  createdBy: string; // userId of who added them
}

export interface StakeholderInput {
  name: string;
  email: string;
  isInternalUser: boolean;
  userId: string | null;
  notificationsEnabled: boolean;
}
