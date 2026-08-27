/**
 * #1124 「起動時の URL をディープリンクの行き先として採用してよいのは初回マウントだけ」という不変条件のテスト。
 *
 * `Linking.getInitialURL()` は「今回のディープリンク」ではなく «起動時の URL» を返し続ける。
 *   - react-native-web: モジュール読み込み時の window.location.href に束縛される
 *   - ネイティブ: 起動した intent / URL のまま（onNewIntent では更新されない）
 *
 * そのため、ログアウト後に "/" へ遷移してこの画面が再マウントされると、
 * 「起動時の URL」を新しいディープリンクと誤認し、ホームではなく元の画面へ戻してしまう。
 * Web で実測した不具合（ログアウトしてもホームへ飛ばない）はこれが原因だった。
 */

const mockGetInitialURL = jest.fn();
const mockReplace = jest.fn();
const mockConsumeLogoutRedirect = jest.fn();

jest.mock("expo-router", () => ({
	useRouter: () => ({ replace: mockReplace }),
	useRootNavigationState: () => ({ key: "root" }),
}));
jest.mock("@/lib/logoutRedirect", () => ({ consumeLogoutRedirect: () => mockConsumeLogoutRedirect() }));
jest.mock("expo-linking", () => ({
	getInitialURL: () => mockGetInitialURL(),
	// 実装と同じく path だけ取り出せれば足りる。
	// ⚠️ 本物の Linking.parse はクエリ／フラグメントを path に含めず queryParams 側へ分ける。
	//    #1135 で問題になるのは «path だけ採用するとクエリ（= OAuth の code）が落ちる» ことなので、
	//    ここを本物どおりにしておかないとテストが実機と違う世界を見てしまう。
	parse: (url: string) => ({
		path:
			url
				.replace(/^[a-zA-Z+.-]+:\/\/[^/]*/, "")
				.replace(/^\//, "")
				.split("#")[0]
				.split("?")[0] || null,
	}),
}));
jest.mock("expo-localization", () => ({ getLocales: () => [{ languageTag: "ja-JP" }] }));
jest.mock("expo-splash-screen", () => ({ preventAutoHideAsync: jest.fn() }));
jest.mock("expo-web-browser", () => ({ maybeCompleteAuthSession: jest.fn() }));
jest.mock("@/lib/i18n", () => ({ getResolvedLocale: () => "ja-JP" }));
jest.mock("@/constants/Env", () => ({ Env: { NODE_ENV: "test" } }));

/**
 * モジュールスコープの「採用済み」フラグをテストごとにリセットするため、`jest.resetModules()` 後に読み直す。
 *
 * ⚠️ react / react-test-renderer も同じタイミングで require すること。
 * ファイル先頭で import すると、リセット前の React と、リセット後に読み直された対象モジュールが
 * 別インスタンスの React を掴み、dispatcher が null になって `useState` で落ちる。
 */
const renderIndex = async () => {
	const { act } = require("react");
	const TestRenderer = require("react-test-renderer");
	const App = require("../app/index").default;

	await act(async () => {
		TestRenderer.create(<App />);
	});
	// リダイレクトは setTimeout(0) 越しに実行される
	await act(async () => {
		jest.advanceTimersByTime(0);
	});
};

describe("app/index.tsx のディープリンク採用（#1124）", () => {
	beforeEach(() => {
		jest.useFakeTimers();
		(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
		jest.resetModules();
		mockReplace.mockClear();
		mockGetInitialURL.mockReset();
		mockConsumeLogoutRedirect.mockReturnValue(null);
	});

	afterEach(() => {
		jest.useRealTimers();
	});

	it("初回マウントでは、起動時 URL のロケール配下パスを行き先として採用する", async () => {
		mockGetInitialURL.mockResolvedValue("nanitabeyo:///ja-JP/profile");

		await renderIndex();

		expect(mockReplace).toHaveBeenCalledWith("/ja-JP/profile");
	});

	// ★ ログアウト後の再マウント。ここで採用してしまうと「ホームへ戻らない」不具合になる
	it("2 回目以降のマウントでは、起動時 URL を採用せずロケール直下（ホーム）へ送る", async () => {
		mockGetInitialURL.mockResolvedValue("nanitabeyo:///ja-JP/profile");

		await renderIndex(); // 1 回目（採用される）
		mockReplace.mockClear();
		await renderIndex(); // 2 回目（採用してはいけない）

		expect(mockReplace).toHaveBeenCalledWith("/ja-JP");
	});

	it("ログアウト由来では、初回マウントでも起動時 URL を無視して元のロケールのホームへ送る", async () => {
		mockConsumeLogoutRedirect.mockReturnValue("ja-JP");
		mockGetInitialURL.mockResolvedValue("nanitabeyo:///ja-JP/profile/device-settings");

		await renderIndex();

		expect(mockGetInitialURL).not.toHaveBeenCalled();
		expect(mockReplace).toHaveBeenCalledWith("/ja-JP");
	});

	it("起動時 URL が無い通常起動では、ロケール直下（ホーム）へ送る", async () => {
		mockGetInitialURL.mockResolvedValue(null);

		await renderIndex();

		expect(mockReplace).toHaveBeenCalledWith("/ja-JP");
	});

	it("アプリ内ルートとして解釈できない起動時 URL は採用しない（dev launcher の起動 URL）", async () => {
		mockGetInitialURL.mockResolvedValue("nanitabeyo://expo-development-client/?url=http%3A%2F%2Flocalhost");

		await renderIndex();

		expect(mockReplace).toHaveBeenCalledWith("/ja-JP");
	});

	/**
	 * #1135 Web の OAuth コールバック URL を「行き先」として採用してはいけない。
	 *
	 * Web では `Linking.parse("https://<host>/ja-JP/auth/callback?code=...").path` が
	 * `ja-JP/auth/callback` になり、**先頭セグメント `ja-JP` は BCP 47 判定を通ってしまう**。
	 * その結果 `router.replace("/ja-JP/auth/callback")` が呼ばれ、`code` を落とした行き先へ送られる。
	 * 送られた先の callback 画面は交換すべき code を持たないので `oauth_callback_no_result` になる。
	 *
	 * ネイティブ（`nanitabeyo://ja-JP/auth/callback?...`）は `ja-JP` が hostname に入るため
	 * 元から弾かれている。Web だけが穴だった。
	 */
	it("Web の OAuth コールバック URL は、code を落とした行き先として採用しない（#1135）", async () => {
		mockGetInitialURL.mockResolvedValue(
			"https://nanitabeyo.example/ja-JP/auth/callback?intent=link&provider=google&code=abcdef",
		);

		await renderIndex();

		// ★ ここへ送ると code が落ちる
		expect(mockReplace).not.toHaveBeenCalledWith("/ja-JP/auth/callback");
		expect(mockReplace).toHaveBeenCalledWith("/ja-JP");
	});

	it("Web の OAuth エラー応答つきコールバック URL も採用しない（#1135）", async () => {
		mockGetInitialURL.mockResolvedValue(
			"https://nanitabeyo.example/ja-JP/auth/callback?error=server_error&error_code=identity_already_exists",
		);

		await renderIndex();

		expect(mockReplace).not.toHaveBeenCalledWith("/ja-JP/auth/callback");
		expect(mockReplace).toHaveBeenCalledWith("/ja-JP");
	});

	it("クエリを持たないコールバック URL も行き先にしない（#1135）", async () => {
		mockGetInitialURL.mockResolvedValue("https://nanitabeyo.example/ja-JP/auth/callback");

		await renderIndex();

		expect(mockReplace).not.toHaveBeenCalledWith("/ja-JP/auth/callback");
		expect(mockReplace).toHaveBeenCalledWith("/ja-JP");
	});

	// #1272 【重要】旧仕様はここで "/ja-JP/profile"（クエリ落ち）を期待していた。
	// その挙動こそがバグで、iOS では ?tab= がアプリのどこにも届かなくなっていた
	//（Linking.parse().path がクエリを落とし、この画面のリダイレクトが expo-router の
	//  初期 URL 解決に勝つため。probe の実測 `local=- global=-` で確定）。
	// クエリは行き先の一部として運ぶのが正しい
	it("ロケール配下の通常画面は、クエリごと行き先として採用する（#1272）", async () => {
		mockGetInitialURL.mockResolvedValue("https://nanitabeyo.example/ja-JP/profile?tab=reviews");

		await renderIndex();

		expect(mockReplace).toHaveBeenCalledWith("/ja-JP/profile?tab=reviews");
	});
});
