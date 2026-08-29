import type { Region } from "@/components/MapView";

/**
 * #1375 / #1629 地図ピンの «間引き → 畳み → 上限» の共通実装。
 *
 * ## なぜここ（features/map）に居るのか
 *
 * 元は `features/myDishes/clustering.ts` に `MyDishPin` 専用として書いた。
 * #1629 で «食べたを記録 → お店を選ぶ» の地図（`select-restaurant.tsx`）にも
 * 同じ仕組みが要ることが分かったが、そちらが扱うのは `MyDishPin` ではなく
 * `QueryRestaurantsResponse` / 保存済み店舗である。
 * 3 つに共通するのは «`restaurant.id` / `latitude` / `longitude` を持つ» ことだけなので、
 * そこだけを型パラメータの制約にして、実装をこの 1 本へ寄せた。
 * `features/myDishes/clustering.ts` は `MyDishPin` へ束ねる薄い別名になっている。
 *
 * ## なぜライブラリを足さないのか
 *
 * `supercluster` 等は素の JS なので OTA でも配れるが、この地図が要るのは
 * «近すぎて重なったピンを 1 つに畳む» だけで、ライブラリ本体の機能
 * （ズームごとの階層・タイル・KD ツリー）は 1 つも使わない。
 * ピンは API 側で高々数百件に切られているので、貪欲法の総当たりで足りる。依存を増やさない。
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
 * 近くに何も無いピンはクラスタにせず、元のピンをそのまま出す。
 * «1» と書かれた丸が並ぶ地図は、畳む前より情報が減る。
 */

/**
 * 畳める最小限の «ピン»。地図に置ける（座標がある）店舗であればよい。
 *
 * ⚠️ ここを広げないこと。広げた瞬間に、この実装は特定の画面のデータ構造へ縛られる。
 */
export type MapPinLike = {
	restaurant: { id: string; latitude: number; longitude: number };
};

/**
 * 「近い」とみなす距離。画面の短辺のこの割合より近いピン同士を畳む。
 * 0.08 = 画面幅のおよそ 12 分の 1（マーカーの絵が重なって見え始める距離）。
 */
export const CLUSTER_RADIUS_RATIO = 0.08;

export type MapPinCluster<T extends MapPinLike> = {
	/** React の key。単独なら店舗 id、畳んだなら先頭のピンの店舗 id から決まる */
	id: string;
	latitude: number;
	longitude: number;
	/** このクラスタに入ったピン（1 件なら «畳んでいない» ＝ 単独ピンとして描く） */
	pins: T[];
};

/**
 * クラスタリングが実際に読む表示域の情報。**中心座標は読まない。**
 *
 * 畳む半径は delta の割合だけで決まるので、pan（中心が動くだけ）ではクラスタは 1 つも変わらない。
 * 型をここまで絞ってあるのは、呼び出し側が「pan では畳み直さない」を型として担保できるようにするためである。
 */
export type ClusterScale = Pick<Region, "latitudeDelta" | "longitudeDelta">;

/**
 * #1375（5 巡目・性能レビュー B-1）**畳み直しが要るほど倍率が変わったか。**
 *
 * `onRegionChangeComplete` は指を離すたびに «新しいオブジェクト» を寄こす。
 * それをそのまま state に入れると、中身が同じでも参照が変わるので `useMemo` が外れ、
 * 全マーカーが pan のたびに作り直されていた。
 * 5%（= `CLUSTER_SCALE_EPSILON`）未満の変化は畳み方に影響しないので、前の値を使い続ける。
 */
export const CLUSTER_SCALE_EPSILON = 0.05;

/**
 * #1375（実機: マップのクラッシュ）**間引きに使う «中心つき» の表示域。**
 *
 * `ClusterScale`（倍率だけ）は «pan では畳み直さない» ための型だが、その代償として
 * 「いま見えている範囲か」を判定する材料が無い。東京を拡大していても北海道と福岡の
 * ピンがマーカーとして作られ続けるのはこれが理由である。
 * 間引きにだけ中心を渡し、**更新のしきい値を粗くする**ことで «pan のたびに畳み直さない»
 * という元の狙いは保つ（`isSameClusterViewport`）。
 */
