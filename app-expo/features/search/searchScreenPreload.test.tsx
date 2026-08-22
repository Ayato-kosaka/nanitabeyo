// #1087 【設計】検索画面の「オフスクリーン先読みブロック」のサイズが非ゼロであることを守るテスト。
//
// 背景: 先読みブロック(app/[locale]/(tabs)/search/index.tsx 末尾)は導入時(#656)から
// `width: 0, height: 0` で描かれていた。expo-image のネイティブ実装は
//   - iOS   : ImageUtils.getBestSource() が `size.width <= 0 || size.height <= 0` で nil を返し、
//             ImageView.reload() が `guard let source = bestSource else { return }` で抜ける
//   - Android: ExpoImageViewWrapper.cleanIfNeeded() が `width == 0 || height == 0` で
//             Glide リクエストを発行せず return する
// ため、native では 1 枚もロードされていなかった(web は size に関係なく <img src> を出すので効いていた)。
//
// この 0×0 への逆戻りは web の E2E では検知できない(web は 0×0 でも fetch する)ため、
// 再発を捕まえられる自動テストはここだけ。サイズを 0 に戻すとこのテストが赤になる。
import React from "react";
import { StyleSheet, View } from "react-native";
import TestRenderer, { type ReactTestInstance } from "react-test-renderer";

import { PRELOAD_IMAGES } from "@/features/search/constants";

// 先読みブロックへ渡る props だけを観測したいので expo-image はスタブに差し替える
// (ネイティブモジュールを持ち込まないためでもある)
jest.mock("expo-image", () => ({
	Image: function MockExpoImage() {
		return null;
	},
}));

// 画面本体の JSX(= 検証対象)だけを描画したいので、周辺の依存はすべてスタブ化する
// (lucide のアイコンは名前ごとに export されるため Proxy で一括スタブ化する)
jest.mock(
	"lucide-react-native",
	() =>
		new Proxy(
			{},
			{
				get: (_target, prop) =>
					prop === "__esModule"
						? true
						: function MockIcon() {
								return null;
							},
			},
		),
);
jest.mock("expo-router", () => ({ router: { push: jest.fn(), replace: jest.fn() } }));
jest.mock("@react-navigation/native", () => ({ useIsFocused: () => true }));
jest.mock("react-native-safe-area-context", () => {
	const { View: RNView } = require("react-native");
	return { SafeAreaView: RNView };
});
jest.mock("@/lib/i18n", () => ({ __esModule: true, default: { t: (key: string) => key } }));
jest.mock("@/hooks/useLocale", () => ({ useLocale: () => ({ locale: "ja-JP", isJapanese: true }) }));
jest.mock("@/hooks/useHaptics", () => ({ useHaptics: () => ({ lightImpact: jest.fn(), mediumImpact: jest.fn() }) }));
jest.mock("@/hooks/useLogger", () => ({ useLogger: () => ({ logFrontendEvent: jest.fn() }) }));
jest.mock("@/hooks/useScreenTrace", () => ({ useScreenTrace: jest.fn() }));
jest.mock("@/hooks/useContentWidth", () => ({ useContentWidth: () => 390 }));
// #1127 検索画面は useAutoCurrentLocation(#1092 PR4b で追加) 経由で AuthProvider → lib/supabase →
// constants/Env を読み込む。jest では app.config.ts(動的 config)が評価されず
// `Constants.expoConfig.extra` が undefined になるため、Env.ts:16 の `extra.eas.projectId` で
// suite ごと落ちていた。useAutoCurrentLocation.test.tsx と同じく AuthProvider をスタブ化して断ち切る。
jest.mock("@/contexts/AuthProvider", () => ({ useAuth: () => ({ user: null }) }));
jest.mock("@/hooks/useLocationSearch", () => ({
	useLocationSearch: () => ({
		getCurrentLocation: () => Promise.resolve(null),
		getLocationDetails: () => Promise.resolve(null),
	}),
}));
jest.mock("@/contexts/SnackbarProvider", () => ({ useSnackbar: () => ({ showSnackbar: jest.fn() }) }));
// #1196 検索画面は海外未対応の案内(ダイアログ)のため useDialog を使う。Provider 無しで
// レンダリングすると useDialog が throw して suite ごと落ちるため、他の context と同様スタブ化する
jest.mock("@/contexts/DialogProvider", () => ({ useDialog: () => ({ showDialog: jest.fn(), confirm: jest.fn() }) }));
// #1087 【修正】このモックが無いと suite ごとロードに失敗する。
// useAutoCurrentLocation → AuthProvider → lib/supabase → constants/Env と芋づるに読み込まれ、
// Env が `Constants.expoConfig.extra.eas.projectId` を触るが、jest-expo は app.config.ts を
// 評価しない（expoConfig は空オブジェクト）ため TypeError で落ちる。
// 検証対象は先読みブロックの JSX だけなので、周辺の hooks と同じくスタブ化する
jest.mock("@/features/search/hooks/useAutoCurrentLocation", () => ({
	useAutoCurrentLocation: () => ({ requestAutoCurrentLocation: jest.fn() }),
}));
jest.mock("@/features/search/hooks/useRecentLocations", () => ({
	useRecentLocations: () => ({ recentLocations: [], addRecentLocation: jest.fn(), clearRecentLocations: jest.fn() }),
}));
// #1486 既読済みにしておく。未読だとオンボーディングへ router.push が走り、
// これらのテストが見たい «検索画面そのもの» の検証にノイズが乗る
jest.mock("@/features/onboarding/hooks/useOnboardingSeen", () => ({
	useOnboardingSeen: () => true,
}));
jest.mock("@/components/LocationAutocomplete", () => ({ LocationAutocomplete: () => null }));
jest.mock("@/components/PrimaryButton", () => ({ PrimaryButton: () => null }));
jest.mock("@/features/search/components/DistanceSlider", () => ({ DistanceSlider: () => null }));
jest.mock("@/features/search/components/PriceLevelsMultiSelect", () => ({ PriceLevelsMultiSelect: () => null }));
jest.mock("@/features/search/components/SelectableGridItem", () => ({ SelectableGridItem: () => null }));
jest.mock("@/features/search/components/SelectableChip", () => ({ SelectableChip: () => null }));

