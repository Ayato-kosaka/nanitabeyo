// api/src/core/utils/static-master.service.ts
//

import { Injectable } from '@nestjs/common';
import { Database } from '../../../../shared/supabase/database.types';
import { TableRow } from '../../../../shared/utils/devDB.types';
import { loadStaticMaster } from '../../../../shared/utils/loadStaticMaster';
import { env } from '../config/env';

@Injectable()
export class StaticMasterService {
  constructor() {}

  /** ───────── キャッシュ領域 ───────── */
  private cache: Partial<
    Record<keyof Database['dev']['Tables'], TableRow<any>[]>
  > = {};

  private lastFetchedAt: Partial<
    Record<keyof Database['dev']['Tables'], number>
  > = {};

  private readonly CACHE_TTL_MS = 5 * 60 * 1_000; // 5 min

  /**
   * 🗂️ 静的マスタデータを取得するユーティリティ関数。
   *
   * - 一定時間キャッシュを保持し、再取得の頻度を抑える
   * - 最終取得から `CACHE_DURATION_MS` を超過した場合は再取得
   *
   * @param tableName - 対象となるマスタテーブル名（Supabase dev スキーマ）
   * @returns 該当マスタのレコード配列
   */
  async getStaticMaster<T extends keyof Database['dev']['Tables']>(
    tableName: T,
  ): Promise<TableRow<T>[]> {
    const now = Date.now();
    const last = this.lastFetchedAt[tableName] ?? 0;
    const expired = now - last > this.CACHE_TTL_MS;

    if (!this.cache[tableName] || expired) {
      this.cache[tableName] = await loadStaticMaster(
        env.GCS_BUCKET_NAME,
        env.GCS_STATIC_MASTER_DIR_PATH,
        tableName,
      );
      this.lastFetchedAt[tableName] = now;
    }

    return this.cache[tableName] as TableRow<T>[];
  }
}
