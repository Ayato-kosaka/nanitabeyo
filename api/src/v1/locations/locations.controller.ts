// api/src/v1/locations/locations.controller.ts
//
// ❶ ルーティングは v1 プレフィクスを含め @Controller レベルで宣言
// ❷ DTO → ValidationPipe → Service 呼び出しという王道 3 段構え
// ❸ "認証必須 / 任意" を Guard で明確化
// ❹ Swagger / OpenAPI デコレータで自動ドキュメント化
//

import {
  Controller,
  Get,
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';

import { QueryAutocompleteLocationsDto } from '@shared/v1/dto';
import { AutocompleteLocationsResponse } from '@shared/v1/res';

// 横串 (Auth)
import { OptionalJwtAuthGuard } from '../../core/auth/auth.guard';

// ドメイン Service
import { LocationsService } from './locations.service';

@ApiTags('Locations')
@Controller('v1/locations')
export class LocationsController {
  constructor(private readonly locationsService: LocationsService) {}

  /* ------------------------------------------------------------------ */
  /*              GET /v1/locations/autocomplete (任意認証)             */
  /* ------------------------------------------------------------------ */
  @Get('autocomplete')
  @UseGuards(OptionalJwtAuthGuard)
  @UsePipes(new ValidationPipe({ transform: true }))
  @ApiOperation({
    summary: 'Google Places API Autocomplete のラッパー（地名のみ）',
  })
  @ApiQuery({
    name: 'q',
    required: true,
    description: '検索語',
  })
  @ApiResponse({ status: 200, description: '候補リスト取得成功' })
  async autocompleteLocations(
    @Query() query: QueryAutocompleteLocationsDto,
  ): Promise<AutocompleteLocationsResponse> {
    return this.locationsService.autocompleteLocations(query.q);
  }
}
