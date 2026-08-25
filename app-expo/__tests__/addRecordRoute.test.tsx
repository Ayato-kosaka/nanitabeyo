/*
#1400（親 #1375）取り込み確認ルート（`app/[locale]/sns-import.tsx`）の 3 状態を固定する。

## 何を守っているか
- **黙って落とさない**: 対応していない URL・URL ですらないテキスト・url パラメータ無しのいずれでも、
  «対応しているのは TikTok / YouTube Shorts / Instagram» を出す（設計 §3 の縮退表）
- **短縮 URL を «非対応» と言わない**: TikTok アプリの共有ボタンが出すのは `vm.tiktok.com/...` なので、
  ここを混ぜると TikTok の主要導線が丸ごと壊れて見える
- **BlurModal を使っていない**: `Portal.Host` が `<Stack>` を包んでいるためオーバーレイは遷移先の下に潜る
  （#1364）。`__tests__/myDishesFiltersRoute.test.tsx` と同じ形で「Portal を描かない」ことを固定する。
  「そもそも import しないこと」は `scripts/assert-legacy-blur-modal-boundary.mjs` が受け持つ。2 つで 1 組

`app/` 配下に置いたテストは expo-router がルートとして拾ってしまうため、ここに置いている。
*/
import React, { act } from "react";
import TestRenderer from "react-test-renderer";

const mockBack = jest.fn();
const mockPush = jest.fn();
/**
 * `useFocusEffect` に渡された最新のコールバック。
 * 「別画面へ行って戻ってきた」を再現するために、テストから明示的に呼ぶ。
 */
const mockFocusEffects: { current: (() => void | (() => void)) | null } = { current: null };
const mockReplace = jest.fn();
let mockCanGoBack = true;
let mockParams: { locale: string; url?: string } = { locale: "ja-JP" };

jest.mock("expo-router", () => {
	const stub = {
		push: (href: unknown) => mockPush(href),
		replace: (href: string) => mockReplace(href),
		back: () => mockBack(),
		canGoBack: () => mockCanGoBack,
	};
	return {
		router: stub,
		useRouter: () => stub,
		useLocalSearchParams: () => mockParams,
		useGlobalSearchParams: () => mockParams,
		// #1375 実機確認: 画面が «地図で選んだお店» を focus 時に受け取るようになったので、
		// このスタブにも `useFocusEffect` が要る。React の `useEffect` と同じ意味で十分
		// （このテストにナビゲーションの出入りは無い）
		useFocusEffect: (effect: () => void | (() => void)) => {
			mockFocusEffects.current = effect;
			// eslint-disable-next-line react-hooks/rules-of-hooks
			require("react").useEffect(effect, [effect]);
		},
	};
});

jest.mock("@/hooks/useLocale", () => ({ useLocale: () => ({ locale: "ja-JP", isJapanese: true }) }));

