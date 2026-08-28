import {
	MAX_AREA_RADIUS_M,
	METERS_PER_DEGREE_LATITUDE,
	MIN_AREA_RADIUS_M,
	boundingRegionForCoordinates,
	regionToArea,
	type MapRegionLike,
} from "./geo";

/**
 * #1396 `Region` → `{lat, lng, radius}` の変換（設計書 (2/2) §3-2）。
 *
 * この関数は「このエリアで再検索」の押下時にだけ呼ばれ、結果が
 * `QueryMyDishesDto` の `lat` / `lng` / `radius` にそのまま乗る。
 * DTO は `radius` を `[10, MAX_SEARCH_RADIUS_M]`、`lat` を `[-90, 90]`、`lng` を `[-180, 180]` に
 * 制限しているため、範囲を外れた値を作らないことを固定する（上限は #1629 で 50km から広げた）。
 */
describe("#1396 regionToArea", () => {
	const tokyo: MapRegionLike = {
		latitude: 35.681236,
		longitude: 139.767125,
		latitudeDelta: 0.02,
		longitudeDelta: 0.02,
	};

	it("中心座標をそのまま lat / lng として返す", () => {
		const area = regionToArea(tokyo);
		expect(area).not.toBeNull();
		expect(area?.lat).toBe(tokyo.latitude);
		expect(area?.lng).toBe(tokyo.longitude);
	});

	it("radius は viewport の対角線の半分（緯度方向のみの region で検算できる）", () => {
		// 経度方向の幅を 0 にすると、半径は「緯度方向の幅 / 2」になる
		const area = regionToArea({ latitude: 0, longitude: 0, latitudeDelta: 0.1, longitudeDelta: 0 });
		expect(area?.radius).toBe(Math.round((0.1 * METERS_PER_DEGREE_LATITUDE) / 2));
	});

	it("経度方向の幅は緯度によって縮む（同じ delta でも高緯度の方が半径が小さい）", () => {
		const equator = regionToArea({ latitude: 0, longitude: 0, latitudeDelta: 0, longitudeDelta: 0.5 });
		const highLatitude = regionToArea({ latitude: 60, longitude: 0, latitudeDelta: 0, longitudeDelta: 0.5 });
		expect(equator?.radius).toBeGreaterThan(highLatitude?.radius ?? 0);
		// cos(60°) = 0.5 なので、およそ半分になる
		expect(highLatitude?.radius).toBe(Math.round(((equator?.radius ?? 0) * Math.cos(Math.PI / 3)) / 1));
	});

	it("ズームインし切った極小の region でも下限 10m を下回らない", () => {
		const area = regionToArea({ latitude: 35, longitude: 139, latitudeDelta: 1e-8, longitudeDelta: 1e-8 });
		expect(area?.radius).toBe(MIN_AREA_RADIUS_M);
	});

	it("地球全体を映した region でも上限（MAX_AREA_RADIUS_M）を超えない", () => {
		const area = regionToArea({ latitude: 0, longitude: 0, latitudeDelta: 180, longitudeDelta: 360 });
		expect(area?.radius).toBe(MAX_AREA_RADIUS_M);
	});

	it("負の delta は絶対値として扱う（半径を負にしない）", () => {
		const positive = regionToArea({ latitude: 10, longitude: 20, latitudeDelta: 0.3, longitudeDelta: 0.4 });
		const negative = regionToArea({ latitude: 10, longitude: 20, latitudeDelta: -0.3, longitudeDelta: -0.4 });
		expect(negative).toEqual(positive);
	});

	it("範囲外の緯度経度は DTO の許容範囲へ clamp する", () => {
		const area = regionToArea({ latitude: 120, longitude: -400, latitudeDelta: 0.1, longitudeDelta: 0.1 });
		expect(area?.lat).toBe(90);
		expect(area?.lng).toBe(-180);
	});

	it("NaN / Infinity を含む region は null を返す（不正な値を API へ送らない）", () => {
		const base = { latitude: 35, longitude: 139, latitudeDelta: 0.1, longitudeDelta: 0.1 };
		expect(regionToArea({ ...base, latitude: NaN })).toBeNull();
		expect(regionToArea({ ...base, longitude: Infinity })).toBeNull();
		expect(regionToArea({ ...base, latitudeDelta: NaN })).toBeNull();
		expect(regionToArea({ ...base, longitudeDelta: -Infinity })).toBeNull();
	});

	it("null / undefined は null を返す（Map が初期化される前に呼ばれても落ちない）", () => {
		expect(regionToArea(null)).toBeNull();
		expect(regionToArea(undefined)).toBeNull();
	});

	it("戻り値は常に DTO の許容範囲に収まる", () => {
		const regions: MapRegionLike[] = [
			{ latitude: 0, longitude: 0, latitudeDelta: 0, longitudeDelta: 0 },
			{ latitude: -89.9, longitude: 179.9, latitudeDelta: 0.0001, longitudeDelta: 0.0001 },
			{ latitude: 35.68, longitude: 139.76, latitudeDelta: 0.02, longitudeDelta: 0.01 },
			{ latitude: 70, longitude: -120, latitudeDelta: 5, longitudeDelta: 5 },
			{ latitude: 0, longitude: 0, latitudeDelta: 180, longitudeDelta: 360 },
		];
		for (const region of regions) {
			const area = regionToArea(region);
			expect(area).not.toBeNull();
			expect(area!.lat).toBeGreaterThanOrEqual(-90);
			expect(area!.lat).toBeLessThanOrEqual(90);
			expect(area!.lng).toBeGreaterThanOrEqual(-180);
			expect(area!.lng).toBeLessThanOrEqual(180);
			expect(area!.radius).toBeGreaterThanOrEqual(MIN_AREA_RADIUS_M);
			expect(area!.radius).toBeLessThanOrEqual(MAX_AREA_RADIUS_M);
			expect(Number.isInteger(area!.radius)).toBe(true);
		}
	});
});

