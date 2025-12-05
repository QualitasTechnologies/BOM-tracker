import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';

export type UserRole = 'admin' | 'user' | 'viewer';
export type UserStatus = 'approved' | 'pending' | 'rejected' | 'suspended';

export interface UserPermissions {
  canManageUsers: boolean;
  canManageSettings: boolean;
  canCreateProjects: boolean;
  canDeleteProjects: boolean;
  canManageVendors: boolean;
  canManageClients: boolean;
  canImportBOM: boolean;
  canExportBOM: boolean;
  canViewAnalytics: boolean;
  canManageBOMSettings: boolean;
}

export const ROLE_PERMISSIONS: Record<UserRole, UserPermissions> = {
  admin: {
    canManageUsers: true,
    canManageSettings: true,
    canCreateProjects: true,
    canDeleteProjects: true,
    canManageVendors: true,
    canManageClients: true,
    canImportBOM: true,
    canExportBOM: true,
    canViewAnalytics: true,
    canManageBOMSettings: true,
  },
  user: {
    canManageUsers: false,
    canManageSettings: false,
    canCreateProjects: true,
    canDeleteProjects: false,
    canManageVendors: false,
    canManageClients: false,
    canImportBOM: true,
    canExportBOM: true,
    canViewAnalytics: false,
    canManageBOMSettings: false,
  },
  viewer: {
    canManageUsers: false,
    canManageSettings: false,
    canCreateProjects: false,
    canDeleteProjects: false,
    canManageVendors: false,
    canManageClients: false,
    canImportBOM: false,
    canExportBOM: false,
    canViewAnalytics: false,
    canManageBOMSettings: false,
  },
};

export const getUserPermissions = (role: UserRole): UserPermissions => {
  return ROLE_PERMISSIONS[role];
};

export const hasPermission = (role: UserRole, permission: keyof UserPermissions): boolean => {
  return ROLE_PERMISSIONS[role][permission];
};

// Firebase Functions calls
export const manageUserStatus = httpsCallable(functions, 'manageUserStatus');
export const getPendingUsers = httpsCallable(functions, 'getPendingUsers');
export const getAllUsers = httpsCallable(functions, 'getAllUsers');
export const deleteUserFunction = httpsCallable(functions, 'deleteUser');

// Helper functions for calling Firebase Functions
export const approveUser = async (targetUid: string, role: UserRole = 'user') => {
  try {
    const result = await manageUserStatus({ targetUid, action: 'approve', role });
    return result.data;
  } catch (error) {
    console.error('Error approving user:', error);
    throw error;
  }
};

export const rejectUser = async (targetUid: string) => {
  try {
    const result = await manageUserStatus({ targetUid, action: 'reject' });
    return result.data;
  } catch (error) {
    console.error('Error rejecting user:', error);
    throw error;
  }
};

export const suspendUser = async (targetUid: string) => {
  try {
    const result = await manageUserStatus({ targetUid, action: 'suspend' });
    return result.data;
  } catch (error) {
    console.error('Error suspending user:', error);
    throw error;
  }
};

export const updateUserRole = async (targetUid: string, role: UserRole) => {
  try {
    const result = await manageUserStatus({ targetUid, action: 'updateRole', role });
    return result.data;
  } catch (error) {
    console.error('Error updating user role:', error);
    throw error;
  }
};

export const fetchPendingUsers = async () => {
  try {
    const result = await getPendingUsers();
    return result.data;
  } catch (error) {
    console.error('Error fetching pending users:', error);
    throw error;
  }
};

export const fetchAllUsers = async () => {
  try {
    const result = await getAllUsers();
    return result.data;
  } catch (error) {
    console.error('Error fetching all users:', error);
    throw error;
  }
};

export const deleteUser = async (targetUid: string) => {
  try {
    const result = await deleteUserFunction({ targetUid });
    return result.data;
  } catch (error) {
    console.error('Error deleting user:', error);
    throw error;
  }
};