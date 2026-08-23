// api/src/v1/content-reports/content-reports.repository.ts
//
// #1514 (SAF-01) 【設計】投稿の通報の永続化境界。
//
// このテーブルは RLS のポリシーを 1 つも持たない（= クライアントからは触れない）。
// 書き込み経路がここしかないことが、通報を «通報者が消せない証跡» にしている。
// Supabase クライアント直挿しの導線（app-expo/lib/reactions.ts のような形）を
// 通報に対して作らないこと。

import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';

import { PrismaService } from '../../prisma/prisma.service';
import { CLS_KEY_APP_VERSION } from '../../core/cls/cls.constants';
import type {
  ContentReportReasonCode,
  ContentReportTargetType,
} from '@shared/v1/constants/contentReports';

/** `content_reports` の 1 行のうち、この機能が使う列だけ */
export type ContentReportRecord = {
  id: string;
  status: string;
};

export type CreateContentReportInput = {
  targetType: ContentReportTargetType;
  targetId: string;
  reporterUserId: string;
  reasonCode: ContentReportReasonCode;
  reasonText: string | null;
};

/** 返す列は最小限に絞る。運営用の resolution_note 等を API 経路へ持ち出さないため */
const CONTENT_REPORT_SELECT = {
  id: true,
  status: true,
} as const;

@Injectable()
export class ContentReportsRepository {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly cls: ClsService,
  ) {}

  private get prisma() {
    return this.prismaService.prisma;
  }

  /**
   * 通報を 1 件作る。
   *
   * 同一ユーザー × 同一対象の 2 件目は `uq_content_reports_reporter_target` により
   * Prisma が P2002 を投げる。握りつぶさずそのまま投げ、Service 側で
   * 「既存の通報を返す」へ倒す（呼び出し側から見て冪等にするのは Service の責務）。
   */
  async create(input: CreateContentReportInput): Promise<ContentReportRecord> {
    const appVersion = this.cls.get<string>(CLS_KEY_APP_VERSION) ?? 'unknown';

    return this.prisma.content_reports.create({
      data: {
        target_type: input.targetType,
        target_id: input.targetId,
        reporter_user_id: input.reporterUserId,
        reason_code: input.reasonCode,
        reason_text: input.reasonText,
        created_version: appVersion,
      },
      select: CONTENT_REPORT_SELECT,
    });
  }

  /** 同じユーザーが同じ対象を既に通報しているか（重複時に受付番号を返し直すために引く） */
  async findByReporterAndTarget(
    reporterUserId: string,
    targetType: ContentReportTargetType,
    targetId: string,
  ): Promise<ContentReportRecord | null> {
    return this.prisma.content_reports.findUnique({
      where: {
        reporter_user_id_target_type_target_id: {
          reporter_user_id: reporterUserId,
          target_type: targetType,
          target_id: targetId,
        },
      },
      select: CONTENT_REPORT_SELECT,
    });
  }

  /**
   * 通報対象が実在するかを確かめる。
   *
   * ⚠️ **存在確認を省かないこと。** `target_id` には FK が無い（対象テーブルが
   * `target_type` で変わるため）ので、DB は存在しない ID を弾かない。
   * 省くと、存在しない UUID を投げ続けるだけで運営のキューを水増しできる。
   */
  async existsTarget(
    targetType: ContentReportTargetType,
    targetId: string,
  ): Promise<boolean> {
    switch (targetType) {
      case 'dish_media': {
        const found = await this.prisma.dish_media.findUnique({
          where: { id: targetId },
          select: { id: true },
        });
        return found !== null;
      }
      default: {
        // CONTENT_REPORT_TARGET_TYPES を増やしたのにここを足し忘れた場合、
        // TypeScript が never 代入でコンパイルエラーにする（黙って true を返さない）
        const exhaustive: never = targetType;
        return exhaustive;
      }
    }
  }
}
