import { IsString } from "class-validator";

/** POST /v1/user-uploads/signed-url のボディ */
export class CreateUserUploadSignedUrlDto {
	@IsString()
	contentType!: string;

	@IsString()
	identifier!: string;
}
