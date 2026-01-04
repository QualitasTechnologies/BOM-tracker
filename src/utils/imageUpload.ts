import { storage } from '@/firebase';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';

export interface ImageUploadResult {
  url: string;
  path: string;
}

/**
 * Common image upload logic
 */
const uploadImageToStorage = async (
  file: File,
  folderPath: string,
  fileName: string,
  maxSizeInBytes: number = 2 * 1024 * 1024, // 2MB default
  resizeWidth: number = 200,
  resizeHeight: number = 200
): Promise<ImageUploadResult> => {
  // Validate file type
  if (!file.type.startsWith('image/')) {
    throw new Error('Please select a valid image file');
  }

  // Validate file size
  if (file.size > maxSizeInBytes) {
    throw new Error(`Image size must be less than ${Math.round(maxSizeInBytes / (1024 * 1024))}MB`);
  }

  // Resize image if needed
  const resizedFile = await resizeImage(file, resizeWidth, resizeHeight);

  const imagePath = `${folderPath}/${fileName}`;

  try {
    // Upload to Firebase Storage
    const imageRef = ref(storage, imagePath);
    const snapshot = await uploadBytes(imageRef, resizedFile);
    
    // Get download URL
    const downloadURL = await getDownloadURL(snapshot.ref);
    
    return {
      url: downloadURL,
      path: imagePath
    };
  } catch (error) {
    console.error('Error uploading image:', error);
    throw new Error('Failed to upload image. Please try again.');
  }
};

export const uploadVendorLogo = async (
  file: File,
  vendorId?: string
): Promise<ImageUploadResult> => {
  const timestamp = Date.now();
  const fileName = `${vendorId || 'temp'}_${timestamp}_${file.name}`;
  return uploadImageToStorage(file, 'vendor-logos', fileName, 2 * 1024 * 1024, 200, 200);
};

const resizeImage = (file: File, maxWidth: number, maxHeight: number): Promise<File> => {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    
    if (!ctx) {
      reject(new Error('Failed to get canvas context'));
      return;
    }

    const img = new Image();
    let objectUrl: string | null = null;

    img.onerror = () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      reject(new Error('Failed to load image'));
    };

    img.onload = () => {
      try {
        // Calculate new dimensions maintaining aspect ratio
        let { width, height } = img;
        
        if (width > height) {
          if (width > maxWidth) {
            height = (height * maxWidth) / width;
            width = maxWidth;
          }
        } else {
          if (height > maxHeight) {
            width = (width * maxHeight) / height;
            height = maxHeight;
          }
        }

        canvas.width = width;
        canvas.height = height;

        // Draw and resize image
        ctx.drawImage(img, 0, 0, width, height);

        // Convert back to file
        canvas.toBlob((blob) => {
          // Clean up object URL
          if (objectUrl) URL.revokeObjectURL(objectUrl);
          
          if (blob) {
            const resizedFile = new File([blob], file.name, {
              type: file.type,
              lastModified: Date.now(),
            });
            resolve(resizedFile);
          } else {
            reject(new Error('Failed to create resized image'));
          }
        }, file.type, 0.9); // 90% quality
      } catch (error) {
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        reject(error instanceof Error ? error : new Error('Failed to resize image'));
      }
    };

    objectUrl = URL.createObjectURL(file);
    img.src = objectUrl;
  });
};

export const uploadBrandLogo = async (
  file: File,
  brandId?: string
): Promise<ImageUploadResult> => {
  const timestamp = Date.now();
  const fileName = `${brandId || 'temp'}_${timestamp}_${file.name}`;
  return uploadImageToStorage(file, 'brand-logos', fileName, 2 * 1024 * 1024, 200, 200);
};

export const uploadClientLogo = async (
  file: File,
  clientId?: string
): Promise<ImageUploadResult> => {
  const timestamp = Date.now();
  const fileName = `${clientId || 'temp'}_${timestamp}_${file.name}`;
  return uploadImageToStorage(file, 'client-logos', fileName, 2 * 1024 * 1024, 200, 200);
};

export const uploadCompanyLogo = async (
  file: File
): Promise<ImageUploadResult> => {
  const timestamp = Date.now();
  const fileName = `company_${timestamp}_${file.name}`;
  // Company logos use larger size (300x300) for better quality in documents
  return uploadImageToStorage(file, 'company-logos', fileName, 2 * 1024 * 1024, 300, 300);
};

export const deleteVendorLogo = async (logoPath: string): Promise<void> => {
  try {
    const imageRef = ref(storage, logoPath);
    // Note: deleteObject would be used here, but we'll keep images for now
    // await deleteObject(imageRef);
  } catch (error) {
    console.error('Error deleting image:', error);
    // Don't throw error for image deletion failures
  }
};