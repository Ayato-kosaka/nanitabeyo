// api/src/v1/share-links/share-links.service.ts
//
// #721 【設計】共有リンクの作成と解決。

import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateShareLinkDto } from '@shared/v1/dto';
import type {
  CreateShareLinkResponse,
  ResolveShareLinkResponse,
} from '@shared/v1/res';
import {
  DEFAULT_PUBLIC_LOCALE,
  resolvePublicLocale,
  type PublicLocale,
} from '@shared/v1/constants/publicLocales';
import {
  SHARE_LINK_PATH_PREFIX,
  type ShareLinkTargetType,
} from '@shared/v1/constants/shareLinks';

import { AppLoggerService } from '../../core/logger/logger.service';
import { env } from '../../core/config/env';
import {
  ShareLinksRepository,
  type ShareLinkRecord,
} from './share-links.repository';
import { ShareLinkTargetResolvers } from './share-links.resolvers';
import {
  generateShareToken,
  isValidShareTokenShape,
  toShareTokenDigest,
} from './share-links.token';

/** token_digest の UNIQUE 衝突時に引き直す回数。128bit CSPRNG なので実際には 1 回目で通る */
const TOKEN_COLLISION_RETRIES = 3;

@Injectable()
export class ShareLinksService {
  constructor(
    private readonly repository: ShareLinksRepository,
    private readonly resolvers: ShareLinkTargetResolvers,
    private readonly logger: AppLoggerService,
  ) {}

  /* ------------------------------------------------------------------ */
  /*                              作成                                   */
  /* ------------------------------------------------------------------ */

  /**
   * 共有リンクを 1 本作る。
   *
   * 手順は「target を検証して preview を確定 → token を発行 → 保存」。
   * preview を作成時に確定させるのが要点で、`/s/:token` は毎回 1 行引くだけになる。
   *
   * @param dto 対象と言語
   * @param userId 作成者（匿名ユーザーも作成できるので、記録用としてのみ使う）
   */
  async create(
    dto: CreateShareLinkDto,
    userId: string | null,
  ): Promise<CreateShareLinkResponse> {
    // locale は「共有した時点の言語」で固定する。以後、閲覧者の言語では変えない。
    // 未指定・未知のロケールは既定へ寄せる（作成そのものを失敗させない）
    const locale: PublicLocale = dto.locale
      ? resolvePublicLocale(dto.locale)
      : DEFAULT_PUBLIC_LOCALE;

    const targetType = dto.target.type;
    const resolved = await this.resolvers.resolve(
      targetType,
      dto.target.params ?? {},
      locale,
    );

    for (let attempt = 0; attempt < TOKEN_COLLISION_RETRIES; attempt += 1) {
      const token = generateShareToken();
      try {
        const created = await this.repository.create({
          tokenDigest: toShareTokenDigest(token),
          targetType,
          targetId: resolved.targetId,
          targetParams: resolved.targetParams,
          previewLocale: locale,
          previewTitle: resolved.previewTitle,
          previewDescription: resolved.previewDescription,
          previewImagePath: resolved.previewImagePath,
          createdBy: userId,
        });

        this.logger.log('ShareLinkCreated', 'create', {
          shareLinkId: created.id,
          targetType,
          targetId: resolved.targetId,
          locale,
        });

        return { token, url: buildShareUrl(token), locale };
      } catch (error) {
        if (
          !isUniqueViolation(error) ||
          attempt === TOKEN_COLLISION_RETRIES - 1
        )
          throw error;
        // 128bit の衝突は現実には起きないが、起きたら 500 ではなく引き直す
        this.logger.warn('ShareLinkTokenCollision', 'create', { attempt });
      }
    }

    // ループは必ず return か throw で抜けるので到達しない
    throw new Error('unreachable');
  }

  /* ------------------------------------------------------------------ */
  /*                              解決                                   */
  /* ------------------------------------------------------------------ */

  /**
   * token から共有リンクを引く。無効なものは `null` を返す。
   *
   * ⚠️ 「形が不正」「存在しない」「revoked」「期限切れ」を **呼び出し側から区別させない**。
   * 区別できると、総当たりで「存在はする token」を絞り込めてしまう。
   * 調査に必要な区別はログにだけ残す。
   */
  async findActiveByToken(token: string): Promise<ShareLinkRecord | null> {
    if (!isValidShareTokenShape(token)) return null;

    const record = await this.repository.findByTokenDigest(
      toShareTokenDigest(token),
    );
    if (!record) return null;

    if (record.status !== 'active') {
      this.logger.log('ShareLinkInactive', 'findActiveByToken', {
        shareLinkId: record.id,
        status: record.status,
      });
      return null;
    }
    if (record.expires_at && record.expires_at.getTime() <= Date.now()) {
      this.logger.log('ShareLinkExpired', 'findActiveByToken', {
        shareLinkId: record.id,
      });
      return null;
    }
    return record;
  }

  /**
   * アプリ用の resolve。
   *
   * path を返さないのは、サーバが返した文字列をそのまま `router.push` させると、
   * サーバ側の不備がそのままアプリ内の任意遷移になるため。アプリは `target.type` を
   * allowlist した Router へ自分で変換する。
   */
  async resolveForApp(token: string): Promise<ResolveShareLinkResponse> {
    const record = await this.findActiveByToken(token);
    if (!record) throw new NotFoundException('share link not found');

    return {
      schemaVersion: record.schema_version,
      target: {
        type: record.target_type as ShareLinkTargetType,
        id: record.target_id,
        params: (record.target_params ?? {}) as Record<string, unknown>,
      },
    };
  }
}

/**
 * 共有 URL を組み立てる。
 *
 * ⚠️ **アプリ側で組み立て直さないこと。** 組み立てが 2 箇所にあると、development で
 * 共有したリンクが production ドメインを指す（またはその逆）という形でずれる。
 * `POST /v1/share-links` は完成した URL を返すので、クライアントはそれを使う。
 */
export function buildShareUrl(token: string): string {
  const base = env.WEB_BASE_URL.replace(/\/+$/, '');
  return `${base}/${SHARE_LINK_PATH_PREFIX}/${token}`;
}

/** Prisma の UNIQUE 制約違反（P2002）か */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'P2002'
  );
}
