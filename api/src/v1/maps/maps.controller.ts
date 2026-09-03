// api/src/v1/maps/maps.controller.ts
//
// #843 【設計】Google Places の呼び出し上限に当たったときのフォールバックを、
// 消費者向け Google Maps アプリへ飛ばすのではなく «アプリ内の地図» へ変えるための入口。
//
// - `https://www.google.com/maps/...`（消費者向け）は `x-frame-options: SAMEORIGIN` で
//   埋め込めない。埋め込めるのは Maps Embed API（`/maps/embed/v1/...`）だけ
// - Maps Embed API は無料・上限なしの SKU なので、Places の呼び出し回数を増やさずに使える
// - API キーはこの HTML の iframe src にしか入れない。クライアント（app-expo）には焼かない

import { Controller, Get, Header, Query, ServiceUnavailableException, UsePipes, ValidationPipe } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';

import { QueryMapsEmbedDto } from '@shared/v1/dto';

import { SkipResponseWrap } from '../../core/interceptors/response-wrap.interceptor';
import { env } from '../../core/config/env';
import { buildMapsEmbedSrc, renderMapsEmbedPage } from './maps-embed.html';

// クライアントには渡さない内部向けエンドポイントのため Swagger には出さない
// （robots.txt / share と同じ扱い）
@ApiExcludeController()
@Controller('v1/maps')
export class MapsController {
  /* ------------------------------------------------------------------ */
  /*                       GET /v1/maps/embed                           */
  /* ------------------------------------------------------------------ */

  /**
   * iframe 入りの HTML を返す。WebView（ネイティブ）/ iframe（web）がこの URL を
   * そのまま `uri` / `src` として読む（＝ API キーはネットワーク越しにここでしか出ない）。
   *
   * クエリの中身は同じ値なら常に同じ HTML を返すため、短時間のキャッシュを許可する。
   */
  @Get('embed')
  @SkipResponseWrap()
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=300')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  getEmbed(@Query() query: QueryMapsEmbedDto): string {
    // #843 オーナーが GCP で Maps Embed API を有効化し、キーを発行するまでは値が無い。
    // 未設定を «エラー» ではなく «この機能だけ使えない» として 503 で返し、
    // クライアント側は既存の外部ブラウザ遷移へ縮退する。
    if (!env.GOOGLE_MAPS_EMBED_API_KEY) {
      throw new ServiceUnavailableException('Google Maps Embed API key is not configured');
    }

    const src = buildMapsEmbedSrc({
      mode: query.mode,
      q: query.q,
      center: query.center,
      zoom: query.zoom,
      hl: query.hl,
      apiKey: env.GOOGLE_MAPS_EMBED_API_KEY,
    });
    return renderMapsEmbedPage(src);
  }
}
