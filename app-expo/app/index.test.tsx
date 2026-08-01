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

jest.mock("expo-router", () => ({
	useRouter: () => ({ replace: mockReplace }),
	useRootNavigationState: () => ({ key: "root" }),
}));
jest.mock("expo-linking", () => ({
	getInitialURL: () => mockGetInitialURL(),
	// 実装と同じく path だけ取り出せれば足りる
	parse: (url: string) => ({ path: url.replace(/^[a-zA-Z+.-]+:\/\/[^/]*/, "").replace(/^\//, "") || null }),
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
	const App = require("./index").default;

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

	it("起動時 URL が無い通常起動では、ロケール直下（ホーム）へ送る", async () => {
		mockGetInitialURL.mockResolvedValue(null);

		await renderIndex();

		expect(mockReplace).toHaveBeenCalledWith("/ja-JP");
	});

	it("アプリ内ルートとして解釈できない起動時 URL は採用しない（OAuth コールバック等）", async () => {
		mockGetInitialURL.mockResolvedValue("nanitabeyo://expo-development-client/?url=http%3A%2F%2Flocalhost");

		await renderIndex();

		expect(mockReplace).toHaveBeenCalledWith("/ja-JP");
	});
});
