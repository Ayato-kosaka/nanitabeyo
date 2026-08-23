import type { Region } from "@/components/MapView";
import type { MyDishPin } from "@shared/api/v1/res";

/**
 * #1375 実機確認（5 巡目）「Map のクラスタリングはやってほしい」への対処。
 *
 * ## なぜライブラリを足さないのか
 *
 * `supercluster` 等は素の JS なので OTA でも配れるが、この画面が要るのは
 * «近すぎて重なったピンを 1 つに畳む» だけで、ライブラリ本体の機能
 * （ズームごとの階層・タイル・KD ツリー）は 1 つも使わない。
 * ピンは API が **最大 300 件**（`MY_DISH_MAP_PINS_LIMIT`）に切っているので、
 * 貪欲法の総当たりで足りる。依存を増やさない。
 *
 * ## «近さ» は画面基準で決める（緯度経度の固定幅ではない）
 *
 * 固定の度数で切ると、ズームアウトしたときは畳めず、寄ったときは畳みすぎる。
 * `region.latitudeDelta` / `longitudeDelta`（＝ いま画面に映っている範囲）に対する
 * 割合で半径を決めると、**見かけの距離**が一定になり、
 * 「重なって見えるものだけが畳まれる」挙動になる。
 *
 * ## 畳んだ結果が 1 件なら畳まない
 *
 * 近くに何も無いピンはクラスタにせず、元のピン（店舗の写真）をそのまま出す。
 * «1» と書かれた丸が並ぶ地図は、畳む前より情報が減る。
 */

/**
 * 「近い」とみなす距離。画面の短辺のこの割合より近いピン同士を畳む。
 * 0.08 = 画面幅のおよそ 12 分の 1（マーカーの絵が重なって見え始める距離）。
 */
export const CLUSTER_RADIUS_RATIO = 0.08;

export type MyDishPinCluster = {
	/** React の key。単独なら店舗 id、畳んだなら先頭のピンの店舗 id から決まる */
	id: string;
	latitude: number;
	longitude: number;
	/** このクラスタに入ったピン（1 件なら «畳んでいない» ＝ 単独ピンとして描く） */
	pins: MyDishPin[];
};

/**
 * ピンを表示域に応じた近さで畳む。
 *
 * ## なぜ格子ではなく «近さ» なのか
 *
 * 最初は緯度経度を格子で割る実装にしたが、自分で書いたテストが即座に落ちた。
 * **セルの境目に載った 2 点は、何メートルしか離れていなくても別のセルに入る**
 * （139.7600 と 139.7602 が実際に割れた）。畳みたいのは «画面で重なって見えるもの» なので、
 * 判定も画面上の近さで行う。ピンは API が最大 300 件に切っているので、
 * 貪欲法（各ピンを既存クラスタの中心と比べる）で足りる。
 *
 * 入力順に走るため、同じ入力なら必ず同じ結果になる（マーカーの並びが取得のたびに
 * 入れ替わらない）。表示域が不正（delta が 0 以下）なら畳まず 1 件ずつ返す。
 */
export function clusterMyDishPins(pins: readonly MyDishPin[], region: Region | null): MyDishPinCluster[] {
	const valid = pins.filter(
		(pin) => Number.isFinite(pin.restaurant.latitude) && Number.isFinite(pin.restaurant.longitude),
	);

	const single = (pin: MyDishPin): MyDishPinCluster => ({
		id: pin.restaurant.id,
		latitude: pin.restaurant.latitude,
		longitude: pin.restaurant.longitude,
		pins: [pin],
	});

	if (!region || !(region.latitudeDelta > 0) || !(region.longitudeDelta > 0)) {
		return valid.map(single);
	}

	const latRadius = region.latitudeDelta * CLUSTER_RADIUS_RATIO;
	const lngRadius = region.longitudeDelta * CLUSTER_RADIUS_RATIO;

	const clusters: MyDishPinCluster[] = [];
	for (const pin of valid) {
		const { latitude, longitude } = pin.restaurant;
		// 緯度と経度で半径が違う（画面の縦横比ぶん）ので、正規化した距離で比べる
		const target = clusters.find((cluster) => {
			const dLat = (cluster.latitude - latitude) / latRadius;
			const dLng = (cluster.longitude - longitude) / lngRadius;
			return dLat * dLat + dLng * dLng <= 1;
		});
		if (!target) {
			clusters.push(single(pin));
			continue;
		}
		target.pins.push(pin);
		// 中心は含まれるピンの重心。追加のたびに incremental に更新する
		const n = target.pins.length;
		target.latitude += (latitude - target.latitude) / n;
		target.longitude += (longitude - target.longitude) / n;
		target.id = `cluster:${target.pins[0].restaurant.id}`;
	}
	return clusters;
}

/**
 * クラスタを押したときに寄る表示域。
 *
 * 含まれるピンの外接矩形へ寄せる。全部が同じ座標（同居ビルの店など）だと
 * delta が 0 になって «無限に寄る» ので、下限を設けて必ず有限の矩形にする。
 */
export const CLUSTER_ZOOM_MIN_DELTA = 0.002;

export function regionForCluster(cluster: MyDishPinCluster): Region {
	const lats = cluster.pins.map((p) => p.restaurant.latitude);
	const lngs = cluster.pins.map((p) => p.restaurant.longitude);
	const minLat = Math.min(...lats);
	const maxLat = Math.max(...lats);
	const minLng = Math.min(...lngs);
	const maxLng = Math.max(...lngs);
	return {
		latitude: (minLat + maxLat) / 2,
		longitude: (minLng + maxLng) / 2,
		// 1.4 倍の余白。ぴったりだと端のピンがマーカーの絵の分だけ画面外へ出る
		latitudeDelta: Math.max((maxLat - minLat) * 1.4, CLUSTER_ZOOM_MIN_DELTA),
		longitudeDelta: Math.max((maxLng - minLng) * 1.4, CLUSTER_ZOOM_MIN_DELTA),
	};
}
