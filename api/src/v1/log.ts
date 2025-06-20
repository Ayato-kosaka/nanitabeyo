import { env } from "./env";
import { randomUUID } from "crypto";

/**
 * \uD83D\uDE80 \u30D0\u30C3\u30AF\u30A8\u30F3\u30C9\u30A4\u30D9\u30F3\u30C8\u3092 `backend_event_logs` \u30C6\u30FC\u30D6\u30EB\u306B\u8A18\u9332\u3059\u308B\u3002
 *
 * \u30A4\u30D9\u30F3\u30C8\u767A\u751F\u6642\u306E\u30C8\u30EC\u30FC\u30B9\u3001\u30C7\u30D0\u30C3\u30B0\u3001\u76E3\u67FB\u306B\u6D3B\u7528\u3055\u308C\u308B\u3002
 * \u958B\u767A\u74B0\u5883\u3067\u306F\u5185\u5BB9\u3092\u30B3\u30F3\u30BD\u30FC\u30EB\u306B\u3082\u51FA\u529B\u3002
 *
 * @param event_name - \u767A\u751F\u3057\u305F\u30A4\u30D9\u30F3\u30C8\u540D\uFF08\u4F8B: 'spotCreated'\uFF09
 * @param error_level - \u30A4\u30D9\u30F3\u30C8\u306E\u30EC\u30D9\u30EB
 * @param function_name - \u547C\u3073\u51FA\u3057\u5143\u95A2\u6570\u540D\uFF08\u4F8B: 'generateSpotGuide'\uFF09
 * @param user_id - \u64CD\u4F5C\u3092\u884C\u3063\u305F\u30E6\u30FC\u30B6\u30FC\u306EID\uFF08\u533F\u540D\u53EF\uFF09
 * @param payload - \u30A4\u30D9\u30F3\u30C8\u306B\u4ED8\u968F\u3059\u308B\u30C7\u30FC\u30BF\uFF08JSON\uFF09
 * @param request_id - \u30C8\u30EC\u30FC\u30B9ID\uFF08API\u9593\u30ED\u30B0\u7D46\u4ED8\u3051\u306B\u4F7F\u7528\uFF09
 * @returns {Promise<void>} \u975E\u540C\u671F\u51E6\u7406\uFF08\u5931\u6557\u6642\u306F dev \u74B0\u5883\u3067\u306E\u307F\u51FA\u529B\uFF09
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