// #1375（3 巡目）「食べたを記録」タブが ReviewForm を内包するようになった。
// ReviewForm 自体の挙動は features/map/components/ReviewForm.test.tsx が固定しているので、
// この suite ではフォームを持つこと（お店を選ぶまで描かれないこと）だけを見る。
// 実体を読み込むと expo-video など native 依存が jest で解決できない
jest.mock("@/features/map/components/ReviewForm", () => ({
	ReviewForm: () => {
		const { View } = require("react-native");
		return <View testID="sns-import-eaten-review-form" />;
	},
}));
jest.mock("@/hooks/useHaptics", () => ({ useHaptics: () => ({ lightImpact: jest.fn(), mediumImpact: jest.fn() }) }));
jest.mock("@/hooks/useLogger", () => ({ useLogger: () => ({ logFrontendEvent: jest.fn() }) }));
jest.mock("@/hooks/useScreenTrace", () => ({ useScreenTrace: () => {} }));
// #1399 取り込みの保存が入ったので、この画面は API 呼び出しと認証状態を読む。
// 実 supabase クライアントを触らせないため、ここで差し替える
const mockCallBackend = jest.fn();
jest.mock("@/hooks/useAPICall", () => ({ useAPICall: () => ({ callBackend: mockCallBackend }) }));
jest.mock("@/contexts/SnackbarProvider", () => ({ useSnackbar: () => ({ showSnackbar: jest.fn() }) }));
jest.mock("@/contexts/AuthProvider", () => ({ useAuth: () => ({ user: { is_anonymous: false } }) }));
// #1375 実機確認の回帰: 現在地が取れる前提で «エリアを付けて resolve を叩く» ことを見る
jest.mock("@/hooks/useCurrentLocationPosition", () => ({
	getCurrentLocationPosition: () => Promise.resolve({ latitude: 35.68, longitude: 139.76 }),
}));
jest.mock("@/hooks/useDishCategorySearch", () => ({
	useDishCategorySearch: () => ({ suggestions: [], isSearching: false, searchDishCategories: jest.fn() }),
}));
jest.mock("@/features/restaurantPicker/components/RestaurantNameSearch", () => {
	const ReactActual = jest.requireActual("react");
	const { View: RNView } = jest.requireActual("react-native");
	// 中身は専用 suite（selectRestaurantNameSearch.test.tsx）が見る。
	// ここでは «画面に置かれているか» と «画面から渡している契約» だけを見たいので、
	// #1375 5 巡目で店選択がこの部品へ畳まれた分（地図アイコン・確定名）を器の上に出す
	return {
		RestaurantNameSearch: ({
			testID,
			mapAction,
			selectedName,
		}: {
			testID?: string;
			mapAction?: { onPress: () => void; testID?: string };
			selectedName?: string | null;
		}) =>
			ReactActual.createElement(
				RNView,
				{ testID },
				mapAction ? ReactActual.createElement(RNView, { testID: mapAction.testID, onPress: mapAction.onPress }) : null,
				selectedName
					? ReactActual.createElement(RNView, { testID: "sns-import-selected-restaurant", "data-name": selectedName })
					: null,
			),
	};
});
jest.mock("@/lib/i18n", () => ({ __esModule: true, default: { t: (key: string) => key } }));
jest.mock("lucide-react-native", () => new Proxy({}, { get: () => () => null }));
jest.mock("react-native-safe-area-context", () => {
	const ReactActual = jest.requireActual("react");
	const { View: RNView } = jest.requireActual("react-native");
	return {
		useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
		useSafeAreaFrame: () => ({ x: 0, y: 0, width: 390, height: 800 }),
		// #1375 `edges` を検証できるよう、そのまま props として通す
		SafeAreaView: ({ children, testID, edges }: { children: React.ReactNode; testID?: string; edges?: string[] }) =>
			ReactActual.createElement(RNView, { testID, edges }, children),
	};
});

/** `<Portal>` のスタブ。描かれたこと «自体» が検証対象（myDishesFiltersRoute.test.tsx と同じ形） */
const mockPortal = jest.fn();
jest.mock("react-native-paper", () => ({
	...jest.requireActual("react-native-paper"),
	Portal: ({ children }: { children?: unknown }) => {
		mockPortal();
		return children ?? null;
	},
}));

import SnsImportScreen from "../app/[locale]/add-record";
import { usePickedRestaurantStore } from "../features/restaurantPicker/stores/usePickedRestaurantStore";
import { useMyDishesRevisionStore } from "../features/myDishes/stores/useMyDishesRevisionStore";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TIKTOK_POST_URL = "https://www.tiktok.com/@cookpad/video/7261234567890123456";
const TIKTOK_SHORT_URL = "https://vm.tiktok.com/ZGeAbCdEf/";
const YOUTUBE_SHORTS_URL = "https://www.youtube.com/shorts/dQw4w9WgXcQ";
const INSTAGRAM_REEL_URL = "https://www.instagram.com/reel/Cabcdefghij/";

const mountedTrees: TestRenderer.ReactTestRenderer[] = [];

const render = async (url?: string) => {
	mockParams = { locale: "ja-JP", ...(url === undefined ? {} : { url }) };
	let tree!: TestRenderer.ReactTestRenderer;
	await act(async () => {
		tree = TestRenderer.create(<SnsImportScreen />);
	});
	mountedTrees.push(tree);
	return tree;
};

/** ⚠️ findAll は composite と host の両方に当たるため «件数» では数えない。存在判定に使う */
const has = (tree: TestRenderer.ReactTestRenderer, testID: string): boolean =>
	tree.root.findAll((node) => node.props?.testID === testID, { deep: true }).length > 0;

