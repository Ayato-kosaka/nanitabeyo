// api/src/internal/bulk-import/bulk-import-job.interface.ts
//
// Cloud Tasks で処理する非同期ジョブのペイロード定義（シンプル化）
//

/**
 * Cloud Tasks で処理する bulk import ジョブのペイロード
 * 設計方針: 最小限のデータのみを含む。Google Places API の生データを直接渡す
 */
export interface BulkImportJobPayload {
  /** ジョブの一意識別子 */
  jobId: string;

  /** 冪等性キー（重複処理防止） */
  idempotencyKey: string;

  /** Google Places API の生データ（places配列） */
  places: any[];

  /** Google Places API の生データ（contextualContents配列） */
  contextualContents: any[];

  /** 料理カテゴリID */
  categoryId: string;

  /** 料理カテゴリ名 */
  categoryName: string;

  /** 言語コード */
  languageCode: string;
}
