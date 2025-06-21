import { Controller, Get, Query, BadRequestException } from '@nestjs/common';
import { DishMediaService } from './dish-media.service';
import {
  listDishMediaQuerySchema,
  ListDishMediaQuery,
} from './dto/list-dish-media.dto';

@Controller({ path: 'dish-media', version: '1' })
export class DishMediaController {
  constructor(private readonly dishMediaService: DishMediaService) {}

  @Get()
  /**
   * listDishMedia エンドポイント
   * 必須パラメータの検証後、サービス層へ委譲する
   */
  async listDishMedia(@Query() query: Record<string, any>) {
    const parsed = listDishMediaQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten().fieldErrors);
    }
    return this.dishMediaService.listDishMedia(parsed.data);
  }
}