/**
 * #1629 **«引いた状態» で検索が成立することを固定する回帰テスト。**
 *
 * オーナー報告:「日本全体を映して『このエリアで再検索』を押すと必ず 0 件になる」。
 * 原因は `regionToArea` が半径を 50km へ clamp していたことで、日本全体を映すと
 * «日本の中心（長野の山中）から 50km» の円しか検索していなかった。東京の記録は
 * 中心から約 200km 離れているので、構造的に 1 件も入らない。
 *
 * ⚠️ **このテストは修正前のコードで赤くなる**（radius = 50,000 < 約 200,000）。
 *    半径の上限を戻したら、ここが «日本全体で 0 件» を再び教えてくれる。
 */
describe("#1629 引き（日本全体）でも、見えている範囲がそのまま半径になる", () => {
	/** `features/map/constants.ts` の `REGION_JP`（位置情報が取れないときの初期表示） */
	const REGION_JP: MapRegionLike = {
		latitude: 36.2048,
		longitude: 138.2529,
		latitudeDelta: 20,
		longitudeDelta: 20,
	};
	const TOKYO = { latitude: 35.681236, longitude: 139.767125 };
	const OSAKA = { latitude: 34.6937, longitude: 135.5023 };
	const SAPPORO = { latitude: 43.0618, longitude: 141.3545 };
	const FUKUOKA = { latitude: 33.5904, longitude: 130.4017 };

	/** 2 点間の距離（m）。球面（半径 6,371km）で十分 */
	const distanceMeters = (a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) => {
		const toRad = (deg: number) => (deg * Math.PI) / 180;
		const dLat = toRad(b.latitude - a.latitude);
		const dLng = toRad(b.longitude - a.longitude);
		const h =
			Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;
		return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
	};

	it("日本全体の viewport から確定する円に、東京・大阪が入る（＝ 0 件にならない）", () => {
		const area = regionToArea(REGION_JP);
		expect(area).not.toBeNull();
		expect(area!.radius).toBeGreaterThan(distanceMeters(REGION_JP, TOKYO));
		expect(area!.radius).toBeGreaterThan(distanceMeters(REGION_JP, OSAKA));
	});

	it("札幌・福岡も入る（本土が収まるスケール）", () => {
		const area = regionToArea(REGION_JP);
		expect(area!.radius).toBeGreaterThan(distanceMeters(REGION_JP, SAPPORO));
		expect(area!.radius).toBeGreaterThan(distanceMeters(REGION_JP, FUKUOKA));
	});

	it("50km で頭打ちにしない（引いた分だけ広く探す）", () => {
		const area = regionToArea(REGION_JP);
		expect(area!.radius).toBeGreaterThan(50_000);
	});
});

/**
 * #1396 m-1: 取得したピンの外接矩形へ寄せるための region 計算。
 */
describe("#1396 boundingRegionForCoordinates", () => {
	it("座標が 0 件なら null を返す", () => {
		expect(boundingRegionForCoordinates([])).toBeNull();
	});

	it("複数座標の中心を latitude/longitude として返す", () => {
		const region = boundingRegionForCoordinates([
			{ latitude: 35.0, longitude: 139.0 },
			{ latitude: 36.0, longitude: 140.0 },
		]);
		expect(region?.latitude).toBeCloseTo(35.5);
		expect(region?.longitude).toBeCloseTo(139.5);
	});

	it("単一座標でも delta が 0 にならない（最低幅を確保する）", () => {
		const region = boundingRegionForCoordinates([{ latitude: 35.0, longitude: 139.0 }]);
		expect(region?.latitudeDelta).toBeGreaterThan(0);
		expect(region?.longitudeDelta).toBeGreaterThan(0);
	});

	it("座標の広がりに応じて delta が広がる（余白込み）", () => {
		const narrow = boundingRegionForCoordinates([
			{ latitude: 35.0, longitude: 139.0 },
			{ latitude: 35.01, longitude: 139.01 },
		]);
		const wide = boundingRegionForCoordinates([
			{ latitude: 30.0, longitude: 130.0 },
			{ latitude: 40.0, longitude: 145.0 },
		]);
		expect(wide!.latitudeDelta).toBeGreaterThan(narrow!.latitudeDelta);
		expect(wide!.longitudeDelta).toBeGreaterThan(narrow!.longitudeDelta);
	});
});
