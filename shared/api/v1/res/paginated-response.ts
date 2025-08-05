import { BaseResponse } from './base-response';

/** カーソル式ページネーションが必要な API 用 */
export interface PaginatedResponse<T> extends BaseResponse<T[]> {
    nextCursor: string | null;   // 以降が無い場合 null
    /** 任意で offset, prevCursor, totalCount など後付けしやすい */
}
