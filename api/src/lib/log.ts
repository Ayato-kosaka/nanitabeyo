import { env } from "./env";
import { randomUUID } from "crypto";

/**
 * 🚀 バックエンドイベントを `backend_event_logs` テーブルに記録する。
 *
 * イベント発生時のトレース、デバッグ、監査に活用される。
 * 開発環境では内容をコンソールにも出力。
 *
 * @param event_name - 発生したイベント名（例: 'spotCreated'）
 * @param error_level - イベントのレベル
 * @param function_name - 呼び出し元関数名（例: 'generateSpotGuide'）
 * @param user_id - 操作を行ったユーザーのID（匿名可）
 * @param payload - イベントに付随するデータ（JSON）
 * @param request_id - トレースID（API間ログ紐付けに使用）
 * @returns {Promise<void>} 非同期処理（失敗時は dev 環境でのみ出力）
 */
export const logBackendEvent = async ({
  event_name,
  error_level,
  function_name,
  user_id,
  payload,
  request_id,
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore - Prisma types are not available
  // }: Required<Omit<Prisma.backend_event_logsCreateInput, "id" | "created_commit_id" | "created_at">>
}: {
  event_name: string;
  error_level: string;
  function_name: string;
  user_id: string;
  payload: unknown;
  request_id: string;
}): Promise<void> => {
  try {
    // await prisma.backend_event_logs.create({
    //   data: {
    //     id: randomUUID(),
    //     event_name,
    //     error_level,
    //     function_name,
    //     user_id,
    //     payload,
    //     request_id,
    //     created_at: new Date(),
    //     created_commit_id: env.FUNCTIONS_COMMIT_ID,
    //   },
    // });

    if (env.API_NODE_ENV === "development") {
      console.log(`\uD83D\uDCD8 [${error_level}] ${function_name}:${event_name}`, payload);
    }
  } catch (error: any) {
    if (env.API_NODE_ENV === "development") {
      console.error("\u274C Failed to log backend event", {
        error: error.message,
        function_name,
        event_name,
        request_id,
      });
    }
  }
};

