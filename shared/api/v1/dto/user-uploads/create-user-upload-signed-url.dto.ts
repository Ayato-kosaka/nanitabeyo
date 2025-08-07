import { IsString } from "@nestjs/class-validator";

/** POST /v1/user-uploads/signed-url のボディ */
export class CreateUserUploadSignedUrlDto {
	@IsString()
	contentType!: string;

	@IsString()
	identifier!: string;
}
