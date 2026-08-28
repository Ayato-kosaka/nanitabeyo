/**
 * #1396 Map の `Region`（中心 + delta）を API の `{lat, lng, radius}` へ変換する純関数。
 *
 * ⚠️ **この変換を呼ぶのは「このエリアで再検索」を押した瞬間だけ**である。
 * `onRegionChangeComplete` のたびに呼んで filter store へ入れてはいけない
 * （設計書 (2/2) §3-2 / #1395 §0(A): `dish_reviews` は約 964MB、平均 4.48 秒）。
 * 生の viewport は `MyDishesMapView` 内の `useRef` に置く。
 */
import {
	MAX_SEARCH_RADIUS_M,
	METERS_PER_DEGREE_LATITUDE,
	viewportRadiusMeters,
	type ViewportLike,
} from "@shared/utils/geo_search";

// 既存の import 元（テスト等）を壊さないための再輸出。定義の正本は shared/utils/geo_search.ts
export { METERS_PER_DEGREE_LATITUDE };

/**
 * `react-native-maps` の `Region` と構造的に互換な最小の形。
 *
 * `Region` 型そのものを import すると、この純関数の単体テストが
 * `react-native-maps` のネイティブモジュール解決を要求してしまうため、
 * ここでは形だけを受け取る（`Region` はこの型に代入可能）。
 */
export type MapRegionLike = ViewportLike;

/** `QueryMyDishesDto` が受け付ける半径の下限（m）。これ未満は 400 になる */
export const MIN_AREA_RADIUS_M = 10;

/**
 * #1629 【設計】`QueryMyDishesDto` が受け付ける半径の上限（m）。これ超過は 400 になる。
 *
 * **かつては 50km だった。** そのため日本全体を映して「このエリアで再検索」を押しても
 * «日本の中心から 50km» の円しか検索せず、東京の記録は全部その外へ落ちて必ず 0 件になった
 * （オーナー報告）。地図で «見えている範囲を検索する» と言う以上、上限は
 * «地図が映しうる最大» でなければならない。正本は shared/utils/geo_search.ts。
 */
export const MAX_AREA_RADIUS_M = MAX_SEARCH_RADIUS_M;

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

	// 半径 = viewport の外接円（対角線の半分）。計算の正本は shared/utils/geo_search.ts
	const halfDiagonal = viewportRadiusMeters(region) ?? 0;
	const radius = Math.round(clamp(halfDiagonal, MIN_AREA_RADIUS_M, MAX_AREA_RADIUS_M));

	return { lat, lng, radius };
}

/**
 * #1396 レビュー M-2: 「このエリアで再検索」を押したとき、`regionToArea` が `MAX_AREA_RADIUS_M`
 * で clamp してしまう（= 実際に確定する円が viewport よりはるかに広い）かどうかを事前に判定する。
 *
 * `regionToArea` 自体は clamp 後の値しか返さないため、呼び出し側（`MyDishesMapView`）は
 * 「ボタンのラベルと確定する範囲が大きくずれる」ケースを検知できなかった。ここで
 * 判定手段を切り出し、呼び出し側はズームレベルが粗すぎる間ボタンを無効化できるようにする。
 *
 * 非有限値の region は「確定に使えない」= too wide 扱いにする（`regionToArea` が null を返すのと対）。
 */
export function isRegionTooWide(region: MapRegionLike | null | undefined): boolean {
	if (!region) return true;
	const { latitude, longitude, latitudeDelta, longitudeDelta } = region;
	if (
		!isFiniteNumber(latitude) ||
		!isFiniteNumber(longitude) ||
		!isFiniteNumber(latitudeDelta) ||
		!isFiniteNumber(longitudeDelta)
	) {
		return true;
	}

	const halfDiagonal = viewportRadiusMeters(region);
	if (halfDiagonal === null) return true;

	return halfDiagonal > MAX_AREA_RADIUS_M;
}

/** #1396 m-1: ピンの外接矩形を表す最小の座標の形 */
export type CoordinateLike = { latitude: number; longitude: number };

/**
 * #1396 m-1: ピン群の外接矩形へ寄せるための `Region` を計算する純関数（`DishMediaMap.tsx` の
 * `getMapRegion` と同じ考え方。余白 20%、最小 delta 0.02 度でズームインしすぎを避ける）。
 *
 * 呼び出し元（`MyDishesMapView`）は初回取得後に一度だけこれを `animateToRegion` へ渡す。
 * store には触れない・queryKey も変えないので、二度目以降の取得では呼ばない（呼び出し側の責務）。
 */
export function boundingRegionForCoordinates(coordinates: CoordinateLike[]): MapRegionLike | null {
	/*
	#1375（実機: マップのクラッシュ）**非有限値を先に落とす。**

	返り値はそのまま `animateToRegion` に渡る。1 件でも NaN / Infinity が混ざると
	Math.min / Math.max ごと NaN に伝播し、**ネイティブの地図へ NaN の Region を渡す**。
	Android ではそこで例外を伴わずに描画が止まりうる。
	同じ `pins` を食う `clusterMyDishPins` は `Number.isFinite` で弾いているのに、
	こちらだけ無防備だった（`regionToArea` / `isRegionTooWide` は弾いている）。
	*/
	const finite = coordinates.filter((c) => Number.isFinite(c.latitude) && Number.isFinite(c.longitude));
	if (finite.length === 0) return null;

	const latitudes = finite.map((c) => c.latitude);
	const longitudes = finite.map((c) => c.longitude);
	const minLat = Math.min(...latitudes);
	const maxLat = Math.max(...latitudes);
	const minLng = Math.min(...longitudes);
	const maxLng = Math.max(...longitudes);

	const latitude = (minLat + maxLat) / 2;
	const longitude = (minLng + maxLng) / 2;
	const latitudeDelta = Math.max((maxLat - minLat) * 1.2, 0.02);
	const longitudeDelta = Math.max((maxLng - minLng) * 1.2, 0.02);

	return { latitude, longitude, latitudeDelta, longitudeDelta };
}