const textsOf = (tree: TestRenderer.ReactTestRenderer, testID: string): string[] =>
	tree.root
		.findAll((node) => node.props?.testID === testID, { deep: true })
		.flatMap((node) => (Array.isArray(node.props.children) ? node.props.children : [node.props.children]))
		.filter((child): child is string => typeof child === "string");

afterEach(() => {
	mountedTrees.splice(0).forEach((tree) => {
		act(() => {
			tree.unmount();
		});
	});
	mockCanGoBack = true;
	mockPush.mockClear();
});

describe("貼り付け欄（#1375 実機確認: ＋ の基本導線）", () => {
	// 共有からの着地（`?url=`）でも、＋ から開いた «url 無し» でも、同じ 1 本の入力欄で扱う
	it.each([
		["TikTok の投稿", TIKTOK_POST_URL],
		["YouTube Shorts", YOUTUBE_SHORTS_URL],
		["Instagram の reel", INSTAGRAM_REEL_URL],
	])("%s は共有された値が入力欄に入る", async (_label, url) => {
		const tree = await render(url);

		const input = tree.root.find((node) => node.props?.testID === "sns-import-url-input");
		expect(input.props.value).toBe(url);
		// 見た目の判定で «非対応» ではないので、そのヒントは出さない
		expect(has(tree, "sns-import-unsupported-description")).toBe(false);
	});

	it("url が無くても入力欄は出る（＋ から開いた場合）", async () => {
		const tree = await render(undefined);

		const input = tree.root.find((node) => node.props?.testID === "sns-import-url-input");
		expect(input.props.value).toBe("");
		// 空欄の段階で «非対応» と言わない（まだ何も貼られていないだけである）
		expect(has(tree, "sns-import-unsupported-description")).toBe(false);
		// 貼る前は読み取りボタンを押させない
		expect(tree.root.find((node) => node.props?.testID === "sns-import-resolve-button").props.disabled).toBe(true);
	});
});

describe("短縮 URL（kind: shortlink）", () => {
	it("«非対応» ではなく «展開は準備中» として受ける", async () => {
		const tree = await render(TIKTOK_SHORT_URL);

		expect(has(tree, "sns-import-expand-pending")).toBe(true);
		expect(has(tree, "sns-import-unsupported-description")).toBe(false);
	});
});

describe("対象外（null）", () => {
	it.each([
		["X の投稿", "https://x.com/someone/status/1234567890"],
		["ブログ", "https://example.com/blog/ramen"],
		["URL ですらないテキスト", "この店おいしかった"],
		["Instagram のストーリー（未対応の形）", "https://www.instagram.com/stories/someone/1234567890/"],
	])("%s は専用の文言を出す", async (_label, url) => {
		const tree = await render(url);

		expect(textsOf(tree, "sns-import-unsupported-description")).toContain("SnsImport.unsupported.description");
	});
});

describe("戻る導線", () => {
	it("履歴があれば戻る", async () => {
		const tree = await render(TIKTOK_POST_URL);

		await act(async () => {
			await tree.root.find((node) => node.props?.testID === "sns-import-screen-back").props.onPress();
		});

		expect(mockBack).toHaveBeenCalled();
		expect(mockReplace).not.toHaveBeenCalled();
	});

	// 共有からの着地は履歴を持たないことがある（コールドスタート / ログイン往復の replace）
	it("履歴が無ければ my-dishes へ倒す（行き止まりにしない）", async () => {
		mockCanGoBack = false;
		const tree = await render(TIKTOK_POST_URL);

		await act(async () => {
			await tree.root.find((node) => node.props?.testID === "sns-import-screen-back").props.onPress();
		});

		expect(mockReplace).toHaveBeenCalledWith("/ja-JP/my-dishes");
	});
});

describe("BlurModal を使っていない（#1350 / #1364）", () => {
	it.each([
		["取り込み確認", TIKTOK_POST_URL],
		["展開準備中", TIKTOK_SHORT_URL],
		["対象外", "https://x.com/someone/status/1"],
	])("%s の状態で Portal を 1 つも描かない", async (_label, url) => {
		mockPortal.mockClear();
		await render(url);
		expect(mockPortal).not.toHaveBeenCalled();
	});
});

