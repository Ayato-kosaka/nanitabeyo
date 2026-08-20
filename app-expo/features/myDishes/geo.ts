/**
 * #1396 Map の `Region`（中心 + delta）を API の `{lat, lng, radius}` へ変換する純関数。
 *
 * ⚠️ **この変換を呼ぶのは「このエリアで再検索」を押した瞬間だけ**である。
 * `onRegionChangeComplete` のたびに呼んで filter store へ入れてはいけない
 * （設計書 (2/2) §3-2 / #1395 §0(A): `dish_reviews` は約 964MB、平均 4.48 秒）。
 * 生の viewport は `MyDishesMapView` 内の `useRef` に置く。
 */

/**
 * `react-native-maps` の `Region` と構造的に互換な最小の形。
 *
 * `Region` 型そのものを import すると、この純関数の単体テストが
 * `react-native-maps` のネイティブモジュール解決を要求してしまうため、
 * ここでは形だけを受け取る（`Region` はこの型に代入可能）。
 */
export type MapRegionLike = {
	latitude: number;
	longitude: number;
	latitudeDelta: number;
	longitudeDelta: number;
};

/** `QueryMyDishesDto` が受け付ける半径の下限（m）。これ未満は 400 になる */
export const MIN_AREA_RADIUS_M = 10;

/** `QueryMyDishesDto` が受け付ける半径の上限（m）。これ超過は 400 になる */
export const MAX_AREA_RADIUS_M = 50_000;

/** 緯度 1 度あたりの距離（m）。WGS84 の平均値 */
export const METERS_PER_DEGREE_LATITUDE = 111_320;

/** #1396 `commitArea` へ渡すエリア（`MyDishesArea` の非 null 部分と同じ形） */
export type AreaFromRegion = { lat: number; lng: number; radius: number };

const isFiniteNumber = (value: number): boolean => typeof value === "number" && Number.isFinite(value);

/**
 * 緯度を [-90, 90]、経度を [-180, 180] に丸める。
 * Map が返す region は極付近やズームアウト時に範囲外の値を持つことがあり、
 * そのまま送ると `QueryMyDishesDto` の `@Min` / `@Max` で 400 になる。
 */
const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max);

/**
 * viewport（`Region`）を「中心座標 + 対角線の半分」へ変換する（#1395 の `radius` の定義）。
 *
 * - 半径は viewport の対角線の半分。経度方向は緯度によって縮むので `cos(lat)` を掛ける。
 * - 結果は `[MIN_AREA_RADIUS_M, MAX_AREA_RADIUS_M]` に clamp する（DTO のバリデーション範囲）。
 * - 非有限値（NaN / Infinity）を含む region は `null` を返す。呼び出し側は「エリアを確定しない」を選べる。
 */
export function regionToArea(region: MapRegionLike | null | undefined): AreaFromRegion | null {
	if (!region) return null;
	const { latitude, longitude, latitudeDelta, longitudeDelta } = region;
	if (
		!isFiniteNumber(latitude) ||
		!isFiniteNumber(longitude) ||
		!isFiniteNumber(latitudeDelta) ||
		!isFiniteNumber(longitudeDelta)
	) {
		return null;
	}

	const lat = clamp(latitude, -90, 90);
	const lng = clamp(longitude, -180, 180);

	// delta は「viewport の縦・横の幅（度）」。負の delta を渡してくる実装があり得るので絶対値を取る。
	const latSpanMeters = Math.abs(latitudeDelta) * METERS_PER_DEGREE_LATITUDE;
	const lngSpanMeters = Math.abs(longitudeDelta) * METERS_PER_DEGREE_LATITUDE * Math.cos((lat * Math.PI) / 180);

	const halfDiagonal = Math.sqrt(latSpanMeters ** 2 + lngSpanMeters ** 2) / 2;
	const radius = Math.round(clamp(halfDiagonal, MIN_AREA_RADIUS_M, MAX_AREA_RADIUS_M));

	return { lat, lng, radius };
}
