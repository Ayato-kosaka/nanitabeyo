import { act } from "react";
import TestRenderer from "react-test-renderer";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRecentLocations, type RecentLocation } from "./useRecentLocations";

/**
 * #1129 の感度テスト: **「最近使った場所」は MRU(Most Recently Used)順であること**。
 *
 * 「渋谷駅前おおしま皮膚科 / 渋谷駅」の順で並んでいるときに「渋谷駅」を選び直したら
 * 「渋谷駅 / 渋谷駅前おおしま皮膚科」になってほしい、という Issue の要求を固定する。
 * 先頭移動そのものは `addRecentLocation` が担っており、リストからの再選択でも
 * このフックを通ることが前提になる（呼ばれなければ順序は永遠に変わらない）。
 *
 * 併せて #953 の不変条件（重複しない・最大5件・AsyncStorage へ永続化）も固定する。
 *
 * ## ⚠️ なぜ `useRecentLocations.test.tsx` と別ファイルなのか
 * 隣の #1196 のテストは `jest.mock("@react-native-async-storage/async-storage")` で
 * AsyncStorage 自体をスタブへ置き換え、`getItem` の戻り値を 1 ケースずつ差し込む。
 * 一方こちらは **jest.setup.js のインメモリ実装に実際に読み書きさせて**、
 * 「並び替えた結果が本当に永続化されるか」を見ている。
 *
 * `jest.mock` はファイル単位で効くため、同居させるとこちらの永続化検証が
 * 「常に undefined を返すスタブ」を相手にすることになり、**意味を失ったまま緑になる**。
 * 統合せず分けているのは、この 2 つが «同じ対象の別の見方» だからではなく、
 * **モックの粒度が排他だから**である。片方へ寄せないこと。
 */

const STORAGE_KEY = "recent_locations_v1";

/** 表示名と座標だけ変えた RecentLocation を作る。他フィールドは #953 の保存形式そのまま */
const makeLocation = (locationQuery: string, latitude: number, longitude: number): RecentLocation => ({
	location: { latitude, longitude },
	address: "country:JP, locality:Tokyo",
	localLanguageCode: "ja",
	locationQuery,
});

const shibuyaStation = makeLocation("渋谷駅", 35.658, 139.7016);
const oshimaClinic = makeLocation("渋谷駅前おおしま皮膚科", 35.6591, 139.7023);

describe("#1129 最近使った場所は MRU 順に並ぶ", () => {
	let renderer: TestRenderer.ReactTestRenderer;
	let hookRef: ReturnType<typeof useRecentLocations>;

	const Probe = () => {
		hookRef = useRecentLocations();
		return null;
	};

	/** マウントし、AsyncStorage からの初期ロード完了まで待つ */
	const mount = async () => {
		await act(async () => {
			renderer = TestRenderer.create(<Probe />);
		});
	};

	const add = async (location: RecentLocation) => {
		await act(async () => {
			await hookRef.addRecentLocation(location);
		});
	};

	/** 実際に AsyncStorage へ書かれた内容を読み戻す（永続化の検証用） */
	const readPersisted = async (): Promise<RecentLocation[]> => {
		const raw = await AsyncStorage.getItem(STORAGE_KEY);
		return raw ? (JSON.parse(raw) as RecentLocation[]) : [];
	};

	beforeEach(async () => {
		(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
		// jest.setup.js のインメモリ実装は suite 内で状態を共有するため、毎回消す
		await AsyncStorage.clear();
	});

	it("既存の地点を再選択すると先頭へ移動し、件数は変わらない", async () => {
		await mount();
		// Issue の再現状況: 上から「渋谷駅前おおしま皮膚科」「渋谷駅」
		await add(shibuyaStation);
		await add(oshimaClinic);
		expect(hookRef.recentLocations.map((entry) => entry.locationQuery)).toEqual(["渋谷駅前おおしま皮膚科", "渋谷駅"]);

		// 「渋谷駅」を選び直す = リストに載っているものと同一の値が渡ってくる
		await add(shibuyaStation);

		expect(hookRef.recentLocations.map((entry) => entry.locationQuery)).toEqual(["渋谷駅", "渋谷駅前おおしま皮膚科"]);
		// 件数が増えない = 座標一致の dedupe が効いている
		expect(hookRef.recentLocations).toHaveLength(2);
	});

	it("再選択後の並び順も AsyncStorage へ永続化される", async () => {
		await mount();
		await add(shibuyaStation);
		await add(oshimaClinic);
		await add(shibuyaStation);

		expect((await readPersisted()).map((entry) => entry.locationQuery)).toEqual(["渋谷駅", "渋谷駅前おおしま皮膚科"]);
	});

	it("新規地点は先頭へ入り、5件を超えた分は古い順に捨てられる", async () => {
		await mount();
		for (let i = 1; i <= 6; i++) {
			await add(makeLocation(`地点${i}`, 35 + i * 0.01, 139 + i * 0.01));
		}

		// 直近5件が新しい順。最も古い「地点1」だけが落ちる
		expect(hookRef.recentLocations.map((entry) => entry.locationQuery)).toEqual([
			"地点6",
			"地点5",
			"地点4",
			"地点3",
			"地点2",
		]);
		expect(await readPersisted()).toHaveLength(5);
	});

	it("上限まで埋まった状態で最古の地点を再選択しても、押し出されず先頭へ来る", async () => {
		await mount();
		const oldest = makeLocation("最古の地点", 35.1, 139.1);
		await add(oldest);
		for (let i = 2; i <= 5; i++) {
			await add(makeLocation(`地点${i}`, 35 + i * 0.01, 139 + i * 0.01));
		}
		expect(hookRef.recentLocations).toHaveLength(5);

		await add(oldest);

		expect(hookRef.recentLocations[0].locationQuery).toBe("最古の地点");
		expect(hookRef.recentLocations).toHaveLength(5);
	});

	it("保存済みの並びをマウント時に復元する", async () => {
		await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([oshimaClinic, shibuyaStation]));

		await mount();

		expect(hookRef.isLoading).toBe(false);
		expect(hookRef.recentLocations.map((entry) => entry.locationQuery)).toEqual(["渋谷駅前おおしま皮膚科", "渋谷駅"]);
	});

	afterEach(async () => {
		await act(async () => {
			renderer?.unmount();
		});
	});
});