describe("8 ロケールの文言（parity テストは «キーがあること» しか見ない）", () => {
	const LOCALES = ["ja-JP", "en-US", "ko-KR", "zh-CN", "es-ES", "fr-FR", "hi-IN", "ar-SA"] as const;

	it.each(LOCALES)("%s は対応 provider を 3 つとも名指しする", (locale) => {
		const messages = require(`../locales/${locale}.json`) as {
			SnsImport: { unsupported: { description: string } };
		};
		const description = messages.SnsImport.unsupported.description;

		// 固有名詞は翻訳しない。ここが空だったり «TikTok» だけだったりすると、
		// ユーザーは何を共有すればよいか分からないまま共有し直すことになる
		expect(description).toContain("TikTok");
		expect(description).toContain("YouTube Shorts");
		expect(description).toContain("Instagram");
	});

	// #1399 保存が入り «準備中» の文言が消え、貼り付け欄・タブ・候補選択の文言が増えた。
	// 件数を数え続けるのは «文言が増えるたびに落ちるテスト» になるので、
	// «同じキー集合を 8 ロケールが持ち、値が空でない» を見る形へ変えた
	it.each(LOCALES)("%s は ja-JP と同じキーを持ち、値が空でない", (locale) => {
		const messages = require(`../locales/${locale}.json`) as { SnsImport: Record<string, unknown> };
		const flatten = (value: unknown): string[] =>
			typeof value === "string"
				? [value]
				: Object.values(value as Record<string, unknown>).flatMap((child) => flatten(child));

		const keysOf = (value: unknown, prefix = ""): string[] =>
			typeof value === "string"
				? [prefix]
				: Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
						keysOf(child, prefix ? `${prefix}.${key}` : key),
					);

		const base = require("../locales/ja-JP.json") as { SnsImport: Record<string, unknown> };
		expect(keysOf(messages.SnsImport).sort()).toEqual(keysOf(base.SnsImport).sort());

		const values = flatten(messages.SnsImport);
		values.forEach((value) => expect(value.trim().length).toBeGreaterThan(0));
	});
});

/*
#1375 実機確認の回帰テスト。

**候補が 1 件も出ず、保存に到達できない状態で出してしまった。** 原因は 2 つで、
どちらか片方だけ直しても «出せない» ままになる。

1. `resolve` は `lat` / `lng` / `radius` が揃ったときだけ店舗候補を探す
   （`dish-media-imports.service.ts` の `area_not_provided`）。エリアを送っていなかったので
   **店舗候補は構造的に必ず 0 件**だった
2. 候補からしか選べない UI だったので、候補 0 件 = 永久に保存不可だった。
   Instagram はサーバから取れるメタデータが無く候補 0 件が主要経路なので、
   **手入力へ縮退する口が無いこと自体が設計違反**である（「完全自動確定を前提にしない」）

ここではその 2 点を固定する。
*/
describe("#1375 取り込みは «候補ゼロでも保存に到達できる»", () => {
	it("resolve にはエリア（lat / lng / radius）を必ず付ける", async () => {
		mockCallBackend.mockResolvedValue({
			status: "ok",
			reason: "resolved",
			source: { provider: "tiktok", externalContentId: "1", canonicalUrl: "https://x", mediaIndex: null },
			metadata: { title: null, authorName: null, authorUrl: null, thumbnailUrl: null, extractedTexts: [] },
			candidates: { dishCategories: [], restaurants: [] },
			prefill: { dishCategoryId: null, restaurantId: null },
			restaurantSearch: { performed: true, reason: "searched", scannedCount: 0 },
		});

		const tree = await render();
		const input = tree.root.find((node) => node.props?.testID === "sns-import-url-input");
		await act(async () => {
			input.props.onChangeText("https://www.tiktok.com/@a/video/7412345678901234567");
		});
		const button = tree.root.find((node) => node.props?.testID === "sns-import-resolve-button");
		await act(async () => {
			await button.props.onPress();
		});

		const call = mockCallBackend.mock.calls.find(([path]) => path === "v1/dish-media/imports/resolve");
		expect(call).toBeDefined();
		// ⚠️ ここが欠けると店舗候補は **常に 0 件**になる
		expect(call?.[1].requestPayload).toMatchObject({ lat: 35.68, lng: 139.76, radius: expect.any(Number) });
	});

	it("候補が 0 件でも、手入力の口（料理カテゴリ検索・店名検索）が出る", async () => {
		mockCallBackend.mockResolvedValue({
			status: "unknown",
			reason: "metadata_provider_unsupported",
			source: { provider: "instagram", externalContentId: "1", canonicalUrl: "https://x", mediaIndex: null },
			metadata: { title: null, authorName: null, authorUrl: null, thumbnailUrl: null, extractedTexts: [] },
			candidates: { dishCategories: [], restaurants: [] },
			prefill: { dishCategoryId: null, restaurantId: null },
			restaurantSearch: { performed: false, reason: "no_extracted_text", scannedCount: 0 },
		});

		const tree = await render();
		const input = tree.root.find((node) => node.props?.testID === "sns-import-url-input");
		await act(async () => {
			input.props.onChangeText("https://www.instagram.com/reel/ABCdef12345/");
		});
		const button = tree.root.find((node) => node.props?.testID === "sns-import-resolve-button");
		await act(async () => {
			await button.props.onPress();
		});

		// 候補が 0 件でも «選ぶ手段» が画面に在ること。これが無いと保存へ到達できない
		expect(has(tree, "sns-import-dish-category-search-input")).toBe(true);
		expect(has(tree, "sns-import-restaurant-search")).toBe(true);
	});
});

