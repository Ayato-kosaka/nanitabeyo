// api/src/v1/content-reports/content-reports.service.ts
//
// #1514 (SAF-01) 【設計】投稿・レビューの通報の受付。
//
// 対象種別ごとの分岐はここには無い。存在検証だけが対象テーブルを知っていればよく
// （Repository.existsTarget）、受付・重複・ログの規則は投稿とレビューで完全に同じである。

import { Injectable, NotFoundException } from '@nestjs/common';

import { CreateContentReportDto } from '@shared/v1/dto';
import type { CreateContentReportResponse } from '@shared/v1/res';
import type { ContentReportStatus } from '@shared/v1/constants/contentReports';

import { AppLoggerService } from '../../core/logger/logger.service';
import { ContentReportsRepository } from './content-reports.repository';

@Injectable()
export class ContentReportsService {
  constructor(
    private readonly repository: ContentReportsRepository,
    private readonly logger: AppLoggerService,
  ) {}

  /**
   * 通報を 1 件受け付ける。
   *
   * 手順は「対象の実在を確かめる → 保存 → 受付番号を返す」。
   *
   * ## 重複通報をエラーにしない理由
   * 同一ユーザー × 同一対象（種別 + ID）は DB の一意制約で 1 件に制限されている
   * （オーナー確定仕様。投稿とレビューで同じ規則）。
   * ここで 409 を返すと 2 つ困ることがある。
   *
   * 1. ユーザーには「通報したのに失敗した」としか見えない。実際には受理済みなのに、
   *    もう一度押させることになる
   * 2. 409 と 201 の差が **«自分がその対象を通報済みかどうか» の観測点**になる。
   *    通報の有無は本人にも積極的に見せる情報ではない
   *
   * そこで **既存の通報 ID をそのまま返す**（冪等）。UI は成功と同じ「受け付けました」を出す。
   *
   * ## 通報しても対象を非表示にしない
   * 通報を即時非表示に繋ぐと、通報爆撃がそのまま検閲の道具になる。運営が見るまで表示は変わらない。
   * このサービスは `dish_media` も `dish_reviews` も一切更新しない。
   *
   * @param dto 通報対象と理由
   * @param reporterUserId 通報者（匿名ユーザーも通報できる。JWT の uid をそのまま使う）
   */
  async create(
    dto: CreateContentReportDto,
    reporterUserId: string,
  ): Promise<CreateContentReportResponse> {
    // target_id に FK が無いので、DB は存在しない ID を弾かない。ここで確かめる
    const exists = await this.repository.existsTarget(
      dto.targetType,
      dto.targetId,
    );
    if (!exists) {
      this.logger.warn('ContentReportTargetNotFound', 'create', {
        targetType: dto.targetType,
        targetId: dto.targetId,
      });
      throw new NotFoundException('report target not found');
    }

    // 自由記述は空白だけの入力を保存しない（運営の画面で「本文あり」に見えてしまうため）
    const reasonText = dto.reasonText?.trim() ? dto.reasonText.trim() : null;

    try {
      const created = await this.repository.create({
        targetType: dto.targetType,
        targetId: dto.targetId,
        reporterUserId,
        reasonCode: dto.reasonCode,
        reasonText,
      });

      // ⚠️ **payload に reasonText を入れないこと。** 自由記述には第三者の個人情報が
      // 書かれうる。ログは運用者が横断検索する場所なので、理由コードまでに留める
      this.logger.log('ContentReportCreated', 'create', {
        reportId: created.id,
        targetType: dto.targetType,
        targetId: dto.targetId,
        reasonCode: dto.reasonCode,
        hasReasonText: reasonText !== null,
      });

      return {
        reportId: created.id,
        status: created.status as ContentReportStatus,
        alreadyReported: false,
      };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;

      // 一意制約に当たった = 同じユーザーが同じ対象を既に通報している。
      // 既存の受付番号を返して、呼び出し側から見て冪等にする
      const existing = await this.repository.findByReporterAndTarget(
        reporterUserId,
        dto.targetType,
        dto.targetId,
      );

      // 直前の INSERT が一意制約で落ちた以上、行は必ず在る。
      // 万一引けなければ（削除と競合したなど）握り潰さずに元の例外を投げる
      if (!existing) throw error;

      this.logger.log('ContentReportDuplicated', 'create', {
        reportId: existing.id,
        targetType: dto.targetType,
        targetId: dto.targetId,
      });

      return {
        reportId: existing.id,
        status: existing.status as ContentReportStatus,
        alreadyReported: true,
      };
    }
  }
}

/** Prisma の UNIQUE 制約違反（P2002）か */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'P2002'
  );
}
