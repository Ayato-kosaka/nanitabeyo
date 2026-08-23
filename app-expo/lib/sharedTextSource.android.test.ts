/**
 * #1400（親 #1375）PR2: Android の共有（`ACTION_SEND` / `text/plain`）の受け取りを固定する。
 *
 * ## 実機が使えないので、ネイティブ境界だけをモックする
 *
 * `expo-share-intent` のネイティブモジュール（`ExpoShareIntentModule`）は
 * `hasShareIntent()` / `getShareIntent()` / `clearShareIntent()` と `onChange` イベントしか
 * 表に出していない。ここを差し替えれば **「共有が来たとき何が起きるか」は実機無しで全部固定できる**。
 *
 * ## ここで守っているもの
 * 1. 起動時の共有は **初回だけ返す**（2 回目は `null`、ネイティブも叩かない）
 * 2. 読んだらネイティブ側の保持を**必ずクリアする** — 次の «プロセス» で同じ共有を読まないため
 * 3. `text/plain` 以外（画像・ファイル）は無視する
 * 4. URL でない共有テキストは **落とさずそのまま流す**（判定は `parseSnsUrl()` の仕事）
 * 5. 起動時の 1 本が購読側へ **二重に流れない**
 * 6. 購読解除でネイティブの購読も手放す（リークしない・二重解除で壊れない）
 *
 * モジュールスコープの状態（`hasReadInitial` / 参照カウント）を検証対象にしているので、
 * テストごとに `jest.resetModules()` して読み直す（`lib/sharedText.test.ts` と同じ作法。
 * テスト専用のリセット関数は生やさない）。
 */

/** ネイティブが `onChange` を配るときに呼ぶリスナー置き場（実機の EventEmitter の代わり） */
const mockNativeListeners = new Set<(event: { value: unknown }) => void>();

const mockShareIntentModule = {
	hasShareIntent: jest.fn((_key: string): boolean => false),
	getShareIntent: jest.fn(async (_key: string): Promise<void> => {}),
	clearShareIntent: jest.fn((_key: string): void => {}),
	addListener: jest.fn((_eventName: string, listener: (event: { value: unknown }) => void) => {
		mockNativeListeners.add(listener);
		return {
			remove: () => {
				mockNativeListeners.delete(listener);
			},
		};
	}),
};

jest.mock("expo-share-intent/build/ExpoShareIntentModule", () => ({
	__esModule: true,
	default: mockShareIntentModule,
}));

/** ネイティブから `onChange` が飛んできた状況を作る */
const emitNativeShare = (value: unknown) => {
	for (const listener of [...mockNativeListeners]) listener({ value });
};

/**
 * Metro は Android で `sharedTextSource.android.ts` を選ぶが、jest-expo の既定プラットフォームは
 * ios なので（`jest-expo/jest-preset` の `haste.defaultPlatform`）、拡張子まで書いて直接読む。
 */
const loadSource = () => {
	jest.resetModules();
	return (require("./sharedTextSource.android") as typeof import("./sharedTextSource.android")).sharedTextSource;
};

const TIKTOK_URL = "https://www.tiktok.com/@cookpad/video/7261234567890123456";

/** text/plain の共有としてネイティブが送ってくる形（`ExpoShareIntentModule.kt` の `handleShareIntent`） */
const textShare = (text: string) => ({ text, type: "text", meta: { title: null } });

beforeEach(() => {
	mockNativeListeners.clear();
	// clearMocks: true は呼び出し履歴しか消さない。mockReturnValue / mockImplementation は
	// 前のテストのものが残るので、ここで既定へ戻す
	mockShareIntentModule.hasShareIntent.mockImplementation(() => false);
	mockShareIntentModule.getShareIntent.mockImplementation(async () => {});
	mockShareIntentModule.clearShareIntent.mockImplementation(() => {});
});

/** 「共有から起動された」状況。`getShareIntent()` が呼ばれたら `onChange` が飛ぶ */
const givenColdStartShare = (value: unknown) => {
	mockShareIntentModule.hasShareIntent.mockImplementation(() => true);
	mockShareIntentModule.getShareIntent.mockImplementation(async () => {
		emitNativeShare(value);
	});
};