/**
 * #1375 実機確認（2 巡目）: 「店舗検索してヒットしなかったら地図の店舗をタップ、とあるのに
 * その導線がない」への回帰テスト。
 *
 * 店名検索（自前 `restaurants`）が空振りしたときの案内文
 * （`SelectRestaurant.nameSearch.noResults`）は «地図の店舗をタップしてお店を登録してください»
 * と言っているのに、この画面には地図が無く、地図を持つルートへの入口も無かった。
 * ここで固定するのは 2 つ。
 *
 * 1. 地図へ行くボタンが **検索する前から** 出ていて、押すと地図ルートへ push される
 * 2. 地図で選んだ結果が focus 時に取り込まれ、選択済みとして表示される
 */
describe("#1375 店名検索が空振りしたときの «地図から探す»", () => {
	const resolveWithNoCandidates = async () => {
		mockCallBackend.mockResolvedValue({
			status: "unknown",
			reason: "metadata_provider_unsupported",
			source: { provider: "instagram", externalContentId: "1", canonicalUrl: "https://x", mediaIndex: null },
			metadata: { title: null, authorName: null, authorUrl: null, thumbnailUrl: null, extractedTexts: [] },
			candidates: { dishCategories: [], restaurants: [] },
			prefill: { dishCategoryId: null, restaurantId: null },
			restaurantSearch: { performed: false, reason: "no_extracted_text", scannedCount: 0 },
		});

		const tree = await render();
		const input = tree.root.find((node) => node.props?.testID === "sns-import-url-input");
		await act(async () => {
			input.props.onChangeText("https://www.instagram.com/reel/ABCdef12345/");
		});
		const button = tree.root.find((node) => node.props?.testID === "sns-import-resolve-button");
		await act(async () => {
			await button.props.onPress();
		});
		return tree;
	};

	it("「地図から探す」が出ていて、押すと地図ルートへ push される", async () => {
		const tree = await resolveWithNoCandidates();

		expect(has(tree, "sns-import-pick-on-map")).toBe(true);

		const mapButton = tree.root.find((node) => node.props?.testID === "sns-import-pick-on-map");
		await act(async () => {
			mapButton.props.onPress();
		});

		expect(mockPush).toHaveBeenCalledWith(
			expect.objectContaining({
				pathname: "/[locale]/pick-restaurant",
				params: expect.objectContaining({ mode: "pick" }),
			}),
		);
	});

	it("地図で選んだお店は、画面へ戻ったときに選択済みとして反映される", async () => {
		const tree = await resolveWithNoCandidates();
		// 読み取った直後は «選択中» が無い（この後の表示が focus で入ったものだと言い切るため）
		expect(has(tree, "sns-import-selected-restaurant")).toBe(false);

		// 地図ルートが結果を置いて `router.back()` した、の再現。
		// 戻り先（この画面）はマウントされたままなので、focus のたびに受け取りに行く
		usePickedRestaurantStore.getState().setPicked({ restaurantId: "r-1", name: "選んだ店" });
		await act(async () => {
			mockFocusEffects.current?.();
		});

		// ⚠️ 文言は i18n をキー返しにモックしてあるので «店名そのもの» は出ない。
		// ここで見たいのは「選択済みの行が立つこと」と「store が空になること」である
		expect(has(tree, "sns-import-selected-restaurant")).toBe(true);
		// 受け取ったら捨てる（次に開いたときに «前回の選択» が黙って復活しない）
		expect(usePickedRestaurantStore.getState().picked).toBeNull();
	});
});

