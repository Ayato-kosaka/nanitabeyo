/** カーソル式ページネーションが必要な API 用 */
export interface PaginatedResponse<T> {
	data: T[]; // ページ内のデータ
	nextCursor: string | null; // 以降が無い場合 null

	/** 任意で offset, prevCursor, totalCount など後付けしやすい */
}
