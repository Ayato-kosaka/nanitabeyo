import {
	MAX_AREA_RADIUS_M,
	METERS_PER_DEGREE_LATITUDE,
	MIN_AREA_RADIUS_M,
	regionToArea,
	type MapRegionLike,
} from "./geo";

/**
 * #1396 `Region` → `{lat, lng, radius}` の変換（設計書 (2/2) §3-2）。
 *
 * この関数は「このエリアで再検索」の押下時にだけ呼ばれ、結果が
 * `QueryMyDishesDto` の `lat` / `lng` / `radius` にそのまま乗る。
 * DTO は `radius` を `[10, 50000]`、`lat` を `[-90, 90]`、`lng` を `[-180, 180]` に
 * 制限しているため、範囲を外れた値を作らないことを固定する。
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

	it("地球全体を映した region でも上限 50000m を超えない", () => {
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
