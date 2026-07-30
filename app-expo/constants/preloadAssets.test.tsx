// #1087 / #785 【設計】先読み側と表示側の cachePolicy 一致を守る回帰テスト。
//
// #785 に「同一 URL を異なる cachePolicy で読み込むと iOS の画像パイプラインが分かれて
// イベントが欠落し得る」という判断が記録されている。実際 icon.webp は memory-disk × 3 箇所 /
// disk × 1 箇所(ProfileHeader)に割れていた。
//
// このテストは **表示側コンポーネントを実際に描画し、expo-image の <Image> に渡った
// cachePolicy が constants/preloadAssets.ts の定義値と一致するか**を検証する。
// 表示側の 1 箇所だけを生の <Image source={require(...)} cachePolicy="..."> に戻すと、
// source から定義を逆引きしてポリシーを突き合わせるためその場で赤くなる。
//
// ※ jest では react-native の assetFileTransformer によって `require("...webp")` が
//   ファイル名の文字列に変換されるため、source をキーにした逆引きが成立する。
import fs from "node:fs";
import path from "node:path";

import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { Image } from "expo-image";

import ReviewScreen from "@/app/[locale]/(tabs)/review/index";
import { PreloadImageDeck } from "@/components/PreloadImageDeck";
import { TutorialPage } from "@/components/TutorialPage";
import { PRELOAD_ASSETS, PRELOAD_ASSET_KEYS, type PreloadAssetKey } from "@/constants/preloadAssets";
import { RestaurantLoading } from "@/features/dishMedia/components/RestaurantLoading";
import { LoginbackModal } from "@/features/profile/components/LoginbackModal";
import { ProfileHeader } from "@/features/profile/components/ProfileHeader";
import { TopicsLoading } from "@/features/topics/components/TopicsLoading";

// ---------------------------------------------------------------------------
// expo-image は「<Image> に渡る props」だけを観測したいのでモックする
// (jest.mock は babel-plugin-jest-hoist が import より上へ巻き上げるので、
//  上の import 群より後ろに書いてあっても正しく適用される)
// ---------------------------------------------------------------------------
jest.mock("expo-image", () => ({
	Image: function MockExpoImage() {
		return null;
	},
}));

// ---------------------------------------------------------------------------
// 表示側コンポーネントを描画するために必要な最小限のモック
// ---------------------------------------------------------------------------
jest.mock("@react-native-async-storage/async-storage", () =>
	require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);

// constants/Env.ts は expo-constants の extra をモジュール評価時に読むため、jest では素通らない
jest.mock("expo-constants", () => ({
	__esModule: true,
	default: {
		expoConfig: {
			version: "0.0.0",
			extra: {
				eas: { projectId: "test" },
				EXPO_PUBLIC_SUPABASE_URL: "https://test.supabase.co",
				EXPO_PUBLIC_SUPABASE_ANON_KEY: "test-anon-key",
			},
		},
	},
}));

jest.mock("expo-router", () => ({
	router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
	useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
	usePathname: () => "/",
	useLocalSearchParams: () => ({}),
}));

jest.mock("@/contexts/AuthProvider", () => ({
	useAuth: () => ({
		user: null,
		signInWithOAuth: jest.fn(),
		signInWithOtp: jest.fn(),
		linkIdentity: jest.fn(),
	}),
}));

jest.mock("@/contexts/SnackbarProvider", () => ({
	useSnackbar: () => ({ showSnackbar: jest.fn() }),
}));

jest.mock("@/hooks/useLogger", () => ({
	useLogger: () => ({ logFrontendEvent: jest.fn() }),
}));

jest.mock("@/hooks/useHaptics", () => ({
	useHaptics: () => ({ lightImpact: jest.fn(), mediumImpact: jest.fn(), heavyImpact: jest.fn() }),
}));

jest.mock("@/hooks/useScreenTrace", () => ({ useScreenTrace: jest.fn() }));

jest.mock("@/hooks/useLocale", () => ({ useLocale: () => ({ locale: "ja-JP" }) }));

jest.mock("@/features/blurModal/hooks/useBlurModal", () => ({
	useBlurModal: () => ({
		BlurModal: function MockBlurModal() {
			return null;
		},
		open: jest.fn(),
		close: jest.fn(),
		toggle: jest.fn(),
		visible: false,
	}),
}));

/** app-expo のルート(このファイルは constants/ 直下にある) */
const APP_ROOT = path.join(__dirname, "..");

/** source(jest ではアセットのファイル名文字列) → 先読み定義キー の逆引き */
const KEY_BY_SOURCE = new Map<unknown, PreloadAssetKey>(
	PRELOAD_ASSET_KEYS.map((key) => [PRELOAD_ASSETS[key].source, key]),
);

/**
 * コンポーネントを描画し、先読み対象アセットを描いている <Image> の
 * 「キー → 実際に渡された cachePolicy」を集める。
 */
function collectPolicies(element: React.ReactElement): Map<PreloadAssetKey, unknown> {
	let renderer!: TestRenderer.ReactTestRenderer;
	act(() => {
		renderer = TestRenderer.create(element);
	});

	const collected = new Map<PreloadAssetKey, unknown>();
	for (const image of renderer.root.findAllByType(Image)) {
		const key = KEY_BY_SOURCE.get(image.props.source);
		// 先読み対象ではない画像(プロフィールの avatarUrl など)は対象外
		if (key === undefined) continue;
		collected.set(key, image.props.cachePolicy);
	}

	act(() => {
		renderer.unmount();
	});

	return collected;
}