export type ClusterViewport = ClusterScale & { latitude?: number; longitude?: number };

/**
 * 表示域の何倍まで «画面の内» とみなすか。
 *
 * 1.0（＝ぴったり）にすると、指を離した直後に端のピンが消えて見える。
 * 少し外まで作っておけば、次に指を離すまでの pan で «無かったものが湧く» ことがない。
 */
export const VIEWPORT_CULL_MARGIN = 1.6;

/**
 * 同時に描くマーカーの既定の上限。
 *
 * ⚠️ API の上限は **«返してよい件数» であって «同時に描いてよい件数» ではない。**
 * View Marker は 1 個ごとにネイティブ側でビットマップになるので、数百個は
 * 低メモリ端末が落ちる水準である。画面に意味のある密度を上限に置く。
 * 中心に近いものから残すので、切られるのは «画面の隅の、さらに外» である。
 *
 * 画面ごとにマーカーの重さが違う（写真だけの丸か、写真 + 店名 2 行か）ので、
 * `clusterMapPins` の `maxRendered` で上書きできるようにしてある。
 */
export const MAX_RENDERED_CLUSTERS = 60;

/**
 * 間引きをやり直すほど表示域が動いたか。
 *
 * 倍率が変わっていない前提で、中心が delta の何割動いたら作り直すかを決める。
 * `VIEWPORT_CULL_MARGIN` が 1.6 なので、0.25（＝ 25%）動いても
 * «新しく画面に入ったピン» は既に作ってある余白の中に居る。
 */
export const VIEWPORT_CULL_EPSILON = 0.25;

export function isSameClusterViewport(a: ClusterViewport, b: ClusterViewport): boolean {
	if (!isSameClusterScale(a, b)) return false;
	// 片方でも中心を持たない（＝間引きしない）なら、倍率だけで判断する
	if (!Number.isFinite(a.latitude) || !Number.isFinite(b.latitude)) return true;
	if (!Number.isFinite(a.longitude) || !Number.isFinite(b.longitude)) return true;
	const movedLat = Math.abs((a.latitude as number) - (b.latitude as number));
	const movedLng = Math.abs((a.longitude as number) - (b.longitude as number));
	return movedLat < b.latitudeDelta * VIEWPORT_CULL_EPSILON && movedLng < b.longitudeDelta * VIEWPORT_CULL_EPSILON;
}

export function isSameClusterScale(a: ClusterScale, b: ClusterScale): boolean {
	const near = (x: number, y: number) => {
		if (x === y) return true;
		// 完全一致は上で抜けている。0 や負値（不正な表示域）と有効値の間は必ず畳み直させる
		if (!(x > 0) || !(y > 0)) return false;
		return Math.abs(x - y) / Math.max(x, y) < CLUSTER_SCALE_EPSILON;
	};
	return near(a.latitudeDelta, b.latitudeDelta) && near(a.longitudeDelta, b.longitudeDelta);
}

/**
 * ピンを表示域に応じた近さで畳む。
 *
 * ## なぜ格子ではなく «近さ» なのか
 *
 * 最初は緯度経度を格子で割る実装にしたが、自分で書いたテストが即座に落ちた。
 * **セルの境目に載った 2 点は、何メートルしか離れていなくても別のセルに入る**
 * （139.7600 と 139.7602 が実際に割れた）。畳みたいのは «画面で重なって見えるもの» なので、
 * 判定も画面上の近さで行う。件数は API 側で切られているので、
 * 貪欲法（各ピンを既存クラスタの中心と比べる）で足りる。
 *
 * 入力順に走るため、同じ入力なら必ず同じ結果になる（マーカーの並びが取得のたびに
 * 入れ替わらない）。表示域が不正（delta が 0 以下）なら畳まず 1 件ずつ返す。
 *
 * @param maxRendered 同時に描くマーカーの上限（既定 `MAX_RENDERED_CLUSTERS`）
 */
