/** POST /v1/user-uploads/signed-url のレスポンス型 */
export type CreateUserUploadSignedUrlResponse = {
        putUrl: string;
        objectPath: string;
        expiresAt: string;
};