describe("getInitialSharedText（コールドスタートの共有）", () => {
	it("共有から起動されたら、その URL を返す", async () => {
		const source = loadSource();
		givenColdStartShare(textShare(TIKTOK_URL));

		await expect(source.getInitialSharedText()).resolves.toBe(TIKTOK_URL);
	});

	// ★ 本題。`getIntent()` が «起動時の intent» を返し続ける罠（app/index.tsx:23,72,97 と同じ）
	it("2 回目以降は null を返し、ネイティブを叩かない（同じ共有を 2 回取り込まない）", async () => {
		const source = loadSource();
		givenColdStartShare(textShare(TIKTOK_URL));

		await expect(source.getInitialSharedText()).resolves.toBe(TIKTOK_URL);
		expect(mockShareIntentModule.getShareIntent).toHaveBeenCalledTimes(1);

		await expect(source.getInitialSharedText()).resolves.toBeNull();
		await expect(source.getInitialSharedText()).resolves.toBeNull();
		expect(mockShareIntentModule.getShareIntent).toHaveBeenCalledTimes(1);
		expect(mockShareIntentModule.hasShareIntent).toHaveBeenCalledTimes(1);
	});

	// JS のフラグはプロセスが変われば消える。ネイティブ側も空にしておかないと «次の起動» で読み直す
	it("読んだらネイティブ側の保持もクリアする", async () => {
		const source = loadSource();
		givenColdStartShare(textShare(TIKTOK_URL));

		await source.getInitialSharedText();

		expect(mockShareIntentModule.clearShareIntent).toHaveBeenCalledTimes(1);
	});

	it("共有以外（ランチャー・ディープリンク）で起動したときはネイティブを叩かずに null", async () => {
		const source = loadSource();
		mockShareIntentModule.hasShareIntent.mockImplementation(() => false);

		await expect(source.getInitialSharedText()).resolves.toBeNull();
		expect(mockShareIntentModule.getShareIntent).not.toHaveBeenCalled();
	});

	it("URL でない共有テキストも落とさずそのまま返す（判定は parseSnsUrl の仕事）", async () => {
		const source = loadSource();
		givenColdStartShare(textShare("この店おいしかった"));

		await expect(source.getInitialSharedText()).resolves.toBe("この店おいしかった");
	});

	it.each([
		["画像・ファイルの共有（type: file）", { type: "file", files: [{ fileName: "a.jpg" }] }],
		["text だが中身が空白だけ", { type: "text", text: "   " }],
		["text が欠けている", { type: "text" }],
		["value が object でない", 42],
	])("text/plain 以外は無視する: %s", async (_label, value) => {
		const source = loadSource();
		givenColdStartShare(value);

		await expect(source.getInitialSharedText()).resolves.toBeNull();
	});

	// hasShareIntent は «type 付きの intent で起動された» ことしか知らないので、
	// この層が扱えない共有でも true になる。待ち続けると起動時の採用機会を握ったままになる
	it("共有があると言われたのにイベントが来なければ、待ち続けずに null で諦める", async () => {
		jest.useFakeTimers();
		try {
			const source = loadSource();
			mockShareIntentModule.hasShareIntent.mockImplementation(() => true);
			mockShareIntentModule.getShareIntent.mockImplementation(async () => {});

			const pending = source.getInitialSharedText();
			await jest.advanceTimersByTimeAsync(5000);

			await expect(pending).resolves.toBeNull();
		} finally {
			jest.useRealTimers();
		}
	});

	it("ネイティブが投げてもアプリを止めない（起動できない方が害が大きい）", async () => {
		const source = loadSource();
		mockShareIntentModule.hasShareIntent.mockImplementation(() => {
			throw new Error("native bridge unavailable");
		});

		await expect(source.getInitialSharedText()).resolves.toBeNull();
	});

	it("getShareIntent が失敗しても null で畳む", async () => {
		const source = loadSource();
		mockShareIntentModule.hasShareIntent.mockImplementation(() => true);
		mockShareIntentModule.getShareIntent.mockImplementation(async () => {
			throw new Error("intent lost");
		});

		await expect(source.getInitialSharedText()).resolves.toBeNull();
	});

	it("プロセスが変われば（＝モジュールを読み直せば）また読める", async () => {
		const first = loadSource();
		givenColdStartShare(textShare(TIKTOK_URL));
		await first.getInitialSharedText();

		const relaunched = loadSource();
		givenColdStartShare(textShare(TIKTOK_URL));
		await expect(relaunched.getInitialSharedText()).resolves.toBe(TIKTOK_URL);
	});
});