export function clusterMapPins<T extends MapPinLike>(
	pins: readonly T[],
	region: ClusterViewport | null,
	{ maxRendered = MAX_RENDERED_CLUSTERS }: { maxRendered?: number } = {},
): MapPinCluster<T>[] {
	const finite = pins.filter(
		(pin) => Number.isFinite(pin.restaurant.latitude) && Number.isFinite(pin.restaurant.longitude),
	);
	// #1375 表示域の外のピンは «マーカーにしない»。中心を持たない呼び出し（既存のテスト等）は素通し
	const valid = cullPinsToViewport(finite, region);

	const single = (pin: T): MapPinCluster<T> => ({
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

	const clusters: MapPinCluster<T>[] = [];
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
	return capClusters(clusters, region, maxRendered);
}

/**
 * 表示域（+ 余白）の外のピンを落とす。中心を持たない表示域なら何もしない。
 *
 * 経度の日付変更線またぎは考慮していない。このアプリの地図は
 * ユーザーが手で動かした範囲しか扱わず、またいだ場合は «その回だけ片側が消える» に留まる
 * （落ちも壊れもしない）ので、複雑さに見合わないと判断した。
 */
export function cullPinsToViewport<T extends MapPinLike>(pins: readonly T[], region: ClusterViewport | null): T[] {
	if (!region) return [...pins];
	const { latitude, longitude, latitudeDelta, longitudeDelta } = region;
	if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return [...pins];
	if (!(latitudeDelta > 0) || !(longitudeDelta > 0)) return [...pins];
	const halfLat = (latitudeDelta * VIEWPORT_CULL_MARGIN) / 2;
	const halfLng = (longitudeDelta * VIEWPORT_CULL_MARGIN) / 2;
	return pins.filter(
		(pin) =>
			Math.abs(pin.restaurant.latitude - (latitude as number)) <= halfLat &&
			Math.abs(pin.restaurant.longitude - (longitude as number)) <= halfLng,
	);
}

/**
 * 畳んだあとの丸を `maxRendered` 件まで切る。**中心に近い順に残す。**
 *
 * 間引き（`cullPinsToViewport`）を通しても、密集した都心をズームアウトで見ると
 * 上限を超えることがある。そこで最後に «描く数» そのものを締める。
 */
export function capClusters<T extends MapPinLike>(
	clusters: MapPinCluster<T>[],
	region: ClusterViewport | null,
	maxRendered: number = MAX_RENDERED_CLUSTERS,
): MapPinCluster<T>[] {
	if (clusters.length <= maxRendered) return clusters;
	const latitude = region?.latitude;
	const longitude = region?.longitude;
	if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
		return clusters.slice(0, maxRendered);
	}
	// 近い順に選ぶが、**返す並びは元の順序に戻す**（マーカーの並びが操作のたびに
	// 入れ替わると、React の再利用が効かず作り直しになる）
	const byDistance = clusters
		.map((cluster, index) => {
			const dLat = cluster.latitude - (latitude as number);
			const dLng = cluster.longitude - (longitude as number);
			return { index, distance: dLat * dLat + dLng * dLng };
		})
		.sort((a, b) => a.distance - b.distance)
		.slice(0, maxRendered)
		.map((entry) => entry.index)
		.sort((a, b) => a - b);
	return byDistance.map((index) => clusters[index]);
}

/**
 * クラスタを押したときに寄る表示域。
 *
 * 含まれるピンの外接矩形へ寄せる。全部が同じ座標（同居ビルの店など）だと
 * delta が 0 になって «無限に寄る» ので、下限を設けて必ず有限の矩形にする。
 */
export const CLUSTER_ZOOM_MIN_DELTA = 0.002;

export function regionForCluster<T extends MapPinLike>(cluster: MapPinCluster<T>): Region {
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
