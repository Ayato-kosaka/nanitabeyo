/*
#1375 実機確認（5 巡目）「Map のクラスタリング」の純ロジック。

守るのは 4 つ。
1. 表示域に対する «近さ» で畳む（＝ 寄ればほどける・引けば畳まる）
2. 近くに何も無いピンは畳まない（«1» と書かれた丸は情報を減らす）
3. 入力の順序を保つ（マーカーの並びが取得のたびに入れ替わらない）
4. クラスタを押したときの寄り先は「中のピンの外接矩形」で、同じ座標でも 0 にならない
*/
import type { Region } from "@/components/MapView";
import type { MyDishPin } from "@shared/api/v1/res";
import { CLUSTER_ZOOM_MIN_DELTA, clusterMyDishPins, isSameClusterScale, regionForCluster } from "./clustering";

const pin = (id: string, latitude: number, longitude: number): MyDishPin =>
	({
		restaurant: { id, name: id, latitude, longitude, image_url: null },
		counts: { want: 0, eaten: 1 },
		latestOccurredAt: "2026-08-20T00:00:00.000Z",
		representativeThumbnailUrl: null,
	}) as unknown as MyDishPin;

/** 東京駅あたりを 0.07 度（≒ 7km 強）ぶん映している想定 */
const REGION: Region = { latitude: 35.68, longitude: 139.76, latitudeDelta: 0.07, longitudeDelta: 0.07 };

describe("clusterMyDishPins", () => {
	it("近いピンを 1 つへ畳み、位置は重心になる", () => {
		const clusters = clusterMyDishPins([pin("a", 35.68, 139.76), pin("b", 35.6802, 139.7602)], REGION);
		expect(clusters).toHaveLength(1);
		expect(clusters[0].pins).toHaveLength(2);
		expect(clusters[0].latitude).toBeCloseTo(35.6801, 4);
		expect(clusters[0].longitude).toBeCloseTo(139.7601, 4);
		expect(clusters[0].id).toBe("cluster:a");
	});

	it("近くに何も無いピンは畳まず、店舗 id をそのまま key にする", () => {
		const clusters = clusterMyDishPins([pin("a", 35.6, 139.7), pin("b", 35.7, 139.8)], REGION);
		expect(clusters).toHaveLength(2);
		expect(clusters.map((c) => c.id)).toEqual(["a", "b"]);
		expect(clusters.every((c) => c.pins.length === 1)).toBe(true);
	});

	it("寄る（delta を小さくする）と畳まれていたものがほどける", () => {
		const pins = [pin("a", 35.68, 139.76), pin("b", 35.683, 139.763)];
		expect(clusterMyDishPins(pins, REGION)).toHaveLength(1);
		const zoomedIn: Region = { ...REGION, latitudeDelta: 0.004, longitudeDelta: 0.004 };
		expect(clusterMyDishPins(pins, zoomedIn)).toHaveLength(2);
	});

	it("入力の順序を保つ（マーカーの並びが毎回入れ替わらない）", () => {
		const pins = [pin("far", 35.7, 139.8), pin("a", 35.68, 139.76), pin("b", 35.6801, 139.7601)];
		const clusters = clusterMyDishPins(pins, REGION);
		expect(clusters[0].id).toBe("far");
		expect(clusters[1].pins.map((p) => p.restaurant.id)).toEqual(["a", "b"]);
	});

	it("表示域が無い / 壊れているときは畳まない", () => {
		const pins = [pin("a", 35.68, 139.76), pin("b", 35.6801, 139.7601)];
		expect(clusterMyDishPins(pins, null)).toHaveLength(2);
		expect(clusterMyDishPins(pins, { ...REGION, latitudeDelta: 0 })).toHaveLength(2);
	});

	it("座標が数値でないピンは落とす（地図の原点に集まらせない）", () => {
		const broken = pin("broken", Number.NaN, Number.NaN);
		expect(clusterMyDishPins([broken, pin("a", 35.68, 139.76)], REGION).map((c) => c.id)).toEqual(["a"]);
	});
});

describe("regionForCluster", () => {
	it("中のピンの外接矩形へ寄る（余白つき）", () => {
		const [cluster] = clusterMyDishPins([pin("a", 35.68, 139.76), pin("b", 35.682, 139.762)], REGION);
		const region = regionForCluster(cluster);
		expect(region.latitude).toBeCloseTo(35.681, 4);
		expect(region.longitude).toBeCloseTo(139.761, 4);
		expect(region.latitudeDelta).toBeGreaterThan(0.002);
	});

	it("全部が同じ座標でも delta が 0 にならない（無限に寄らない）", () => {
		const [cluster] = clusterMyDishPins([pin("a", 35.68, 139.76), pin("b", 35.68, 139.76)], REGION);
		const region = regionForCluster(cluster);
		expect(region.latitudeDelta).toBe(CLUSTER_ZOOM_MIN_DELTA);
		expect(region.longitudeDelta).toBe(CLUSTER_ZOOM_MIN_DELTA);
	});
});

/**
 * #1375（5 巡目・性能レビュー B-1）pan だけでは畳み直さないこと。
 *
 * `onRegionChangeComplete` は指を離すたびに新しい Region オブジェクトを寄こす。
 * それをそのまま useMemo の依存へ入れていたので、**地図を少し動かすだけで
 * 最大 300 個のマーカーが作り直されていた**。倍率だけを見て、5% 未満の差は同一とみなす。
 */
describe("isSameClusterScale", () => {
	it("中心だけ動いた（= pan）なら同じ倍率とみなす", () => {
		expect(
			isSameClusterScale({ latitudeDelta: 0.05, longitudeDelta: 0.05 }, { latitudeDelta: 0.05, longitudeDelta: 0.05 }),
		).toBe(true);
	});

	it("5% 未満のぶれは同じ倍率とみなす（指を離すたびの微差で畳み直さない）", () => {
		expect(
			isSameClusterScale(
				{ latitudeDelta: 0.05, longitudeDelta: 0.05 },
				{ latitudeDelta: 0.0502, longitudeDelta: 0.0499 },
			),
		).toBe(true);
	});

	it("ズームで倍率が変われば畳み直す", () => {
		expect(
			isSameClusterScale({ latitudeDelta: 0.05, longitudeDelta: 0.05 }, { latitudeDelta: 0.1, longitudeDelta: 0.1 }),
		).toBe(false);
	});

	it("不正な表示域（0 や負値）との行き来は同一とみなさない", () => {
		// 0 は «畳まない»（clusterMyDishPins が 1 件ずつ返す）ので、有効値との間は必ず畳み直す
		expect(
			isSameClusterScale({ latitudeDelta: 0.05, longitudeDelta: 0.05 }, { latitudeDelta: 0, longitudeDelta: 0 }),
		).toBe(false);
		expect(
			isSameClusterScale({ latitudeDelta: 0, longitudeDelta: 0 }, { latitudeDelta: 0.05, longitudeDelta: 0.05 }),
		).toBe(false);
	});

	it("倍率だけ渡してもクラスタリングは成立する（中心は読まない）", () => {
		const pins = [pin("a", 35.68, 139.76), pin("b", 35.6801, 139.7601), pin("c", 35.9, 140.2)];
		const byScale = clusterMyDishPins(pins, { latitudeDelta: 0.05, longitudeDelta: 0.05 });
		const region: Region = { latitude: 0, longitude: 0, latitudeDelta: 0.05, longitudeDelta: 0.05 };
		const byRegion = clusterMyDishPins(pins, region);
		expect(byScale).toEqual(byRegion);
		expect(byScale.map((c) => c.pins.length)).toEqual([2, 1]);
	});
});
