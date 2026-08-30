import type { MyDishPin } from "@shared/api/v1/res";
import {
	clusterMapPins,
	cullPinsToViewport as cullMapPinsToViewport,
	type ClusterViewport,
	type MapPinCluster,
} from "@/features/map/clustering";

/**
 * #1375 my-dishes の Map のクラスタリング。
 *
 * ## 中身はここに無い（#1629）
 *
 * 実装は `features/map/clustering.ts` に移した。#1629 で
 * «食べたを記録 → お店を選ぶ»（`select-restaurant.tsx`）にも同じ間引き・畳み・上限が
 * 要ることが分かり、**同じロジックを 2 本持つのを避ける**ためである。
 * 共通実装は «`restaurant.id` / `latitude` / `longitude` を持つもの» を畳む形に
 * 一般化してあり、ここはそれを `MyDishPin` へ束ね直すだけの薄い層である。
 *
 * 設計の理由（なぜライブラリを足さないか / なぜ格子ではなく «近さ» か /
 * なぜ 1 件のクラスタを作らないか）は共通実装の JSDoc にある。
 */
export {
	CLUSTER_RADIUS_RATIO,
	CLUSTER_SCALE_EPSILON,
	CLUSTER_ZOOM_MIN_DELTA,
	MAX_RENDERED_CLUSTERS,
	VIEWPORT_CULL_EPSILON,
	VIEWPORT_CULL_MARGIN,
	capClusters,
	isSameClusterScale,
	isSameClusterViewport,
	regionForCluster,
	type ClusterScale,
	type ClusterViewport,
} from "@/features/map/clustering";

export type MyDishPinCluster = MapPinCluster<MyDishPin>;

export function clusterMyDishPins(pins: readonly MyDishPin[], region: ClusterViewport | null): MyDishPinCluster[] {
	return clusterMapPins(pins, region);
}

export function cullPinsToViewport(pins: readonly MyDishPin[], region: ClusterViewport | null): MyDishPin[] {
	return cullMapPinsToViewport(pins, region);
}
