// api/src/core/utils/static-master.service.ts
//

import { Inject, Injectable } from '@nestjs/common';
import { Bucket, Storage } from '@google-cloud/storage';
import { Database } from '../../../../shared/supabase/database.types';
import { TableRow } from '../../../../shared/utils/devDB.types';
import { loadStaticMaster } from '../../../../shared/utils/loadStaticMaster';
import { env } from '../config/env';
import { STATIC_MASTER_CLIENT } from './static-master.constants';

@Injectable()
export class StaticMasterService {
  /** GCS バケットハンドル（ctor で安全に初期化） */
  private readonly bucket: Bucket;

  constructor(
    @Inject(STATIC_MASTER_CLIENT) private readonly storage: Storage,
  ) {
    this.bucket = this.storage.bucket(env.GCS_BUCKET_PUBLIC_NAME);
  }

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

  /**
   * 静的マスターを読み込む
   *
   * @param dirPath - ディレクトリパス
   * @param tableName - テーブル名
   * @returns テーブルのデータ
   */
  private async loadStaticMaster<T extends keyof Database["dev"]["Tables"]>(
    dirPath: string,
    tableName: T,
  ) {
    // パス組み立て（余分なスラッシュを除去）
    const normalizedDir = dirPath.replace(/^\/+|\/+$/g, '');
    const filename = `${tableName}.json`;
    const objectPath = `${normalizedDir}/${filename}`;

    try {
      const file = this.bucket.file(objectPath);

      // 存在チェック（権限があれば高速）
      const [exists] = await file.exists();
      if (!exists) {
        throw new Error(
          `Failed to load static master from GCS. ${filename} is empty.`,
        );
      }

      const [buffer] = await file.download();
      const text = buffer.toString('utf8').trim();

      if (!text) {
        // 空文字（＝実質空ファイル）
        throw new Error(
          `Failed to load static master from GCS. ${filename} is empty.`,
        );
      }

      let jsonData: unknown;
      try {
        jsonData = JSON.parse(text);
      } catch (e) {
        // JSON として壊れている
        throw new Error(
          `Failed to load static master from GCS. ${tableName} is invalid.`,
        );
      }

      // スキーマ検証: { data: any[] } を期待
      if (
        typeof jsonData !== 'object' ||
        jsonData === null ||
        jsonData === undefined ||
        !Array.isArray((jsonData as any).data)
      ) {
        throw new Error(
          `Failed to load static master from GCS. ${tableName} is invalid.`,
        );
      }

      return (jsonData as { data: T[] }).data as unknown as TableRow<T>[];;
    } catch (err: any) {
      // 404/権限/ネットワークなどをここでログ（メッセージは仕様の文言を優先）
      // ただし file.exists()/download() で throw された内部エラーは
      // 上の明示エラーに置き換えず、ここで包んで再 throw する
      // → 既に仕様の文言で throw 済みのケースはそのまま上がる
      if (
        typeof err?.message === 'string' &&
        (err.message.includes('is empty') ||
          err.message.includes('is undefined') ||
          err.message.includes('is invalid'))
      ) {
        // 仕様準拠のエラーメッセージはそのまま再送
        throw err;
      }
      throw new Error(
        `Failed to load static master from GCS. ${tableName} is invalid.`,
      );
    }
  }
}