/**
 * #1375（3 巡目）: 「食べたを記録」は **別画面へ push しない**。
 *
 * 以前は select-restaurant へ push しており、「閉じられない・戻ると検索へ飛ぶ・
 * ネイティブスタックが積み上がる」と実機で指摘された。タブの中の統合フォーム
 * （お店を選ぶ → ReviewForm）であることを固定する。
 */
describe("#1375 食べたを記録タブは画面内の統合フォーム", () => {
	it("タブを押しても push されず、フォームの器と「お店を選ぶ」が出る", async () => {
		const tree = await render();

		const eatenTab = tree.root.find((node) => node.props?.testID === "sns-import-tab-eaten");
		await act(async () => {
			eatenTab.props.onPress();
		});

		expect(mockPush).not.toHaveBeenCalled();
		expect(has(tree, "sns-import-eaten-form")).toBe(true);
		expect(has(tree, "sns-import-eaten-pick-restaurant")).toBe(true);
		// お店を選ぶまで ReviewForm は描かない
		expect(has(tree, "sns-import-eaten-review-form")).toBe(false);
	});

	it("「お店を選ぶ」は pick モードの地図へ push し、選んだお店で ReviewForm が出る", async () => {
		const tree = await render();
		await act(async () => {
			tree.root.find((node) => node.props?.testID === "sns-import-tab-eaten").props.onPress();
		});

		await act(async () => {
			tree.root.find((node) => node.props?.testID === "sns-import-eaten-pick-restaurant").props.onPress();
		});
		expect(mockPush).toHaveBeenCalledWith(
			expect.objectContaining({
				pathname: "/[locale]/pick-restaurant",
				params: expect.objectContaining({ mode: "pick" }),
			}),
		);

		// 地図側が picked を置いて back してきた、の再現（focus で受け取る）
		usePickedRestaurantStore.getState().setPicked({
			restaurantId: "r-1",
			name: "選んだ店",
			restaurant: { id: "r-1", name: "選んだ店" } as never,
		});
		await act(async () => {
			mockFocusEffects.current?.();
		});

		expect(has(tree, "sns-import-eaten-review-form")).toBe(true);
	});
});

