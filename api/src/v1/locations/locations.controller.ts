// api/src/v1/locations/locations.controller.ts
//
// Controller for locations endpoints

import {
  Controller,
  Get,
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { QueryAutocompleteLocationsDto } from '@shared/v1/dto';
import { AutocompleteLocationsResponse } from '@shared/v1/res';

// Auth
import { OptionalJwtAuthGuard } from '../../core/auth/auth.guard';

// Service
import { LocationsService } from './locations.service';

@ApiTags('Locations')
@Controller('v1/locations')
export class LocationsController {
  constructor(private readonly locationsService: LocationsService) {}

  /* ------------------------------------------------------------------ */
  /*                GET /v1/locations/autocomplete                     */
  /* ------------------------------------------------------------------ */
  @Get('autocomplete')
  @UseGuards(OptionalJwtAuthGuard)
  @UsePipes(new ValidationPipe({ transform: true }))
  @ApiOperation({ summary: 'Google Places API Autocomplete のラッパー（地名のみ）' })
  @ApiQuery({ name: 'q', required: true, description: '検索語' })
  @ApiResponse({ status: 200, description: '候補取得成功' })
  async autocompleteLocations(
    @Query() query: QueryAutocompleteLocationsDto,
  ): Promise<AutocompleteLocationsResponse> {
    return this.locationsService.autocompleteLocations(query);
  }
}