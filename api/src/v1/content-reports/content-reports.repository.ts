// api/src/v1/content-reports/content-reports.repository.ts
//
// #1514 (SAF-01) 【設計】投稿・レビューの通報の永続化境界。
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
import { buildCursorFilter } from '../../core/pagination/composite-cursor';

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

/** 自分の通報履歴（#1584）の 1 行 */
export type MeContentReportRecord = {
  id: string;
  target_type: string;
  reason_code: string;
  created_at: Date;
};

/**
 * 履歴で返す列。
 *
 * ⚠️ **`status` / `resolved_at` / `resolution_note` を足さないこと。**
 * #1584 のオーナー確定仕様で、履歴に出すのは «いつ・どの理由で出したか» だけである。
 * 審査結果まで見せると、通報者は対象を知っているので «相手の投稿が消えたか» を
 * 推測でき、通報が相手への攻撃手段になる。select に足せばそのまま API へ漏れる。
 */
const ME_CONTENT_REPORT_SELECT = {
  id: true,
  target_type: true,
  reason_code: true,
  created_at: true,
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
   * 同一ユーザー × 同一対象（種別 + ID）の 2 件目は `uq_content_reports_reporter_target` により
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

  /**
   * #1584 自分が出した通報の履歴。**`reporterUserId` で必ず絞る。**
   *
   * この引数を呼び出し側の任意の値にしてはいけない（他人の通報が読めてしまう）。
   * Controller は `@CurrentUser()` の id だけを渡すこと。
   *
   * 並びは新しい順。同着（同一ミリ秒）が起きうるので id を第 2 キーに入れて安定させる。
   *
   * ⚠️ #1599 **並び順に id を足すだけでは足りない。** 以前はここが
   * `created_at < :cursor` の単一カーソルで、`orderBy` にだけ id が入っていた。
   * 並びは安定するが、**同時刻の行がページ境界をまたぐと丸ごと飛ぶ**のは直っていない
   * （次ページの起点が最終行の時刻そのものなので `<` が同時刻の行を全部落とす）。
   * カーソル側も `(created_at, id)` の複合にして初めて塞がる。
   */
  async findByReporter(
    reporterUserId: string,
    cursor: string | undefined,
    limit: number,
  ): Promise<MeContentReportRecord[]> {
    return this.prisma.content_reports.findMany({
      where: {
        reporter_user_id: reporterUserId,
        ...buildCursorFilter(cursor),
      },
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      take: limit,
      select: ME_CONTENT_REPORT_SELECT,
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
   *
   * 分岐は `CONTENT_REPORT_TARGET_TYPES` と 1 対 1 に保つこと。対象種別を増やして
   * ここを足し忘れると default 節の `never` 代入がコンパイルエラーになる。
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
      case 'dish_reviews': {
        const found = await this.prisma.dish_reviews.findUnique({
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
