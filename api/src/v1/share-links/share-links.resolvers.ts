// api/src/v1/share-links/share-links.resolvers.ts
//
// #721 【設計】target_type ごとの「対象の検証」と「preview の生成」。
//
// 共有 URL の外形は全 target で共通（`/s/:token`）にするが、preview の作り方は
// target ごとに変える。dish_media は投稿固有のタイトルとサムネイルが要る（それが
// この Issue の主目的）。友達投票は locale の共通テンプレートで足りる。

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AppLoggerService } from '../../core/logger/logger.service';
import type { PublicLocale } from '@shared/v1/constants/publicLocales';
import {
  SHARE_LINK_MAX_DISH_MEDIA_IDS,
  type ShareLinkTargetType,
} from '@shared/v1/constants/shareLinks';
import {
  DISH_MEDIA_PREVIEW_TEXT,
  GROUP_VOTE_PREVIEW_TEXT,
  PREVIEW_DESCRIPTION_MAX_LENGTH,
  PREVIEW_TITLE_MAX_LENGTH,
  truncatePreviewText,
} from './share-links.preview-text';
// #1511 退会したユーザーの投稿は共有リンクの OGP からも出さない
import { NOT_AUTHORED_BY_DELETED_USER } from '../dish-media/deleted-user-filter';

/** Resolver が返す、DB へ保存する形 */
export type ResolvedShareTarget = {
  targetId: string;
  targetParams: Record<string, unknown>;
  previewTitle: string;
  previewDescription: string;
  /** GCS のパス。署名 URL ではない（失効するため） */
  previewImagePath: string;
};

