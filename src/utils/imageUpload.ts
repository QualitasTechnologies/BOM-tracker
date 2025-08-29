import { storage } from '@/firebase';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';

export interface ImageUploadResult {
  url: string;
  path: string;
}

export const uploadVendorLogo = async (
  file: File,
  vendorId?: string
): Promise<ImageUploadResult> => {
  // Validate file type
  if (!file.type.startsWith('image/')) {
    throw new Error('Please select a valid image file');
  }

  // Validate file size (max 2MB)
  const maxSizeInBytes = 2 * 1024 * 1024; // 2MB
  if (file.size > maxSizeInBytes) {
    throw new Error('Image size must be less than 2MB');
  }

  // Resize image if needed
  const resizedFile = await resizeImage(file, 200, 200);

  // Generate unique filename
  const timestamp = Date.now();
  const fileName = `${vendorId || 'temp'}_${timestamp}_${file.name}`;
  const imagePath = `vendor-logos/${fileName}`;

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

const resizeImage = (file: File, maxWidth: number, maxHeight: number): Promise<File> => {
  return new Promise((resolve) => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const img = new Image();

    img.onload = () => {
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
      ctx?.drawImage(img, 0, 0, width, height);

      // Convert back to file
      canvas.toBlob((blob) => {
        if (blob) {
          const resizedFile = new File([blob], file.name, {
            type: file.type,
            lastModified: Date.now(),
          });
          resolve(resizedFile);
        }
      }, file.type, 0.9); // 90% quality
    };

    img.src = URL.createObjectURL(file);
  });
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