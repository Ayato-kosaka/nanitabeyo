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
const mockReplace = jest.fn();
let mockCanGoBack = true;
let mockParams: { locale: string; url?: string } = { locale: "ja-JP" };

jest.mock("expo-router", () => {
	const stub = {
		push: () => {},
		replace: (href: string) => mockReplace(href),
		back: () => mockBack(),
		canGoBack: () => mockCanGoBack,
	};
	return {
		router: stub,
		useRouter: () => stub,
		useLocalSearchParams: () => mockParams,
		useGlobalSearchParams: () => mockParams,
	};
});

jest.mock("@/hooks/useLocale", () => ({ useLocale: () => ({ locale: "ja-JP", isJapanese: true }) }));
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
	// ここでは «画面に置かれているか» だけを見たいので testID を持つ器にする
	return {
		RestaurantNameSearch: ({ testID }: { testID?: string }) => ReactActual.createElement(RNView, { testID }),
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
		SafeAreaView: ({ children, testID }: { children: React.ReactNode; testID?: string }) =>
			ReactActual.createElement(RNView, { testID }, children),
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

import SnsImportScreen from "../app/[locale]/sns-import";

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