/** 表示側の一覧。ここに漏れがあると「揃え忘れ」を検出できないので、後段の網羅テストで担保する */
const DISPLAY_SITES: { name: string; expectedKeys: PreloadAssetKey[]; render: () => React.ReactElement }[] = [
	{
		name: "components/TutorialPage.tsx (page1)",
		expectedKeys: ["tutorialPage1"],
		render: () => <TutorialPage asset="tutorialPage1" title="t" bodyLines={["b"]} />,
	},
	{
		name: "components/TutorialPage.tsx (page2)",
		expectedKeys: ["tutorialPage2"],
		render: () => <TutorialPage asset="tutorialPage2" title="t" bodyLines={["b"]} />,
	},
	{
		name: "components/TutorialPage.tsx (page3)",
		expectedKeys: ["tutorialPage3"],
		render: () => <TutorialPage asset="tutorialPage3" title="t" bodyLines={["b"]} />,
	},
	{
		name: "components/TutorialPage.tsx (page4)",
		expectedKeys: ["tutorialPage4"],
		render: () => <TutorialPage asset="tutorialPage4" title="t" bodyLines={["b"]} />,
	},
	{
		name: "app/[locale]/(tabs)/review/index.tsx (ヒーロー画像)",
		expectedKeys: ["reviewHero"],
		render: () => <ReviewScreen />,
	},
	{
		name: "features/profile/components/LoginbackModal.tsx",
		expectedKeys: ["appleIcon", "googleIcon"],
		render: () => <LoginbackModal onClose={jest.fn()} />,
	},
	{
		name: "features/profile/components/ProfileHeader.tsx (ゲスト)",
		expectedKeys: ["appIcon"],
		render: () => (
			<ProfileHeader
				isGuest
				isOwnProfile
				profile={
					{
						display_name: "guest",
						bio: "",
						followingCount: 0,
						followersCount: 0,
						totalLikes: 0,
					} as never
				}
			/>
		),
	},
	{
		name: "features/topics/components/TopicsLoading.tsx",
		expectedKeys: ["appIcon"],
		render: () => <TopicsLoading />,
	},
	{
		name: "features/dishMedia/components/RestaurantLoading.tsx",
		expectedKeys: ["appIcon"],
		render: () => <RestaurantLoading />,
	},
	{
		name: "components/PreloadImageDeck.tsx (先読み側)",
		expectedKeys: [...PRELOAD_ASSET_KEYS],
		render: () => <PreloadImageDeck />,
	},
];

describe("先読みアセットの cachePolicy 契約", () => {
	it.each(DISPLAY_SITES)("$name が定義どおりの cachePolicy で描画する", ({ expectedKeys, render }) => {
		const collected = collectPolicies(render());

		// 期待したアセットが実際に描かれていること(描かれていなければ検証自体が空振りする)
		expect([...collected.keys()].sort()).toEqual([...expectedKeys].sort());

		for (const key of expectedKeys) {
			expect(collected.get(key)).toBe(PRELOAD_ASSETS[key].cachePolicy);
		}
	});

	it("先読み対象 8 アセットすべてに、ポリシーを検証済みの表示側が存在する", () => {
		const covered = new Set(DISPLAY_SITES.flatMap((site) => site.expectedKeys));

		expect([...covered].sort()).toEqual([...PRELOAD_ASSET_KEYS].sort());
		expect(PRELOAD_ASSET_KEYS).toHaveLength(8);
	});

	// 描画テストで到達できない表示側(web 限定の OpenInAppBanner のように Platform で
	// 早期 return するもの)を取りこぼさないための静的チェック。
	// 「PreloadedImage を通さずに直接 require する」書き方そのものを禁止する。
	it("先読み対象アセットを constants/preloadAssets.ts 以外で直接 require していない", () => {
		const ASSET_PATHS = [
			"@/assets/images/tutorial/search-page1.webp",
			"@/assets/images/tutorial/search-page2.webp",
			"@/assets/images/tutorial/search-page3.webp",
			"@/assets/images/tutorial/search-page4.webp",
			"@/assets/images/icon.webp",
			"@/features/review/assets/review-hero.webp",
			"@/assets/images/logo_apple_icon.png",
			"@/assets/images/logo_google_g_icon.png",
		];
		// 定義元だけが require してよい
		const ALLOWED = path.join(__dirname, "preloadAssets.ts");

		const violations: string[] = [];
		const walk = (dir: string) => {
			for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
				const full = path.join(dir, entry.name);
				if (entry.isDirectory()) {
					walk(full);
					continue;
				}
				if (!/\.(ts|tsx)$/.test(entry.name) || full === ALLOWED) continue;

				const content = fs.readFileSync(full, "utf8");
				for (const assetPath of ASSET_PATHS) {
					if (content.includes(`require("${assetPath}")`)) {
						violations.push(`${path.relative(APP_ROOT, full)} → ${assetPath}`);
					}
				}
			}
		};
		for (const dir of ["app", "components", "constants", "features", "hooks", "lib"]) {
			walk(path.join(APP_ROOT, dir));
		}

		expect(violations).toEqual([]);
	});

	it("ローカル埋め込みアセットなので memory 成分を必ず含む(既定の disk 単独は先読みを無意味にする)", () => {
		// #1087 §3 の判断: チュートリアル 4 枚は decode 後 7.91 MiB × 4 と大きすぎるため
		// あえて memory 常駐させない(= disk 据え置き)。ここを変えるときはメモリ見積もりを更新すること。
		const MEMORY_RESIDENT: PreloadAssetKey[] = ["appIcon", "reviewHero", "appleIcon", "googleIcon"];

		for (const key of PRELOAD_ASSET_KEYS) {
			const { cachePolicy } = PRELOAD_ASSETS[key];
			if (MEMORY_RESIDENT.includes(key)) {
				expect(cachePolicy).toMatch(/memory/);
			} else {
				expect(cachePolicy).toBe("disk");
			}
		}
	});
});
