/**
 * 指定された画像パスからキャッシュキーを取得します。
 * クエリパラメータを除去して、基本のパスのみを返します。
 *
 * @param path 画像のパス（URL）
 * @returns キャッシュキー
 */
export const getCacheKeyForImage = (path: string | undefined) => {
	if (!!path) return path.split("?")[0];
	return undefined;
};
