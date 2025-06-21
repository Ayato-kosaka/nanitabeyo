import { Injectable } from '@nestjs/common';
import { nanoid } from 'nanoid';
import { env, logBackendEvent } from '../../lib';
import { GooglePlacesService } from './google-places.service';
import { CloudVisionService } from './cloud-vision.service';
import {
  DishMediaItem,
  ListDishMediaResponse,
  Review,
} from './interfaces/dish-media.types';
import { ListDishMediaQuery } from '../../../../shared/api/list-dish-media.dto';

/**
 * 🍽️ DishMedia を生成するサービス
 * - Google Places API を利用して料理写真と口コミを取得する
 */
@Injectable()
export class DishMediaService {
  constructor(
    private readonly gp: GooglePlacesService,
    private readonly vision: CloudVisionService,
  ) {}

  /**
   * listDishMedia API のメイン処理
   */
  async listDishMedia(params: ListDishMediaQuery): Promise<ListDishMediaResponse> {
    const requestId = nanoid(12);
    void logBackendEvent({
      event_name: 'listDishMediaCalled',
      error_level: 'INFO',
      function_name: 'DishMediaService.listDishMedia',
      user_id: 'anonymous',
      payload: params,
      request_id: requestId,
    });

    const { lat, lng, radius, limit, lang, category, pageToken } = params;

    // 🌐 まずは周辺店舗を検索
    const searchJson = await this.gp.nearbySearch({
      lat,
      lng,
      radius,
      lang,
      keyword: category,
      pageToken,
    });

    const items: DishMediaItem[] = [];
    for (const searchResult of searchJson.results.slice(0, limit)) {
      const detailsData = await this.gp.placeDetails(searchResult.place_id, lang);
      const details = detailsData.result;

      const dishKeyword = this.selectPopularDish(details.reviews ?? [], category);
      const photoUrl = await this.chooseDishPhoto(details);
      const reviews = this.extractDishReviews(details.reviews ?? [], dishKeyword);

      items.push({
        dishId: `dm_${details.place_id}_${nanoid(6)}`,
        dishName: dishKeyword ?? details.name,
        category: category ?? '',
        photoUrl,
        rating: details.rating ?? 0,
        reviewCount: details.user_ratings_total ?? 0,
        distanceMeters: searchResult.distance_meters ?? 0,
        place: {
          placeId: details.place_id,
          name: details.name,
          vicinity: details.vicinity,
          location: details.geometry.location,
          googleMapUrl: details.url,
        },
        reviews,
      });
    }

    return {
      items,
      nextPageToken: searchJson.next_page_token,
    };
  }

  /**
   * レビューから頻出する料理名を抽出する
   */
  private selectPopularDish(reviews: any[], fallback?: string): string | undefined {
    const keywords = [
      'ramen', 'ラーメン', 'sushi', '寿司', 'burger', 'バーガー',
      'pizza', 'ピザ', 'pasta', 'パスタ', 'curry', 'カレー',
      'udon', 'うどん', 'soba', 'そば', 'steak', 'ステーキ',
    ];
    if (fallback) keywords.unshift(fallback.toLowerCase());
    const counts = new Map<string, number>();
    for (const r of reviews) {
      const text = String(r.text ?? '').toLowerCase();
      for (const k of keywords) {
        if (text.includes(k)) counts.set(k, (counts.get(k) ?? 0) + 1);
      }
    }
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    return sorted.length > 0 ? sorted[0][0] : fallback;
  }

  /**
   * Cloud Vision API で料理写真を判定
   */
  private async chooseDishPhoto(details: any): Promise<string> {
    const refList = details.photos ?? [];
    for (const p of refList) {
      const url = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=600&photo_reference=${p.photo_reference}&key=${env.API_GOOGLE_PLACE_API_KEY}`;
      if (await this.vision.isFoodPhoto(url)) {
        return url;
      }
    }
    return '';
  }

  /**
   * 料理に言及した高評価レビューのみ抽出
   */
  private extractDishReviews(reviews: any[], dishKeyword?: string): Review[] {
    const keywords = ['おいしい', '美味しい', 'delicious', 'tasty'];
    if (dishKeyword) keywords.push(dishKeyword.toLowerCase());
    return reviews
      .filter((r: any) => r.rating >= 4 && r.text)
      .filter((r: any) => {
        const text = String(r.text).toLowerCase();
        return keywords.some((k) => text.includes(k));
      })
      .slice(0, 3)
      .map((r: any) => ({
        author: r.author_name,
        rating: r.rating,
        text: r.text,
        translated: Boolean(r.translated),
      }));
  }
}
