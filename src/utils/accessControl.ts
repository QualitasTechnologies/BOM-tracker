// src/utils/accessControl.ts
import { BOMCategory } from '@/types/bom';
import { ProjectMember } from '@/utils/projectFirestore';

export const INTERNAL_DOMAIN = '@qualitastech.com';

export function isInternalUser(email: string): boolean {
  return email.toLowerCase().endsWith(INTERNAL_DOMAIN);
}

/**
 * Returns the BOM categories visible to the current user in this project.
 *
 * Rules:
 *  - admin role → all categories
 *  - @qualitastech.com email → all categories
 *  - external user with no categoryScope or empty scope → [] (sees nothing)
 *  - external user with categoryScope → only matching categories
 */
export function getVisibleCategories(
  userEmail: string,
  userRole: string,
  member: ProjectMember | undefined,
  allCategories: BOMCategory[]
): BOMCategory[] {
  if (userRole === 'admin') return allCategories;
  if (isInternalUser(userEmail)) return allCategories;
  if (!member?.categoryScope || member.categoryScope.length === 0) return [];
  return allCategories.filter(c => member.categoryScope!.includes(c.name));
}
