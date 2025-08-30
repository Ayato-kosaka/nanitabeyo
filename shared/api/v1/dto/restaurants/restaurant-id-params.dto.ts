import { IsUUID } from "class-validator";

/** /v1/restaurants/:id 系のパスパラメータ */
export class RestaurantIdParamsDto {
	@IsUUID()
	id!: string;
}
