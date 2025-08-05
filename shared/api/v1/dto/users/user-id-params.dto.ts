import { IsUUID } from "@nestjs/class-validator";

/** /v1/users/:id 系のパスパラメータ */
export class UserIdParamsDto {
        @IsUUID()
        id!: string;
}
