import { db, storage } from "@/firebase";
import {
  collection,
  addDoc,
  doc,
  getDocs,
  onSnapshot,
  updateDoc,
  deleteDoc,
  getDoc,
  query,
  where,
  Unsubscribe,
} from "firebase/firestore";
import { ref, deleteObject } from "firebase/storage";
import { Brand, BrandInput } from "@/types/brand";

// Brand Collection Reference
const brandsCol = collection(db, "brands");

/**
 * Remove undefined values from an object to prevent Firestore errors
 */
const cleanFirestoreData = <T extends Record<string, any>>(data: T): Partial<T> => {
  return Object.fromEntries(
    Object.entries(data).filter(([_, value]) => value !== undefined)
  ) as Partial<T>;
};

/**
 * Add a new brand to Firestore
 */
export const addBrand = async (brand: BrandInput): Promise<string> => {
  const now = new Date();
  const brandData = cleanFirestoreData({
    ...brand,
    createdAt: now,
    updatedAt: now,
  });
  const docRef = await addDoc(brandsCol, brandData);
  return docRef.id;
};

/**
 * Get all brands from Firestore
 */
export const getBrands = async (): Promise<Brand[]> => {
  const snapshot = await getDocs(brandsCol);
  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  })) as Brand[];
};

/**
 * Get active brands only (filtered at database level)
 */
export const getActiveBrands = async (): Promise<Brand[]> => {
  const activeQuery = query(brandsCol, where("status", "==", "active"));
  const snapshot = await getDocs(activeQuery);
  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  })) as Brand[];
};

/**
 * Get a single brand by ID
 */
export const getBrand = async (brandId: string): Promise<Brand | null> => {
  const brandRef = doc(brandsCol, brandId);
  const brandSnap = await getDoc(brandRef);
  if (brandSnap.exists()) {
    return {
      id: brandSnap.id,
      ...brandSnap.data(),
    } as Brand;
  }
  return null;
};

/**
 * Subscribe to real-time brand updates
 */
export const subscribeToBrands = (
  callback: (brands: Brand[]) => void
): Unsubscribe => {
  return onSnapshot(brandsCol, (snapshot) => {
    const brands: Brand[] = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    })) as Brand[];
    callback(brands);
  });
};

/**
 * Update a brand (filters out undefined values to prevent Firestore errors)
 */
export const updateBrand = async (
  brandId: string,
  updates: Partial<Omit<Brand, "id" | "createdAt">>
): Promise<void> => {
  const brandRef = doc(brandsCol, brandId);

  // Filter out undefined values - Firestore doesn't accept undefined
  const cleanedUpdates = cleanFirestoreData({
    ...updates,
    updatedAt: new Date(),
  });

  await updateDoc(brandRef, cleanedUpdates);
};

/**
 * Delete a brand and its logo from storage
 */
export const deleteBrand = async (brandId: string): Promise<void> => {
  // Get the brand to check for logo
  const brand = await getBrand(brandId);

  // Delete logo from storage if exists
  if (brand?.logoPath) {
    try {
      const logoRef = ref(storage, brand.logoPath);
      await deleteObject(logoRef);
    } catch (error) {
      console.error("Error deleting brand logo:", error);
      // Continue with brand deletion even if logo deletion fails
    }
  }

  // Delete the brand document
  await deleteDoc(doc(brandsCol, brandId));
};

/**
 * Validate brand data
 */
export const validateBrand = (brand: Partial<BrandInput>): string[] => {
  const errors: string[] = [];

  if (!brand.name?.trim()) {
    errors.push("Brand name is required");
  }

  if (brand.website && !isValidUrl(brand.website)) {
    errors.push("Invalid website URL format");
  }

  return errors;
};

/**
 * Check if a brand name already exists
 * Note: Firestore doesn't support case-insensitive queries natively,
 * so we fetch all and filter in-memory. For production optimization,
 * consider adding a 'nameLower' field indexed in Firestore.
 */
export const brandNameExists = async (
  name: string,
  excludeId?: string
): Promise<boolean> => {
  const snapshot = await getDocs(brandsCol);
  return snapshot.docs.some((doc) => {
    const brand = doc.data() as Brand;
    return (
      brand.name.toLowerCase() === name.toLowerCase() &&
      doc.id !== excludeId
    );
  });
};

// Helper function
const isValidUrl = (url: string): boolean => {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
};

// Export collection reference
export { brandsCol };
