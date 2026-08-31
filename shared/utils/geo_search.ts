/**
 * #1629 【設計】**地図の «引き»（ズームアウト）でも検索が成立するための、半径の共通定義。**
 *
 * ## なぜこのファイルがあるのか
 *
 * かつて半径の上限は **50km** で、クライアント（`regionToArea` / `radiusForRegion`）と
 * サーバ（`QueryMyDishesDto.radius` の `@Max(50000)`）の 2 箇所に別々に書かれていた。
 * 結果として «日本全体を映して「このエリアで再検索」を押すと、実際には日本の中心から
 * 50km の円しか検索していない» という状態になり、東京の記録は全部その外へ落ちて
 * **必ず 0 件**になっていた（オーナー報告）。
 *
 * 「見えている範囲を検索する」を守るには、上限は «地図が映しうる最大» でなければならない。
 * 半径の上限は性能を守るための道具ではない（性能は «候補を limit 件へ先に絞る» で守る。
 * `restaurants.repository.ts` の KNN + スポンサー枠を参照）。
 *
 * ⚠️ **この値を小さくすると «引くと 0 件» が戻る。** 上限で守りたくなったら、
 *    まず repository 側の «候補の絞り方» を見ること。
 */

/**
 * 検索半径の上限（m）。地球の半周（約 20,038km）を丸めた値。
 *
 * 実質的に「どんな viewport でも通る」。世界地図まで引いた状態（`latitudeDelta` が
 * 180 度）でも viewport の対角線の半分は 1 万 km 台に収まるので、ここで切られることはない。
 * DTO の `@Max` としては «壊れた値・悪意ある値» を弾く役割だけを持つ。
 */
export const MAX_SEARCH_RADIUS_M = 20_000_000;

/** 緯度 1 度あたりの距離（m）。WGS84 の平均値 */
export const METERS_PER_DEGREE_LATITUDE = 111_320;

/** 地図の viewport（中心 + delta）を表す最小の形 */
export type ViewportLike = {
	latitude: number;
	longitude: number;
	latitudeDelta: number;
	longitudeDelta: number;
};

const isFiniteNumber = (value: number): boolean => typeof value === "number" && Number.isFinite(value);

/**
 * viewport の «対角線の半分»（m）を返す。非有限値を含むなら `null`。
 *
 * 「見えているものが全部入る円」＝ 外接円である。内接円（縦幅の半分）にすると
 * 画面の四隅が検索範囲から外れ、«地図には映っているのに出てこない» が起きる。
 *
 * 経度方向は緯度によって縮むので `cos(lat)` を掛ける。
 */
export function viewportRadiusMeters(viewport: ViewportLike | null | undefined): number | null {
	if (!viewport) return null;
	const { latitude, latitudeDelta, longitudeDelta } = viewport;
	if (!isFiniteNumber(latitude) || !isFiniteNumber(latitudeDelta) || !isFiniteNumber(longitudeDelta)) {
		return null;
	}
	const lat = Math.min(Math.max(latitude, -90), 90);
	// delta は「viewport の縦・横の幅（度）」。負の delta を渡してくる実装があり得るので絶対値を取る。
	const latSpanMeters = Math.abs(latitudeDelta) * METERS_PER_DEGREE_LATITUDE;
	const lngSpanMeters = Math.abs(longitudeDelta) * METERS_PER_DEGREE_LATITUDE * Math.cos((lat * Math.PI) / 180);
	return Math.sqrt(latSpanMeters ** 2 + lngSpanMeters ** 2) / 2;
}
