// api/src/v1/restaurant-reports/restaurant-reports.repository.ts
//
// #1933 【設計】店舗情報の «この情報が違う» 報告の永続化境界。
//
// このテーブルは RLS のポリシーを 1 つも持たない（= クライアントからは触れない）。
// 書き込み経路がここしかないことが、報告を «報告者が消せない証跡» にしている。
// Supabase クライアント直挿しの導線（app-expo/lib/reactions.ts のような形）を
// 報告に対して作らないこと。

import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';

import { PrismaService } from '../../prisma/prisma.service';
import { CLS_KEY_APP_VERSION } from '../../core/cls/cls.constants';
import type { RestaurantReportField } from '@shared/v1/constants/restaurantReports';

/** `restaurant_reports` の 1 行のうち、この機能が使う列だけ */
export type RestaurantReportRecord = {
  id: string;
  status: string;
};

export type CreateRestaurantReportInput = {
  restaurantId: string;
  reporterUserId: string;
  field: RestaurantReportField;
  proposedValue: string | null;
};

/**
 * 返す列は最小限に絞る。
 *
 * ⚠️ **`resolution_note` / `github_issue_number` を足さないこと。**
 * どちらもオーナーの運用側の情報で、報告者へ返す理由が無い。
 * select に足せばそのまま API へ漏れる（`content_reports` と同じ規則）。
 */
const RESTAURANT_REPORT_SELECT = {
  id: true,
  status: true,
} as const;

@Injectable()
export class RestaurantReportsRepository {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly cls: ClsService,
  ) {}

  private get prisma() {
    return this.prismaService.prisma;
  }

  /**
   * 報告を 1 件作る。
   *
   * 同一ユーザー × 同一店 × 同一項目の 2 件目は `uq_restaurant_reports_reporter_target`
   * により Prisma が P2002 を投げる。握りつぶさずそのまま投げ、Service 側で
   * 「既存の報告を返す」へ倒す（呼び出し側から見て冪等にするのは Service の責務）。
   */
  async create(
    input: CreateRestaurantReportInput,
  ): Promise<RestaurantReportRecord> {
    const appVersion = this.cls.get<string>(CLS_KEY_APP_VERSION) ?? 'unknown';

    return this.prisma.restaurant_reports.create({
      data: {
        restaurant_id: input.restaurantId,
        reporter_user_id: input.reporterUserId,
        field: input.field,
        proposed_value: input.proposedValue,
        created_version: appVersion,
      },
      select: RESTAURANT_REPORT_SELECT,
    });
  }

  /** 同じユーザーが同じ店の同じ項目を既に報告しているか（重複時に受付番号を返し直すために引く） */
  async findByReporterAndTarget(
    reporterUserId: string,
    restaurantId: string,
    field: RestaurantReportField,
  ): Promise<RestaurantReportRecord | null> {
    return this.prisma.restaurant_reports.findUnique({
      where: {
        reporter_user_id_restaurant_id_field: {
          reporter_user_id: reporterUserId,
          restaurant_id: restaurantId,
          field,
        },
      },
      select: RESTAURANT_REPORT_SELECT,
    });
  }

  /**
   * 報告対象の店が実在するかを確かめる。
   *
   * ⚠️ FK があるので DB も弾くが、そのままでは **P2003 が 500 になる**。
   * 存在しない店は «サーバーの障害» ではなく «要求が間違っている» ので 404 で返す。
   */
  async existsRestaurant(restaurantId: string): Promise<boolean> {
    const found = await this.prisma.restaurants.findUnique({
      where: { id: restaurantId },
      select: { id: true },
    });
    return found !== null;
  }
}
