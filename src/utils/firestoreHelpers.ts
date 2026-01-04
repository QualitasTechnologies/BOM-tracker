/**
 * Shared utilities for Firestore operations
 */

/**
 * Remove undefined values from an object to prevent Firestore errors
 * This is a shared utility used across multiple Firestore modules
 */
export const cleanFirestoreData = <T extends Record<string, any>>(data: T): Partial<T> => {
  return Object.fromEntries(
    Object.entries(data).filter(([_, value]) => value !== undefined)
  ) as Partial<T>;
};

/**
 * Deep clean undefined values from nested objects and arrays
 * Recursively removes undefined values from nested structures
 */
export const deepCleanFirestoreData = <T>(obj: T): T => {
  if (Array.isArray(obj)) {
    return obj.map(item => deepCleanFirestoreData(item)) as T;
  }
  if (obj !== null && typeof obj === 'object') {
    return Object.fromEntries(
      Object.entries(obj)
        .filter(([_, value]) => value !== undefined)
        .map(([key, value]) => [key, deepCleanFirestoreData(value)])
    ) as T;
  }
  return obj;
};