/**
 * UUID の «形» だけを見る。`prisma.findUnique` へ渡す前に、UUID 列へ入りえない
 * 文字列を落とすのが目的（Postgres 側の型エラーを 500 ではなく 400 にする）。
 *
 * ⚠️ **バージョンを v4 に固定しないこと。** `dish_media.id` は
 * `gen_random_uuid()`（v4）だけでできているわけではなく、実データには v5 が
 * 混ざっている（dev で実測: `358cb297-da34-52b8-...`）。固定すると実在する
 * 投稿の共有が必ず 400 になる。DTO 側（`ShareTargetDishMediaParamsDto`）も
 * 同じ理由で `@IsUUID()` を版指定なしにしてある。
 */
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class ShareLinkTargetResolvers {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly logger: AppLoggerService,
  ) {}

  private get prisma() {
    return this.prismaService.prisma;
  }

  /**
   * target を検証し、保存すべき値を返す。
   *
   * @throws BadRequestException params の形が type に合っていない
   * @throws NotFoundException 対象が存在しない（他人の ID を総当たりしても
   *         「存在する / しない」以上の情報を返さないため、理由は詳細化しない）
   */
  async resolve(
    type: ShareLinkTargetType,
    params: Record<string, unknown>,
    locale: PublicLocale,
  ): Promise<ResolvedShareTarget> {
    switch (type) {
      case 'dish_media':
        return this.resolveDishMedia(params, locale);
      case 'dish_category_group_vote_sessions':
        return this.resolveGroupVote(params, locale);
    }
  }

  /* ------------------------------------------------------------------ */
  /*                             dish_media                             */
  /* ------------------------------------------------------------------ */

  /**
   * 投稿共有。既存の `/{locale}/posts?ids=a,b,c` と同じ集合を受ける。
   *
   * **先頭の ID が OGP の対象**になる。共有した本人が見ていた投稿が先頭に来るので、
   * 「共有カードに出る写真」と「開いて最初に見える投稿」が一致する。
   */
  private async resolveDishMedia(
    params: Record<string, unknown>,
    locale: PublicLocale,
  ): Promise<ResolvedShareTarget> {
    const rawIds = params.ids;
    if (!Array.isArray(rawIds) || rawIds.length === 0) {
      throw new BadRequestException('target.params.ids is required');
    }
    if (rawIds.length > SHARE_LINK_MAX_DISH_MEDIA_IDS) {
      throw new BadRequestException(
        `target.params.ids must contain at most ${SHARE_LINK_MAX_DISH_MEDIA_IDS} items`,
      );
    }
    const ids = rawIds.map(String);
    if (!ids.every((id) => UUID_SHAPE.test(id))) {
      throw new BadRequestException('target.params.ids must be UUIDs');
    }
    // 同じ ID を並べて上限を回避されないよう、重複は落としたうえで順序は保つ
    const uniqueIds = [...new Set(ids)];

    // #1513 論理削除済みの投稿は共有カードにも出さない。
    // #1511 退会したユーザーの投稿も同様に出さない。
    // 共有リンクは «詳細の入口» であり、ここを塞がないと SNS のプレビューにだけ
    // 消えたはずの投稿が残り続ける（アプリを開けば 404 なのに、カードだけ生きている状態）。
    // 複合条件を書くため `findUnique` ではなく `findFirst` を使う
    const head = await this.prisma.dish_media.findFirst({
      where: { id: uniqueIds[0], deleted_at: null, ...NOT_AUTHORED_BY_DELETED_USER },
      select: {
        id: true,
        thumbnail_path: true,
        dishes: {
          select: {
            name: true,
            category_id: true,
            restaurants: { select: { name: true } },
          },
        },
      },
    });

    if (!head) {
      // 「どの ID が無いか」は返さない。総当たりで存在判定させないため
      throw new NotFoundException('share target not found');
    }

    // 料理名は dishes.name が優先。無ければ料理カテゴリのローカライズ名へ落とす。
    // どちらも無ければ店舗名だけのカードにする（タイトルが空になる方が悪い）
    const localizedCategory = head.dishes.name
      ? null
      : await this.prisma.dish_category_localized_text.findUnique({
          where: {
            dish_category_id_locale: {
              dish_category_id: head.dishes.category_id,
              locale,
            },
          },
          select: { topic_title: true },
        });

    const restaurantName = head.dishes.restaurants.name;
    const dishName = head.dishes.name ?? localizedCategory?.topic_title ?? restaurantName;
    const text = DISH_MEDIA_PREVIEW_TEXT[locale];

    return {
      targetId: head.id,
      // 先頭 ID は target_id にあるので、params には «全 ID の並び» を持つ。
      // アプリは並びをそのまま `?ids=` へ渡すため、ここで順序を崩さない
      targetParams: { ids: uniqueIds },
      // #1194 件数を必ず渡すこと。まとめて共有したときに単品の共有に見えてしまう
      //（テンプレート側が count > 1 で文言を切り替える）
      previewTitle: truncatePreviewText(
        text.title({ dishName, restaurantName, count: uniqueIds.length }),
        PREVIEW_TITLE_MAX_LENGTH,
      ),
      previewDescription: truncatePreviewText(
        text.description({ dishName, restaurantName, count: uniqueIds.length }),
        PREVIEW_DESCRIPTION_MAX_LENGTH,
      ),
      previewImagePath: head.thumbnail_path,
    };
  }

  /* ------------------------------------------------------------------ */
  /*                 dish_category_group_vote_sessions                  */
  /* ------------------------------------------------------------------ */

  /**
   * 友達投票の共有。
   *
   * ⚠️ 受け取るのは **既存の `share_token`** であって session の UUID ではない。
   * 友達投票は #856 の時点で share_token を持ち、
   * `GET /v1/dish-category-group-votes/:shareToken` で解決できる。
   * 共有トークンを 2 系統作らず、`/s/:token` は OGP と入口の層に徹する。
   *
   * preview は locale の共通テンプレート。候補は投票中に増減するので、
   * 共有時点の候補名をタイトルへ焼き付けると「開いたら違う」状態になりやすい。
   */
  private async resolveGroupVote(
    params: Record<string, unknown>,
    locale: PublicLocale,
  ): Promise<ResolvedShareTarget> {
    const shareToken = params.shareToken;
    if (typeof shareToken !== 'string' || shareToken.length === 0) {
      throw new BadRequestException('target.params.shareToken is required');
    }

    const session = await this.prisma.dish_category_group_vote_sessions.findUnique({
      where: { share_token: shareToken },
      select: {
        id: true,
        dish_category_group_vote_candidates: {
          where: { deleted_at: null },
          orderBy: { display_order: 'asc' },
          take: 1,
          select: { image_url: true },
        },
      },
    });

    if (!session) {
      throw new NotFoundException('share target not found');
    }

    const text = GROUP_VOTE_PREVIEW_TEXT[locale];

    // 候補画像は Wikimedia 等の **外部の絶対 URL**（`dish_category_group_vote_candidates.image_url`）で、
    // GCS のパスではない。`preview_image_path` は 3 形式を許す（判定は share-image.ts に集約）。
    // 候補が 1 件も無い投票では、Web 側の既定 OG 画像（`/og/<locale>.jpg`）へ落とす。
    // ここを空文字にすると og:image 無しのカードになり、SNS では一番目立たない出方をする
    const firstCandidateImage =
      session.dish_category_group_vote_candidates[0]?.image_url ?? `/og/${locale}.jpg`;

    return {
      targetId: session.id,
      targetParams: { shareToken },
      previewTitle: truncatePreviewText(text.title, PREVIEW_TITLE_MAX_LENGTH),
      previewDescription: truncatePreviewText(text.description, PREVIEW_DESCRIPTION_MAX_LENGTH),
      previewImagePath: firstCandidateImage,
    };
  }
}
