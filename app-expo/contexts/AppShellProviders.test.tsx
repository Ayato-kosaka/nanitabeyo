/*
#1810 【回帰防止】`MapsEmbedModal` は react-native-paper の bare `<Portal>` 経由で mount される。
`useAPICall`（内部で `useDialog()` / `useAuth()` を呼ぶ）を使うため、DialogContext / AuthContext を
継承できるかどうかは「プロバイダの入れ子順序」そのものに懸かっている（詳細は
`AppShellProviders.tsx` の設計コメント）。

この不変条件は **DialogProvider / AuthProvider をモックするテストでは検出できない**。
モックした瞬間に「実際に continuous な React Context チェーンを Portal 越しに辿れるか」という
検証したい対象そのものが消えるためである（実際、既存の `MapsEmbedModal.test.tsx` は
`useAPICall` ごとモックしており、この種の不具合は原理的に踏めない）。

このテストは `AppShellProviders`（`app/[locale]/_layout.tsx` と実装を共有する、
DialogProvider → AuthProvider → Portal.Host → MapsEmbedModalProvider → TrueSheetProvider の
入れ子）を丸ごと**実プロバイダ**で組み立て、`showMapsEmbedModal` を実際に呼んで
`MapsEmbedModal`（本物）が例外を投げずに描画できることを固定する。
ネットワークだけは `@/lib/fetchWithAuth` の差し替えで切り離す（DialogContext / AuthContext を
経由する経路そのものは本物のまま検証したいため、ここだけがモックの境界になる）。

`AppShellProviders.tsx` の入れ子順序を #1810 の修正前（`Portal.Host` / `AuthProvider` を
`MapsEmbedModalProvider` の内側へ戻す）に巻き戻すと、このテストは
「[useDialog] This hook must be used within a <DialogProvider>.」で赤くなる。
*/
import React from "react";
import { act } from "react";
import TestRenderer from "react-test-renderer";
import { PaperProvider } from "react-native-paper";
import { AppShellProviders } from "./AppShellProviders";
import { useMapsEmbedModal } from "./MapsEmbedModalProvider";

const FAKE_SESSION = {
	access_token: "test-access-token",
	refresh_token: "test-refresh-token",
	expires_in: 3600,
	token_type: "bearer",
	user: { id: "user-1", is_anonymous: true },
};

// #1030 AuthProvider の初期化を「セッション復元済み」へ最短で倒すための最小モック群。
// AuthProvider.test.tsx と同じ考え方: AuthProvider 自身のロジックはこのテストの関心外なので、
// supabase 呼び出しだけを潰し、Context の入れ子（= 今回の検証対象）は本物のまま動かす。
jest.mock("@/lib/supabase", () => ({
	supabase: {
		auth: {
			getSession: jest.fn(async () => ({ data: { session: FAKE_SESSION }, error: null })),
			setSession: jest.fn(async () => ({ data: { session: FAKE_SESSION }, error: null })),
			signInAnonymously: jest.fn(async () => ({ data: { session: FAKE_SESSION }, error: null })),
			refreshSession: jest.fn(async () => ({ data: { session: FAKE_SESSION }, error: null })),
			onAuthStateChange: jest.fn(() => ({ data: { subscription: { unsubscribe: jest.fn() } } })),
		},
	},
	consumeAuthRetryAfterHeader: jest.fn(() => null),
}));
jest.mock("@/lib/e2e/injectTestSession", () => ({
	injectTestSession: jest.fn(async () => "skipped"),
	isTestSessionInjectionError: jest.fn(() => false),
}));
jest.mock("@/hooks/useLogger", () => ({ useLogger: () => ({ logFrontendEvent: jest.fn() }) }));
jest.mock("@/hooks/useLocale", () => ({ useLocale: () => ({ locale: "ja-JP", isJapanese: true }) }));
jest.mock("expo-router", () => ({ useRouter: () => ({ replace: jest.fn() }) }));
jest.mock("@/lib/logoutRedirect", () => ({ requestLogoutRedirect: jest.fn() }));
jest.mock("expo-linking", () => ({ parse: jest.fn() }));
jest.mock("expo-auth-session", () => ({ makeRedirectUri: jest.fn() }));
jest.mock("expo-web-browser", () => ({ openAuthSessionAsync: jest.fn() }));
jest.mock("@/stores/useDishMediaEntriesStore", () => ({
	useDishMediaEntriesStore: { getState: () => ({ clearByKey: jest.fn() }) },
}));
jest.mock("@/stores/useDishCategoriesStore", () => ({
	useDishCategoriesStore: { getState: () => ({ clearByKey: jest.fn() }) },
}));
jest.mock("@/features/profile/stores/useProfileStore", () => ({
	useProfileStore: { getState: () => ({ resetProfile: jest.fn() }) },
}));
jest.mock("@/stores/useCdnCookieStore", () => ({
	useCdnCookieStore: { getState: () => ({ clearCookies: jest.fn(), setFromResponseHeaders: jest.fn() }) },
}));
jest.mock("@/features/myDishes/stores/useMyDishesRevisionStore", () => ({
	useMyDishesRevisionStore: { getState: () => ({ bump: jest.fn() }) },
}));
jest.mock("@/features/myDishes/stores/useMyDishesFeedScopeStore", () => ({
	useMyDishesFeedScopeStore: { getState: () => ({ clear: jest.fn() }) },
}));

