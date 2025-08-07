// api/src/core/google-places/google-places.service.ts
//
// Google Places API サービス
//

import { Injectable } from '@nestjs/common';
import { env } from '../config/env';
import { AppLoggerService } from '../logger/logger.service';

interface GooglePlaceDetail {
  place_id: string;
  name: string;
  geometry: {
    location: {
      lat: number;
      lng: number;
    };
  };
  photos?: Array<{
    photo_reference: string;
  }>;
}

interface GooglePlacesDetailResponse {
  result: GooglePlaceDetail;
  status: string;
}

@Injectable()
export class GooglePlacesService {
  constructor(private readonly logger: AppLoggerService) {}

  /**
   * Google Place Details API を呼び出してレストラン情報を取得
   */
  async getPlaceDetail(placeId: string): Promise<GooglePlaceDetail | null> {
    this.logger.debug('GooglePlacesAPI', 'getPlaceDetail', {
      placeId,
    });

    const apiKey = env.GOOGLE_PLACE_API_KEY;
    const fields = 'place_id,name,geometry,photos';
    const endpoint = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=${fields}&key=${apiKey}`;

    try {
      const response = await fetch(endpoint);

      if (!response.ok) {
        throw new Error(`Google Places API request failed: ${response.status}`);
      }

      const data: GooglePlacesDetailResponse = await response.json();

      if (data.status !== 'OK') {
        this.logger.warn('GooglePlacesAPIStatus', 'getPlaceDetail', {
          status: data.status,
          placeId,
        });
        return null;
      }

      this.logger.debug('GooglePlacesAPISuccess', 'getPlaceDetail', {
        placeId,
        name: data.result.name,
      });

      return data.result;
    } catch (error) {
      this.logger.error('GooglePlacesAPIError', 'getPlaceDetail', {
        error_message: error instanceof Error ? error.message : 'Unknown error',
        placeId,
      });
      return null;
    }
  }

  /**
   * 座標を PostGIS geography 形式に変換
   */
  createLocationGeography(lat: number, lng: number): string {
    return `POINT(${lng} ${lat})`;
  }

  /**
   * Google Places の写真参照から画像URLを生成
   */
  getPhotoUrl(photoReference: string, maxWidth: number = 400): string {
    const apiKey = env.GOOGLE_PLACE_API_KEY;
    return `https://maps.googleapis.com/maps/api/place/photo?maxwidth=${maxWidth}&photoreference=${photoReference}&key=${apiKey}`;
  }
}
