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
import {
	CLUSTER_ZOOM_MIN_DELTA,
	MAX_RENDERED_CLUSTERS,
	capClusters,
	clusterMyDishPins,
	isSameClusterScale,
	isSameClusterViewport,
	regionForCluster,
} from "./clustering";

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

	// #1375 座標は **REGION の中**に置くこと。外に出すと間引き（表示域の外は描かない）で
	// 落ちてしまい、«畳むかどうか» を見るテストにならない。REGION は中心 35.68/139.76・
	// 幅 0.07 なので、余白込みで ±0.056 が内側。畳む半径は 0.07 × 0.08 = 0.0056
	it("近くに何も無いピンは畳まず、店舗 id をそのまま key にする", () => {
		const clusters = clusterMyDishPins([pin("a", 35.66, 139.74), pin("b", 35.7, 139.78)], REGION);
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

	/*
	#1375（実機: マップのクラッシュ）**ここは意図的に前提を変えた。**

	以前は「中心は読まない」ことをテストで固定していた（倍率だけ渡しても中心つきで渡しても
	同じ結果になる、という形）。しかしそれこそが «画面外のピンまで全部マーカーにする»
	原因で、東京を拡大していても北海道と福岡のピンが作られ続けていた。

	いまは **畳み方は中心を読まない（pan では畳み直さない）／間引きは中心を読む** という
	分担にしてある。倍率だけを渡す呼び出しは «間引きしない» として従来どおり動く。
	*/
	it("倍率だけ渡すと間引きは働かず、畳み方は従来どおり", () => {
		const pins = [pin("a", 35.68, 139.76), pin("b", 35.6801, 139.7601), pin("c", 35.9, 140.2)];
		const byScale = clusterMyDishPins(pins, { latitudeDelta: 0.05, longitudeDelta: 0.05 });
		expect(byScale.map((c) => c.pins.length)).toEqual([2, 1]);
	});

	it("中心を渡すと、その範囲の外は落ちる（畳み方そのものは変わらない）", () => {
		const pins = [pin("a", 35.68, 139.76), pin("b", 35.6801, 139.7601), pin("c", 35.9, 140.2)];
		const region: Region = { latitude: 35.68, longitude: 139.76, latitudeDelta: 0.05, longitudeDelta: 0.05 };
		const byRegion = clusterMyDishPins(pins, region);
		// a と b は畳まれて 1 つ、遠い c は間引かれて消える
		expect(byRegion.map((c) => c.pins.length)).toEqual([2]);
	});
});

/*
#1375（実機: 「マップから絞り込む画面がすごくクラッシュする」）

**マーカーの «数» を固定するテスト。**

View Marker は 1 個ごとにネイティブ側でビットマップになる。API の上限 300 は
«返してよい件数» であって «同時に描いてよい件数» ではなく、300 個を素直に描くと
低メモリ端末が落ちる。ここで守るのは見た目ではなく **描く数の上限と、
画面外を描かないこと**である。

⚠️ 数字を期待に合わせて緩めないこと。緩めた瞬間にクラッシュが戻る。
*/
describe("表示域による間引きと上限（クラッシュ対策）", () => {
	const CENTERED = { latitude: 35.68, longitude: 139.76, latitudeDelta: 0.05, longitudeDelta: 0.05 };

	it("表示域から大きく外れたピンはマーカーにしない", () => {
		const inside = pin("inside", 35.68, 139.76);
		const hokkaido = pin("hokkaido", 43.06, 141.35);
		const fukuoka = pin("fukuoka", 33.59, 130.4);
		const ids = clusterMyDishPins([inside, hokkaido, fukuoka], CENTERED).map((c) => c.id);
		expect(ids).toEqual(["inside"]);
	});

	it("表示域のすぐ外（余白の内）は残す。指を離すたびに端のピンが消えないようにするため", () => {
		// 画面の縦幅は 0.05 なので端は中心 ±0.025。余白込みで ±0.04 まで残る
		const justOutside = pin("just-outside", 35.68 + 0.03, 139.76);
		expect(clusterMyDishPins([justOutside], CENTERED).map((c) => c.id)).toEqual(["just-outside"]);
	});

	it("中心を持たない表示域では間引かない（倍率だけを渡す既存の呼び出しを壊さない）", () => {
		const far = pin("far", 43.06, 141.35);
		const near = pin("near", 35.68, 139.76);
		expect(clusterMyDishPins([far, near], { latitudeDelta: 0.05, longitudeDelta: 0.05 })).toHaveLength(2);
	});

	/*
	上限は `capClusters` を直に見る。畳む半径も間引きの窓も同じ `delta` から決まるので、
	«200 個が同時に別々の丸として残る表示域» は現実には作れない（広くすれば畳まれ、
	狭くすれば間引かれる）。上限は «それでも超えたときの最後の締め» なので、
	その関数だけを取り出して固定するのが正確である。
	*/
	const cluster = (id: string, latitude: number, longitude: number) => ({
		id,
		latitude,
		longitude,
		pins: [pin(id, latitude, longitude)],
	});

	it("描く丸は MAX_RENDERED_CLUSTERS 個まで。中心に近いものから残す", () => {
		const many = Array.from({ length: 200 }, (_, i) => cluster(`p${i}`, 35.68, 139.76 + i * 0.01));
		const capped = capClusters(many, CENTERED);
		expect(capped).toHaveLength(MAX_RENDERED_CLUSTERS);
		const ids = capped.map((c) => c.id);
		// 中心（139.76）に最も近い p0 は必ず残り、最も遠い p199 は落ちる
		expect(ids).toContain("p0");
		expect(ids).not.toContain("p199");
	});

	it("上限で切っても並び順は元のまま（並びが入れ替わるとマーカーが作り直される）", () => {
		const many = Array.from({ length: 200 }, (_, i) => cluster(`p${i}`, 35.68, 139.76 + i * 0.01));
		const lngs = capClusters(many, CENTERED).map((c) => c.longitude);
		expect([...lngs].sort((a, b) => a - b)).toEqual(lngs);
	});

	it("上限以下なら同じ配列をそのまま返す（無用な作り直しをしない）", () => {
		const few = [cluster("a", 35.68, 139.76)];
		expect(capClusters(few, CENTERED)).toBe(few);
	});
});

describe("isSameClusterViewport", () => {
	const BASE = { latitude: 35.68, longitude: 139.76, latitudeDelta: 0.05, longitudeDelta: 0.05 };

	it("少し動かしただけなら «同じ» とみなす（pan のたびに畳み直さない）", () => {
		expect(isSameClusterViewport(BASE, { ...BASE, latitude: 35.68 + 0.05 * 0.1 })).toBe(true);
	});

	it("表示域の 25% 以上動いたら作り直す", () => {
		expect(isSameClusterViewport(BASE, { ...BASE, latitude: 35.68 + 0.05 * 0.3 })).toBe(false);
	});

	it("倍率が変われば中心が同じでも作り直す", () => {
		expect(isSameClusterViewport(BASE, { ...BASE, latitudeDelta: 0.2, longitudeDelta: 0.2 })).toBe(false);
	});
});