// MapsEmbedModal / DialogProvider が使う周辺（UI ライブラリ・env）。
// ⚠️ ここでも DialogProvider・AuthProvider・MapsEmbedModalProvider 自体はモックしないこと
// （それをやると今回検証したい Context チェーンごと消える）。
jest.mock("@/lib/i18n", () => ({ __esModule: true, default: { t: (key: string) => key, locale: "ja" } }));
jest.mock("@/hooks/useHaptics", () => ({ useHaptics: () => ({ lightImpact: jest.fn(), mediumImpact: jest.fn() }) }));
jest.mock("@/hooks/useSheetBottomPadding", () => ({ useSheetBottomPadding: () => 0 }));
jest.mock("lucide-react-native", () => new Proxy({}, { get: () => () => null }));
jest.mock("@/constants/Env", () => ({ Env: { BACKEND_BASE_URL: "https://api.example.com" } }));
jest.mock("@/lib/openExternalUrl", () => ({ openExternalUrl: jest.fn(async () => {}) }));
// ネットワークだけ切り離す。DialogContext / AuthContext を経由する useAPICall の中身は本物のまま
jest.mock("@/lib/fetchWithAuth", () => ({
	fetchWithAuth: jest.fn(async () => ({
		response: {
			ok: true,
			status: 200,
			json: async () => ({ success: true, data: { token: "embed-token" } }),
		} as unknown as Response,
		endpoint: "v1/maps/embed-token",
	})),
}));
jest.mock("react-native-safe-area-context", () => ({
	...jest.requireActual("react-native-safe-area-context"),
	useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
	useSafeAreaFrame: () => ({ x: 0, y: 0, width: 390, height: 800 }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Stack 配下の画面を模した probe。マウント直後に地図モーダルを開く（ボタン操作は不要） */
function OpenMapsEmbedModalOnMount() {
	const { showMapsEmbedModal } = useMapsEmbedModal();
	React.useEffect(() => {
		showMapsEmbedModal({
			mode: "place",
			q: "place_id:test-place",
			title: "テスト食堂",
			externalUrl: "https://maps.google.com/?q=test",
			source: "test",
		});
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);
	return null;
}

describe("#1810 AppShellProviders: Portal 経由で mount される画面にも DialogContext/AuthContext が届く", () => {
	it("MapsEmbedModal が useDialog/useAuth 由来の例外を投げずにマウントできる", async () => {
		let tree!: TestRenderer.ReactTestRenderer;

		await act(async () => {
			tree = TestRenderer.create(
				<PaperProvider>
					<AppShellProviders>
						<OpenMapsEmbedModalOnMount />
					</AppShellProviders>
				</PaperProvider>,
			);
		});

		// トークン取得（fetchWithAuth のモック）が解決するまで tick を進める
		await act(async () => {
			await Promise.resolve();
			await Promise.resolve();
			await Promise.resolve();
		});

		// #1810 修正前はここに到達する前に
		// 「[useDialog] This hook must be used within a <DialogProvider>.」で例外が飛んでいた。
		// 本物の MapsEmbedModal（表示コンポーネント）が描かれていることを確認する
		// （testID は Modal のラップ構造上、複数ノードに同じ値が乗る。MapsEmbedModal.test.tsx と同じ判定）
		expect(tree.root.findAllByProps({ testID: "maps-embed-modal" }).length).toBeGreaterThan(0);
	});
});
