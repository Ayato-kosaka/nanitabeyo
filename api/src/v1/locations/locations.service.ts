// api/src/v1/locations/locations.service.ts
//
// Service for locations operations

import { Injectable } from '@nestjs/common';

import { QueryAutocompleteLocationsDto } from '@shared/v1/dto';

import { ExternalApiService } from '../../core/external-api/external-api.service';
import { AppLoggerService } from '../../core/logger/logger.service';

@Injectable()
export class LocationsService {
  constructor(
    private readonly externalApi: ExternalApiService,
    private readonly logger: AppLoggerService,
  ) {}

  /* ------------------------------------------------------------------ */
  /*              GET /v1/locations/autocomplete                       */
  /* ------------------------------------------------------------------ */
  async autocompleteLocations(dto: QueryAutocompleteLocationsDto) {
    this.logger.debug('AutocompleteLocations', 'autocompleteLocations', {
      query: dto.q,
    });

    // Google Places Autocomplete API を呼び出し（地名のみ）
    const results = await this.externalApi.searchPlacesAutocomplete(dto.q);

    this.logger.log('AutocompleteLocationsCompleted', 'autocompleteLocations', {
      query: dto.q,
      resultsCount: results.length,
    });

    return results;
  }
}