import SearchScreen from "@/app/[locale]/(tabs)/search/index";
import { Image } from "expo-image";

// React 19 では初期描画がスケジューラのタスクへ回されるため、act() で包まないと
// テスト本体が終わったあと(= jest がモジュールレジストリを畳んだあと)に描画が走ってしまう
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** 先読みブロック(aria-hidden を持つオフスクリーン View)を1つだけ取り出す */
function findPreloadBlock(): ReactTestInstance {
	let tree: TestRenderer.ReactTestRenderer | undefined;
	TestRenderer.act(() => {
		tree = TestRenderer.create(<SearchScreen />);
	});
	const blocks = tree!.root.findAll((node) => node.type === View && node.props["aria-hidden"] === true, {
		deep: true,
	});
	expect(blocks).toHaveLength(1);
	return blocks[0];
}

describe("検索画面のオフスクリーン先読みブロック", () => {
	it("先読み対象の画像がすべて描画されている", () => {
		const images = findPreloadBlock().findAllByType(Image);
		expect(images).toHaveLength(PRELOAD_IMAGES.length);
	});

	it("各 Image のサイズが非ゼロである(0×0 だと native がロード要求を出さない)", () => {
		const images = findPreloadBlock().findAllByType(Image);
		for (const image of images) {
			const style = StyleSheet.flatten(image.props.style) ?? {};
			expect(typeof style.width).toBe("number");
			expect(typeof style.height).toBe("number");
			expect(style.width as number).toBeGreaterThan(0);
			expect(style.height as number).toBeGreaterThan(0);
		}
	});

	it("親 View のサイズも非ゼロで、かつ画面には見えない", () => {
		const block = findPreloadBlock();
		const style = StyleSheet.flatten(block.props.style) ?? {};
		// 0×0 の祖先に依存しない形にしておく(iOS/Android の早期 return を確実に避ける)
		expect(style.width as number).toBeGreaterThan(0);
		expect(style.height as number).toBeGreaterThan(0);
		// decode 専用のブロックなので、見えず・触れず・レイアウトを押し出さないこと
		expect(style.position).toBe("absolute");
		expect(style.overflow).toBe("hidden");
		expect(style.opacity).toBe(0);
		expect(block.props.pointerEvents).toBe("none");
	});
});
