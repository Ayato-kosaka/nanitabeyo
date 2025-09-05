// This is an example file showing how to use the user-uploads API
// following the existing pattern in nanitabeyo app.
// DO NOT import this file - it's for reference only.

import React, { useCallback, useState } from "react";
import { useAPICall } from "@/hooks/useAPICall";
import type { CreateUserUploadSignedUrlDto } from "@shared/api/v1/dto";
import type { CreateUserUploadSignedUrlResponse } from "@shared/api/v1/res";

/**
 * Example: Complete File Upload Flow
 * Use this pattern for any file upload functionality
 */
export function ExampleFileUpload() {
	const { callBackend } = useAPICall();
	const [isUploading, setIsUploading] = useState(false);
	const [uploadProgress, setUploadProgress] = useState<number>(0);
	const [uploadError, setUploadError] = useState<string | null>(null);

	const uploadFile = useCallback(
		async (file: Blob | File, contentType: string, identifier: string): Promise<string> => {
			setIsUploading(true);
			setUploadProgress(0);
			setUploadError(null);

			try {
				// Step 1: Get signed URL from our API
				const signedUrlResponse = await callBackend<
					CreateUserUploadSignedUrlDto,
					CreateUserUploadSignedUrlResponse
				>("v1/user-uploads/signed-url", {
					method: "POST",
					requestPayload: {
						contentType,
						identifier,
					},
				});

				// Step 2: Upload file directly to GCS using signed URL
				await new Promise<void>((resolve, reject) => {
					const xhr = new XMLHttpRequest();

					// Track upload progress
					xhr.upload.addEventListener("progress", (event) => {
						if (event.lengthComputable) {
							const progress = (event.loaded / event.total) * 100;
							setUploadProgress(progress);
						}
					});

					// Handle upload completion
					xhr.addEventListener("load", () => {
						if (xhr.status >= 200 && xhr.status < 300) {
							setUploadProgress(100);
							resolve();
						} else {
							reject(new Error(`Upload failed with status: ${xhr.status}`));
						}
					});

					// Handle network errors
					xhr.addEventListener("error", () => {
						reject(new Error("Network error during upload"));
					});

					// Start the upload
					xhr.open("PUT", signedUrlResponse.putUrl);
					xhr.setRequestHeader("Content-Type", contentType);
					xhr.send(file);
				});

				// Return the object path for further use
				return signedUrlResponse.objectPath;
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : "Upload failed";
				setUploadError(errorMessage);
				throw error;
			} finally {
				setIsUploading(false);
			}
		},
		[callBackend],
	);

	// Example usage in component
	const handleFileSelect = useCallback(
		async (file: File) => {
			try {
				const objectPath = await uploadFile(file, file.type, `user-photo-${Date.now()}`);
				console.log("File uploaded successfully:", objectPath);
				// Use objectPath to update user profile, dish media, etc.
			} catch (error) {
				console.error("Upload failed:", error);
			}
		},
		[uploadFile],
	);

	return {
		uploadFile,
		handleFileSelect,
		isUploading,
		uploadProgress,
		uploadError,
	};
}

/**
 * Example: Image Upload for Profile Photo
 */
export function ExampleProfilePhotoUpload() {
	const { uploadFile, isUploading, uploadProgress, uploadError } = ExampleFileUpload();

	const uploadProfilePhoto = useCallback(
		async (imageFile: File) => {
			try {
				const objectPath = await uploadFile(imageFile, imageFile.type, `profile-photo-${Date.now()}`);
				
				// After successful upload, you might want to:
				// 1. Update user profile with new photo URL
				// 2. Show success message to user
				// 3. Update UI to show new photo
				
				console.log("Profile photo uploaded:", objectPath);
				return objectPath;
			} catch (error) {
				console.error("Profile photo upload failed:", error);
				throw error;
			}
		},
		[uploadFile],
	);

	return {
		uploadProfilePhoto,
		isUploading,
		uploadProgress,
		uploadError,
	};
}

/**
 * Example: Dish Media Upload
 */
export function ExampleDishMediaUpload() {
	const { uploadFile, isUploading, uploadProgress, uploadError } = ExampleFileUpload();

	const uploadDishPhoto = useCallback(
		async (imageFile: File, dishId: string) => {
			try {
				const objectPath = await uploadFile(imageFile, imageFile.type, `dish-${dishId}-${Date.now()}`);
				
				// After successful upload, you might want to:
				// 1. Create dish media record via dish-media API
				// 2. Associate with dish and restaurant
				// 3. Update UI to show new dish photo
				
				console.log("Dish photo uploaded:", objectPath);
				return objectPath;
			} catch (error) {
				console.error("Dish photo upload failed:", error);
				throw error;
			}
		},
		[uploadFile],
	);

	return {
		uploadDishPhoto,
		isUploading,
		uploadProgress,
		uploadError,
	};
}

/**
 * Integration Tips:
 * 
 * 1. Always validate file type and size on frontend before upload
 * 2. Show upload progress to user for better UX
 * 3. Handle errors gracefully with user-friendly messages
 * 4. Use meaningful identifiers for file naming
 * 5. Consider compressing images before upload for better performance
 * 6. The objectPath returned can be used in other API calls
 * 7. For video uploads, consider showing preview during upload
 * 8. Implement retry logic for failed uploads if needed
 */