/*
#1375 実機確認（5 巡目）: 「URL を読み取ったら編集不可。②以降はそこから出る。
キャンセルすると URL を直せる状態へ戻り、②以降の選択は捨てる」。

読み取った URL と ②③ の選択は 1 組である。片方だけ差し替えられると
「別の投稿の URL なのに、前の投稿で選んだ店と料理が付いたまま保存できる」状態を作れる。
*/
describe("#1375 読み取り後は URL を固定し、キャンセルで組ごと捨てる", () => {
	beforeEach(() => {
		jest.clearAllMocks();
		usePickedRestaurantStore.getState().consume();
	});

	const renderAndResolve = async (status: "ok" | "unsupported" = "ok") => {
		mockCallBackend.mockImplementation((path: string) => {
			if (path === "v1/dish-media/imports/resolve") {
				return Promise.resolve({
					status,
					reason: status === "ok" ? "resolved" : "unsupported_provider",
					source: { provider: "instagram", externalContentId: "abc", canonicalUrl: "https://x/", mediaIndex: null },
					metadata: { title: "キャプション", thumbnailUrl: null },
					candidates: { dishCategories: [], restaurants: [] },
					prefill: { dishCategoryId: null, restaurantId: null },
				});
			}
			return Promise.resolve({});
		});
		const tree = await render();
		const urlInput = tree.root.find((node) => node.props?.testID === "sns-import-url-input");
		await act(async () => {
			urlInput.props.onChangeText("https://www.instagram.com/reel/ABC/");
		});
		const button = tree.root.find((node) => node.props?.testID === "sns-import-resolve-button");
		await act(async () => {
			await button.props.onPress();
		});
		return tree;
	};

	it("読み取り前は ②以降も保存の帯も出さない", async () => {
		const tree = await render();
		const urlInput = tree.root.find((node) => node.props?.testID === "sns-import-url-input");
		await act(async () => {
			urlInput.props.onChangeText("https://www.instagram.com/reel/ABC/");
		});
		expect(has(tree, "sns-import-step-restaurant")).toBe(false);
		expect(has(tree, "sns-import-step-dish")).toBe(false);
		expect(has(tree, "sns-import-save-button")).toBe(false);
		// URL はこの時点では編集できる
		expect(urlInput.props.editable).toBe(true);
	});

	it("読み取りに成功すると URL が編集不可になり、②以降が出る", async () => {
		const tree = await renderAndResolve();
		const urlInput = tree.root.find((node) => node.props?.testID === "sns-import-url-input");
		expect(urlInput.props.editable).toBe(false);
		expect(has(tree, "sns-import-step-restaurant")).toBe(true);
		expect(has(tree, "sns-import-step-dish")).toBe(true);
		// «もう一度読み取る» ではなくキャンセルへ替わる
		expect(has(tree, "sns-import-resolve-button")).toBe(false);
		expect(has(tree, "sns-import-cancel-button")).toBe(true);
	});

	it("読み取れなかった URL は固定しない（直せる状態のまま）", async () => {
		const tree = await renderAndResolve("unsupported");
		const urlInput = tree.root.find((node) => node.props?.testID === "sns-import-url-input");
		expect(urlInput.props.editable).toBe(true);
		expect(has(tree, "sns-import-step-restaurant")).toBe(false);
		expect(has(tree, "sns-import-cancel-button")).toBe(false);
	});

	it("キャンセルすると URL を直せる状態へ戻り、②以降が消える", async () => {
		const tree = await renderAndResolve();
		const cancel = tree.root.find((node) => node.props?.testID === "sns-import-cancel-button");
		await act(async () => {
			cancel.props.onPress();
		});
		const urlInput = tree.root.find((node) => node.props?.testID === "sns-import-url-input");
		expect(urlInput.props.editable).toBe(true);
		// URL 自体は残す（打ち直しではなく «直す» ため）
		expect(urlInput.props.value).toBe("https://www.instagram.com/reel/ABC/");
		expect(has(tree, "sns-import-step-restaurant")).toBe(false);
		expect(has(tree, "sns-import-save-button")).toBe(false);
		expect(has(tree, "sns-import-resolve-button")).toBe(true);
	});
});

/*
#1375 実機確認（5 巡目）「店選択のコンポーネントを SNS と統一してほしい」。

«食べたを記録» タブの店選択は «行をタップして地図へ» という SNS 側（②）とは別の形だった。
同じ `RestaurantNameSearch` に揃え、確定名は入力欄の値・地図は右端のアイコンにする。
*/
describe("#1375 食べたを記録の店選択も SNS と同じ部品", () => {
	beforeEach(() => {
		jest.clearAllMocks();
		usePickedRestaurantStore.getState().consume();
	});

	const openEatenTab = async () => {
		const tree = await render();
		const tab = tree.root.find((node) => node.props?.testID === "sns-import-tab-eaten");
		await act(async () => {
			tab.props.onPress();
		});
		return tree;
	};

	it("店名検索の入力欄が置かれ、地図は入力欄の中のアイコンから開く", async () => {
		const tree = await openEatenTab();
		expect(has(tree, "sns-import-eaten-restaurant-search")).toBe(true);

		const mapButton = tree.root.find((node) => node.props?.testID === "sns-import-eaten-pick-restaurant");
		await act(async () => {
			mapButton.props.onPress();
		});
		expect(mockPush).toHaveBeenCalledWith(
			expect.objectContaining({
				pathname: "/[locale]/pick-restaurant",
				params: expect.objectContaining({ mode: "pick" }),
			}),
		);
	});

	it("地図で選んだお店は入力欄の値として出る（別の «選択中» 行を作らない）", async () => {
		const tree = await openEatenTab();
		usePickedRestaurantStore.getState().setPicked({
			restaurantId: "r-1",
			name: "選んだ店",
			restaurant: { id: "r-1", name: "選んだ店" } as never,
		});
		await act(async () => {
			mockFocusEffects.current?.();
		});
		// モックした RestaurantNameSearch は selectedName を受け取ると器を 1 つ出す
		expect(has(tree, "sns-import-selected-restaurant")).toBe(true);
	});
});

