// api/src/share/share.controller.ts
//
// #721 【設計】共有リンクの SSR。`app.nanitabeyo.net/s/:token` から
// Firebase Hosting の rewrite でここへ来る（API ドメインはユーザーへ露出させない）。
//
// ■ 他の Controller と違う点（どちらも外すと壊れる）
// 1. `@Controller('s')` … `v1` を付けない。`RobotsController`（#276）と同じ扱いで
//    `/s/...` にそのまま生える。Firebase の rewrite が渡すパスと一致させる必要がある
// 2. `@SkipResponseWrap()` … 付けないと `ResponseWrapInterceptor` が HTML を
//    `{ success, data }` の JSON へ包んでしまい、OGP が 1 つも読めなくなる

import { Controller, Get, Header, HttpStatus, NotFoundException, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApiExcludeController } from '@nestjs/swagger';

import { SkipResponseWrap } from '../core/interceptors/response-wrap.interceptor';
import { AppLoggerService } from '../core/logger/logger.service';
import { StorageService } from '../core/storage/storage.service';
import { env } from '../core/config/env';
import { ShareLinksService } from '../v1/share-links/share-links.service';
import type { ShareLinkRecord } from '../v1/share-links/share-links.repository';
import { renderSharePage } from './share-page.html';
import { toDirectImageUrl } from './share-image';
import { SHARE_PAGE_LABELS, buildOpenInAppUrl, buildTargetWebPath } from './share-links.web-path';
import { resolvePublicLocale, toOgLocale } from '@shared/v1/constants/publicLocales';
import { SHARE_LINK_PATH_PREFIX, type ShareLinkTargetType } from '@shared/v1/constants/shareLinks';

/**
 * OGP 画像の署名 URL の有効期限。
 *
 * `/s/:token/og-image` は毎回発行し直すので短くてよい。SNS のクローラは 302 を
 * 追った直後に取りに来る。長くすると、リダイレクト先の URL が転載されたときに
 * 有効な期間が伸びてしまう。
 */
const OG_IMAGE_SIGNED_URL_TTL_SECONDS = 60 * 10;

@ApiExcludeController()
@Controller(SHARE_LINK_PATH_PREFIX)
export class ShareController {
  constructor(
    private readonly shareLinks: ShareLinksService,
    private readonly storage: StorageService,
    private readonly logger: AppLoggerService,
  ) {}

  /* ------------------------------------------------------------------ */
  /*                          GET /s/:token                             */
  /* ------------------------------------------------------------------ */

  /**
   * 共有カード用の HTML を返す。
   *
   * crawler と人間で内容を変えない。JS を実行しなくても OGP が読める。
   */
  @Get(':token')
  @SkipResponseWrap()
  @Header('Content-Type', 'text/html; charset=utf-8')
  // CDN には置くが、ブラウザには持たせない（revoke を最短で効かせるため）。
  // stale-while-revalidate があるので、オリジンが遅れてもカードは出続ける
  @Header('Cache-Control', 'public, max-age=0, s-maxage=300, stale-while-revalidate=86400')
  async getSharePage(@Param('token') token: string): Promise<string> {
    const record = await this.shareLinks.findActiveByToken(token);
    if (!record) {
      // 「形が不正」「存在しない」「revoked」「期限切れ」を区別せず 404。
      // 区別すると、総当たりで「存在はする token」を絞り込めてしまう
      throw new NotFoundException('share link not found');
    }

    const locale = resolvePublicLocale(record.preview_locale);
    const canonicalUrl = `${webBase()}/${SHARE_LINK_PATH_PREFIX}/${token}`;
    const targetWebUrl = `${webBase()}${buildTargetWebPath(
      record.target_type as ShareLinkTargetType,
      record.target_id,
      (record.target_params ?? {}) as Record<string, unknown>,
      locale,
    )}`;

    return renderSharePage({
      title: record.preview_title,
      description: record.preview_description,
      // og:image は **この URL 自身**（不変）。署名 URL を直接入れると SNS の
      // 再クロール時に失効していて画像が消える
      imageUrl: `${canonicalUrl}/og-image`,
      canonicalUrl,
      ogLocale: toOgLocale(locale),
      // iOS Safari は「同一サイト起点の Universal Link」を抑止するため、
      // アプリを開く導線は既存の OIA relay（別オリジン）を経由させる
      openInAppUrl: buildOpenInAppUrl(targetWebUrl),
      openInWebUrl: targetWebUrl,
      labels: SHARE_PAGE_LABELS[locale],
    });
  }

  /* ------------------------------------------------------------------ */
  /*                     GET /s/:token/og-image                         */
  /* ------------------------------------------------------------------ */

  /**
   * OGP 画像を返す（実体は 302）。
   *
   * ## なぜ間に 1 枚挟むのか
   * このアプリのメディアは署名付き URL でしか読めず、既定で 24 時間で失効する。
   * `og:image` に署名 URL を直接書くと、SNS がキャッシュ期限後に再クロールした
   * ときに 403 になり、**共有直後は出るのに後で画像だけ消える**という壊れ方をする。
   *
   * `og:image` を不変の URL にしておけば、SNS 側のキャッシュを壊さずに、
   * 中身だけ毎回署名し直せる。クローラは 302 を追う。
   */
  @Get(':token/og-image')
  @SkipResponseWrap()
  async getOgImage(@Param('token') token: string, @Res() res: Response): Promise<void> {
    const record = await this.shareLinks.findActiveByToken(token);
    if (!record) throw new NotFoundException('share link not found');

    const url = await this.resolveImageUrl(record);
    // 302（恒久ではない）。リダイレクト先は毎回変わるので 301 にしてはいけない
    res
      .status(HttpStatus.FOUND)
      .setHeader('Cache-Control', 'public, max-age=0, s-maxage=60')
      .redirect(HttpStatus.FOUND, url);
  }

  /**
   * `preview_image_path` を、実際に取得できる URL へ変換する。
   *
   * 署名が要るのは GCS オブジェクトのときだけ。判定は `share-image.ts` に集約している。
   */
  private async resolveImageUrl(record: ShareLinkRecord): Promise<string> {
    const direct = toDirectImageUrl(record.preview_image_path);
    if (direct) return direct;

    try {
      return await this.storage.generateSignedUrl(
        record.preview_image_path,
        OG_IMAGE_SIGNED_URL_TTL_SECONDS,
      );
    } catch (error) {
      // 署名に失敗しても共有カード自体は生かす。既定の OG 画像へ落とす
      this.logger.error('ShareLinkOgImageSignFailed', 'getOgImage', {
        shareLinkId: record.id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      const locale = resolvePublicLocale(record.preview_locale);
      return `${webBase()}/og/${locale}.jpg`;
    }
  }
}

/** 末尾スラッシュを落とした Web の配信元 */
function webBase(): string {
  return env.WEB_BASE_URL.replace(/\/+$/, '');
}