describe("subscribeSharedText（起動済みのアプリへ来た共有）", () => {
	it("共有が来たらリスナーへ渡す", () => {
		const source = loadSource();
		const listener = jest.fn();
		source.subscribeSharedText(listener);

		emitNativeShare(textShare(TIKTOK_URL));

		expect(listener).toHaveBeenCalledWith(TIKTOK_URL);
	});

	it("text/plain 以外はリスナーへ渡さない", () => {
		const source = loadSource();
		const listener = jest.fn();
		source.subscribeSharedText(listener);

		emitNativeShare({ type: "file", files: [{ fileName: "a.jpg" }] });

		expect(listener).not.toHaveBeenCalled();
	});

	it("解除したら以降は呼ばれず、ネイティブの購読も手放す（リークしない）", () => {
		const source = loadSource();
		const listener = jest.fn();

		const unsubscribe = source.subscribeSharedText(listener);
		expect(mockNativeListeners.size).toBe(1);

		unsubscribe();
		expect(mockNativeListeners.size).toBe(0);

		emitNativeShare(textShare(TIKTOK_URL));
		expect(listener).not.toHaveBeenCalled();
	});

	it("解除を二重に呼んでも、他の購読者が巻き添えにならない", () => {
		const source = loadSource();
		const first = jest.fn();
		const second = jest.fn();

		const unsubscribeFirst = source.subscribeSharedText(first);
		source.subscribeSharedText(second);
		expect(mockNativeListeners.size).toBe(1); // ネイティブ購読は 1 本を共有する

		unsubscribeFirst();
		unsubscribeFirst();

		emitNativeShare(textShare(TIKTOK_URL));
		expect(first).not.toHaveBeenCalled();
		expect(second).toHaveBeenCalledWith(TIKTOK_URL);
		expect(mockNativeListeners.size).toBe(1);
	});

	it("購読と解除を繰り返してもネイティブの購読が増えない", () => {
		const source = loadSource();

		for (let i = 0; i < 5; i += 1) {
			const unsubscribe = source.subscribeSharedText(jest.fn());
			expect(mockNativeListeners.size).toBe(1);
			unsubscribe();
			expect(mockNativeListeners.size).toBe(0);
		}

		expect(mockShareIntentModule.addListener).toHaveBeenCalledTimes(5);
	});
});

// ★ 起動時の共有もアプリ内の共有も、ネイティブからは同じ onChange で届く。
//   両方へ流すと 1 回の共有が 2 回取り込まれる（設計 §3 の «何度も取り込まれる» そのもの）
describe("起動時の共有と購読が二重に流れない", () => {
	it("起動時の 1 本は購読リスナーへ渡らない", async () => {
		const source = loadSource();
		mockShareIntentModule.hasShareIntent.mockImplementation(() => true);
		mockShareIntentModule.getShareIntent.mockImplementation(async () => {
			emitNativeShare(textShare(TIKTOK_URL));
		});

		// useSnsShareIntake と同じ順序: 先に起動時の読み取りを始め、続けて購読する
		const initial = source.getInitialSharedText();
		const listener = jest.fn();
		source.subscribeSharedText(listener);

		await expect(initial).resolves.toBe(TIKTOK_URL);
		expect(listener).not.toHaveBeenCalled();
	});

	it("起動時の読み取りが終わった «後» に来た共有は購読へ流れる", async () => {
		const source = loadSource();
		givenColdStartShare(textShare(TIKTOK_URL));

		const listener = jest.fn();
		source.subscribeSharedText(listener);
		await source.getInitialSharedText();

		const nextShare = "https://www.youtube.com/shorts/dQw4w9WgXcQ";
		emitNativeShare(textShare(nextShare));

		expect(listener).toHaveBeenCalledTimes(1);
		expect(listener).toHaveBeenCalledWith(nextShare);
	});

	it("起動時の待機中に扱えない共有が来ても、待ち続けずに畳む", async () => {
		const source = loadSource();
		mockShareIntentModule.hasShareIntent.mockImplementation(() => true);
		mockShareIntentModule.getShareIntent.mockImplementation(async () => {
			emitNativeShare({ type: "file", files: [{ fileName: "a.jpg" }] });
		});

		await expect(source.getInitialSharedText()).resolves.toBeNull();
	});
});