/*
#1375（実機 iOS のスクリーンショットで発覚）

**この画面はヘッダを持たないので、上端のセーフエリアを自分で確保しなければならない。**

このアプリで上端の余白を入れているのは `ScreenHeader`（`paddingTop: insets.top + 8`）で、
ヘッダを持つ画面が `edges={[]}` なのはそのためである。この画面は «ヘッダを出さない» と
決めた結果、その役目を引き継ぐものが無くなり、iOS でタブがダイナミックアイランドの下に
潜って読めなくなっていた（run 32818524649 の iOS スクリーンショットで実測）。

⚠️ ここが落ちたら、また上端が隠れている。
*/
describe("上端のセーフエリア", () => {
	it("ヘッダが無い画面なので、SafeAreaView が top を確保する", async () => {
		const tree = await render();
		const screen = tree.root.findAll((n) => n.props?.testID === "sns-import-screen")[0];
		expect(screen.props.edges).toContain("top");
	});
});

/*
#1375（9 巡目・オーナー指摘）**「インスタをインポートして食べたいを押したら、
メディアと料理が出ない」**の回帰テスト。

取り込み（`POST v1/dish-media/imports`）は `dish_media` と `reactions(save)` を
**サーバー側にだけ**足す。クライアントの一覧（`useMyDishesQuery`）は
`hasFetchedInitial` が立っている限り取り直さないので、`bumpMyDishesRevision()` で
キャッシュを捨てないと **戻った先の一覧に取り込んだものが 1 つも出ない**。

隣の «食べたを記録»（`handleEatenSuccess`）は最初からこれを呼んでいたが、
取り込み側だけ抜けていた。**このテストは修正前のコードでは落ちる**ことを確認済み。
*/
describe("#1375 取り込みの直後は my-dishes のキャッシュを捨てる", () => {
	beforeEach(() => {
		jest.clearAllMocks();
		mockCanGoBack = true;
	});

	it("「食べたいに保存」が成功したら版が上がる（＝一覧が取り直される）", async () => {
		mockCallBackend.mockImplementation((path: string) => {
			if (path === "v1/dish-media/imports/resolve") {
				return Promise.resolve({
					status: "ok",
					reason: "resolved",
					source: { provider: "instagram", externalContentId: "abc", canonicalUrl: "https://x/", mediaIndex: null },
					metadata: { title: "キャプション", thumbnailUrl: null },
					candidates: { dishCategories: [], restaurants: [] },
					prefill: { dishCategoryId: "Q1", restaurantId: "r-1" },
				});
			}
			// 取り込み本体
			return Promise.resolve({ dishMediaId: "dm-1", dishId: "d-1", created: true, saved: true });
		});

		const tree = await render();
		const urlInput = tree.root.find((node) => node.props?.testID === "sns-import-url-input");
		await act(async () => {
			urlInput.props.onChangeText("https://www.instagram.com/reel/ABC/");
		});
		await act(async () => {
			await tree.root.find((node) => node.props?.testID === "sns-import-resolve-button").props.onPress();
		});

		const before = useMyDishesRevisionStore.getState().revision;

		const save = tree.root.find(
			(node) => node.props?.testID === "sns-import-save-button" && typeof node.props?.onPress === "function",
		);
		await act(async () => {
			await save.props.onPress();
		});

		// 取り込み本体が呼ばれていること（前提の確認。ここが false ならテストの組み方が悪い）
		expect(mockCallBackend).toHaveBeenCalledWith("v1/dish-media/imports", expect.anything());
		// 本題: 版が上がっていること
		expect(useMyDishesRevisionStore.getState().revision).toBe(before + 1);
	});
});
