// api/src/v1/restaurant-reports/restaurant-reports.service.ts
//
// #1933 【設計】店舗情報の «この情報が違う» 報告の受付。
//
// 受け入れ条件（#1933）のうち、このクラスが持つのは 5・6・10 である。
//   5. 画面上は «受け付けました» だけ。店の情報はその場では変わらない
//   6. 報告は `restaurant_reports` に `pending` として残る
//  10. 同じユーザーが同じ店の同じ項目を二重に報告できない
//
// 7〜9（1 報告 = 1 Issue → オーナーが反映 / 却下 → 書き戻し）はこのクラスの外である。
// ⚠️ **ここから GitHub へ起票しない。** 受付の応答時間が外部サービスの生死に縛られ、
// 起票に失敗したときに «報告は消えたのか» が分からなくなる。起票は
// `status = 'pending'` の行を後から拾う側の責務にする（索引
// `idx_restaurant_reports_status_created` はそのために張ってある）。

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import { CreateRestaurantReportDto } from '@shared/v1/dto';
import type { CreateRestaurantReportResponse } from '@shared/v1/res';
import {
  RESTAURANT_REPORT_FIELDS_WITHOUT_VALUE,
  type RestaurantReportStatus,
} from '@shared/v1/constants/restaurantReports';

import { AppLoggerService } from '../../core/logger/logger.service';
import { RestaurantReportsRepository } from './restaurant-reports.repository';

@Injectable()
export class RestaurantReportsService {
  constructor(
    private readonly repository: RestaurantReportsRepository,
    private readonly logger: AppLoggerService,
  ) {}

  /**
   * 報告を 1 件受け付ける。
   *
   * 手順は「店の実在を確かめる → 値を正規化する → 保存 → 受付番号を返す」。
   *
   * ## 二重報告をエラーにしない理由
   * 同一ユーザー × 同一店 × 同一項目は DB の一意制約で 1 件に制限されている
   * （受け入れ条件 10）。ここで 409 を返すと 2 つ困ることがある。
   *
   * 1. ユーザーには「送ったのに失敗した」としか見えない。実際には受理済みなのに
   *    もう一度押させることになる
   * 2. 制約は `pending` だけの部分索引では**ない**ので、409 は
   *    «その報告が却下されている» ことまで観測させてしまう
   *
   * そこで **既存の報告 ID をそのまま返す**（冪等）。UI は成功と同じ「受け付けました」を出す。
   *
   * ## 報告しても店の情報を変えない
   * 受け入れ条件 5。誤報・荒らしがそのまま本番へ乗らないための規則で、
   * OSM / Google / 食べログの 3 例に共通していた（#1827 の調査）。
   * このサービスは `restaurants` を一切更新しない。
   *
   * @param dto 報告対象と内容
   * @param reporterUserId 報告者（匿名ユーザーも報告できる。JWT の uid をそのまま使う）
   */
  async create(
    dto: CreateRestaurantReportDto,
    reporterUserId: string,
  ): Promise<CreateRestaurantReportResponse> {
    // FK があるので DB も弾くが、そのままでは P2003 が 500 になる。
    // 存在しない店は «サーバーの障害» ではなく «要求が間違っている»
    const exists = await this.repository.existsRestaurant(dto.restaurantId);
    if (!exists) {
      this.logger.warn('RestaurantReportTargetNotFound', 'create', {
        restaurantId: dto.restaurantId,
        field: dto.field,
      });
      throw new NotFoundException('report target not found');
    }

    const proposedValue = normalizeProposedValue(dto.field, dto.proposedValue);

    try {
      const created = await this.repository.create({
        restaurantId: dto.restaurantId,
        reporterUserId,
        field: dto.field,
        proposedValue,
      });

      // ⚠️ **payload に proposedValue を入れないこと。** ユーザーの自由入力には
      // 第三者の個人情報が書かれうる。ログは運用者が横断検索する場所なので、
      // «値が入っていたか» までに留める（`content_reports` と同じ規則）
      this.logger.log('RestaurantReportCreated', 'create', {
        reportId: created.id,
        restaurantId: dto.restaurantId,
        field: dto.field,
        hasProposedValue: proposedValue !== null,
      });

      return {
        reportId: created.id,
        status: created.status as RestaurantReportStatus,
        alreadyReported: false,
      };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;

      // 一意制約に当たった = 同じユーザーが同じ店の同じ項目を既に報告している
      const existing = await this.repository.findByReporterAndTarget(
        reporterUserId,
        dto.restaurantId,
        dto.field,
      );

      // 直前の INSERT が一意制約で落ちた以上、行は必ず在る。
      // 万一引けなければ（店の削除と競合したなど）握り潰さずに元の例外を投げる
      if (!existing) throw error;

      this.logger.log('RestaurantReportDuplicated', 'create', {
        reportId: existing.id,
        restaurantId: dto.restaurantId,
        field: dto.field,
      });

      return {
        reportId: existing.id,
        status: existing.status as RestaurantReportStatus,
        alreadyReported: true,
      };
    }
  }
}

/**
 * «正しい値» を保存する形へ揃える。
 *
 * ⚠️ **どの項目が値を伴わないかを、ここで列挙しないこと。**
 * 正は `RESTAURANT_REPORT_FIELDS_WITHOUT_VALUE`（shared）で、DB の
 * `proposed_value IS NULL` 許容と 1 対 1 に対応している。ここへ書き写すと、
 * 項目を増やしたときに片方だけが直って**テストは緑のまま古い挙動を守る**。
 *
 * - 値を伴わない項目（`closed`）… 送られてきても **捨てて NULL にする**。
 *   «閉店した» に値は無いので、入っていても判定に使えない
 * - 値を伴う項目 … 空白だけの入力を受け付けない。保存すると、オーナーの画面で
 *   «値あり» に見えるのに中身が無い行になり、1 件ずつ見る運用が回らない
 */
function normalizeProposedValue(
  field: CreateRestaurantReportDto['field'],
  raw: string | undefined,
): string | null {
  if (RESTAURANT_REPORT_FIELDS_WITHOUT_VALUE.includes(field)) return null;

  const trimmed = raw?.trim();
  if (!trimmed) {
    throw new BadRequestException('proposedValue is required for this field');
  }
  return trimmed;
}

/** Prisma の UNIQUE 制約違反（P2002）か */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'P2002'
  );
}
