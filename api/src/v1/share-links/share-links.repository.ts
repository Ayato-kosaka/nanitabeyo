// api/src/v1/share-links/share-links.repository.ts
//
// #721 【設計】共有リンクの永続化境界。
//
// ここは「token_digest から 1 行引く」ことに最適化する。`/s/:token` は SNS の
// クローラが叩く経路なので、共有 1 回ごとに dish_media / dishes / restaurants を
// JOIN し直すのは避け、preview は作成時に snapshot 済みのものを読むだけにする。

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { ShareLinkTargetType } from '@shared/v1/constants/shareLinks';

/** `share_links` の 1 行のうち、この機能が使う列だけ */
export type ShareLinkRecord = {
  id: string;
  schema_version: number;
  target_type: string;
  target_id: string;
  target_params: unknown;
  preview_locale: string;
  preview_title: string;
  preview_description: string;
  preview_image_path: string;
  status: string;
  expires_at: Date | null;
};

export type CreateShareLinkRecordInput = {
  tokenDigest: Buffer;
  targetType: ShareLinkTargetType;
  targetId: string;
  targetParams: Record<string, unknown>;
  previewLocale: string;
  previewTitle: string;
  previewDescription: string;
  previewImagePath: string;
  createdBy: string | null;
};

/** `/s/:token` の描画に必要な列だけを選ぶ（payload 相当の重い列を引かないため明示する） */
const SHARE_LINK_SELECT = {
  id: true,
  schema_version: true,
  target_type: true,
  target_id: true,
  target_params: true,
  preview_locale: true,
  preview_title: true,
  preview_description: true,
  preview_image_path: true,
  status: true,
  expires_at: true,
} as const;

@Injectable()
export class ShareLinksRepository {
  constructor(private readonly prismaService: PrismaService) {}

  private get prisma() {
    return this.prismaService.prisma;
  }

  /**
   * 共有リンクを 1 件作る。
   *
   * token_digest は UNIQUE なので、万一衝突したら Prisma が P2002 を投げる。
   * 呼び出し側（Service）で再試行する。128bit の CSPRNG で衝突は現実には起きないが、
   * 「起きたら 500 を返す」より「起きたら引き直す」方が正しい。
   */
  async create(input: CreateShareLinkRecordInput): Promise<{ id: string }> {
    const created = await this.prisma.share_links.create({
      data: {
        token_digest: input.tokenDigest,
        target_type: input.targetType,
        target_id: input.targetId,
        target_params: input.targetParams as never,
        preview_locale: input.previewLocale,
        preview_title: input.previewTitle,
        preview_description: input.previewDescription,
        preview_image_path: input.previewImagePath,
        created_by: input.createdBy,
      },
      select: { id: true },
    });
    return created;
  }

  /**
   * digest から共有リンクを引く。
   *
   * ⚠️ status / expires_at をここで絞り込まないこと。「無効」と「そもそも無い」を
   * 呼び出し側で区別できなくなり、revoke 済みリンクのログが「存在しない token」に
   * 化けて調査できなくなる。判定は Service で行う。
   */
  async findByTokenDigest(tokenDigest: Buffer): Promise<ShareLinkRecord | null> {
    return this.prisma.share_links.findUnique({
      where: { token_digest: tokenDigest },
      select: SHARE_LINK_SELECT,
    }) as Promise<ShareLinkRecord | null>;
  }
}
