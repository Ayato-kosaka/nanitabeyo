import { dateStringToTimestamp as baseDateStringToTimestamp } from "@/lib/frontend-utils";

// 日付表示の入口を集約。将来の TZ/相対表現変更の一元化ポイント
export const dateStringToTimestamp = baseDateStringToTimestamp;
