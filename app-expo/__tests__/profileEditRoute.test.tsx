/*
#1369 【設計】プロフィール編集の «ルート化» で新しく生まれた 2 つの結び目を固定する。

1. マイページの「プロフィールを編集」が `/[locale]/(tabs)/profile/edit` へ push すること。
   モーダル時代はここが `open()` で、押した先は型でも E2E でも表現されていなかった。
   ルートになると行き先は文字列になり、**間違えても型検査を通る**（typed routes は
   pathname の綴りは見るが、locale や «どのルートを選んだか» までは意味を見ない）。
2. 編集画面が「保存できたとき」と「戻るを押したとき」の両方で、履歴の有無に応じて
   `router.back()` / `router.replace()` を呼び分けること。
   `?next=` を持たないこの画面には lib/authNext.ts の判定を持ち込まないと決めた（設計は
   edit.tsx のコメント）ので、その分岐を守るのはここだけになる。

`app/` 配下に置いたテストは expo-router がルートとして拾ってしまうため、ここに置いている
（__tests__/loginScreenAuthGate.test.tsx と同じ理由）。
*/
import React, { act } from "react";
import TestRenderer from "react-test-renderer";

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockBack = jest.fn();
// #1404 離脱の判定は canGoBack ではなく canDismiss（スタックが 2 枚以上か）を見る。
// canGoBack はタブナビゲータまでさかのぼるため、(tabs) 配下へ直リンク着地しても
// initialRouteName="search" のぶん true になり、親へ倒す保険が働かない
let mockCanDismiss = false;
// 「canGoBack は true だが canDismiss は false」を作れるように別々に持つ
let mockCanGoBack = true;
// ⚠️ スタブ本体をファクトリの «外» に置かないこと。import 文はこのファイルの const 宣言より前へ
// 巻き上げられるため、ファクトリが走る時点では外の変数がまだ undefined になる。
// 中身の参照は «呼び出し時» に解決されるので問題ない（loginEntryPoints.test.tsx と同じ注意）
jest.mock("expo-router", () => {
	const stub = {
		push: (href: unknown) => mockPush(href),
		replace: (href: unknown) => mockReplace(href),
		back: () => mockBack(),
		canGoBack: () => mockCanGoBack,
		canDismiss: () => mockCanDismiss,
	};
	return {
		router: stub,
		useRouter: () => stub,
		useLocalSearchParams: () => ({}),
		useGlobalSearchParams: () => ({}),
	};
});

jest.mock("@/contexts/AuthProvider", () => ({
	useAuth: () => ({ user: { id: "user-1", is_anonymous: false }, isAuthResolved: true }),
}));
jest.mock("@/hooks/useLocale", () => ({ useLocale: () => ({ locale: "ja-JP", isJapanese: true }) }));
// ⚠️ 毎レンダー新しい jest.fn() を返さないこと。呼び出し回数を数えられなくなるうえ、
// 依存に入っている effect が勝手に再実行される（#1387 のフックテストで同じ罠を踏んだ）
const mockLightImpact = jest.fn();
jest.mock("@/hooks/useHaptics", () => {
	const mediumImpact = jest.fn();
	return { useHaptics: () => ({ lightImpact: mockLightImpact, mediumImpact }) };
});
jest.mock("@/hooks/useLogger", () => ({ useLogger: () => ({ logFrontendEvent: jest.fn() }) }));
// #1402 マイページ本体が旧設定画面の項目（ログアウト確認ダイアログ・スナックバー・画面トレース）を
// 抱えるようになったため、押した先だけを見たいこのテストではまとめて潰す
jest.mock("@/hooks/useScreenTrace", () => ({ useScreenTrace: () => {} }));
jest.mock("@/contexts/DialogProvider", () => ({
	useDialog: () => ({ showDialog: jest.fn(), confirm: jest.fn().mockResolvedValue(false) }),
}));
jest.mock("@/contexts/SnackbarProvider", () => ({ useSnackbar: () => ({ showSnackbar: jest.fn() }) }));
jest.mock("@/lib/i18n", () => ({ __esModule: true, default: { t: (key: string) => key } }));

jest.mock("react-native-safe-area-context", () => {
	const ReactActual = jest.requireActual("react");
	const { View: RNView } = jest.requireActual("react-native");
	return {
		useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
		useSafeAreaFrame: () => ({ x: 0, y: 0, width: 390, height: 800 }),
		SafeAreaView: ({ children }: { children: React.ReactNode }) => ReactActual.createElement(RNView, null, children),
	};
});

// 描画判定に関係しない外部依存を素の host 要素へ落とす
jest.mock("expo-image", () => ({ Image: "Image" }));
jest.mock("lottie-react-native", () => "LottieView");
jest.mock("expo-linear-gradient", () => {
	const ReactActual = jest.requireActual("react");
	const { View: RNView } = jest.requireActual("react-native");
	return {
		LinearGradient: ({ children }: { children: React.ReactNode }) => ReactActual.createElement(RNView, null, children),
	};
});
jest.mock("lucide-react-native", () => new Proxy({}, { get: () => () => null }));

// 編集ボタンは ProfileHeader が描く。見たいのは「マイページ本体が onEditProfile に何をさせたか」
// なので、ヘッダーはそのハンドラだけを露出する器へ潰す
// （testID とボタンの結線は e2e が見ている）
jest.mock("@/features/profile/components/ProfileHeader", () => {
	const ReactActual = jest.requireActual("react");
	const { View: RNView } = jest.requireActual("react-native");
	return {
		ProfileHeader: ({ onEditProfile }: { onEditProfile?: () => void }) =>
			ReactActual.createElement(RNView, { testID: "profile-edit-button", onPress: onEditProfile }),
	};
});
// #1402 【設計】ProfileTabsBar / ReviewTab / SavedPostsTab は 4 グリッドタブごと廃止したので
// main にあった jest.mock は落とす（モジュールが存在せず module not found になる）。
// LikeTab / SavedDishCategoriesTab は単独ルートへ移り、マイページ本体はもう描かないのでモック不要。
// #1387 「まだ読んでいない」と「読んだが取れなかった」を分けるため、決着状態も差し替え可能にする。
// profile === null だけでは両者を区別できず、後者でスピナーが回り続けていた
let mockIsProfileResolved = true;
let mockHasLoadFailed = false;
const mockRetry = jest.fn();
jest.mock("@/features/profile/hooks/useEnsureOwnProfileLoaded", () => ({
	useEnsureOwnProfileLoaded: () => ({
		isProfileResolved: mockIsProfileResolved,
		hasLoadFailed: mockHasLoadFailed,
		retry: mockRetry,
	}),
}));
// プロフィールの «有無» で編集画面の描画が変わる（下の「未ロードの間は…」のテスト）ので差し替え可能にする
let mockProfile: unknown = { id: "profile-1", username: "tester" };
jest.mock("@/features/profile/stores/useProfileStore", () => ({
	useProfileStore: (selector: (state: { profile: unknown }) => unknown) => selector({ profile: mockProfile }),
}));

// フォームの中身（バリデーション・アップロード・API）は ProfileEditForm の関心。
// ここで見たいのは「保存できたとき画面がどう離脱するか」だけなので、
// onSaved を押せる形にした器へ差し替える
jest.mock("@/features/profile/components/ProfileEditForm", () => {
	const ReactActual = jest.requireActual("react");
	const { View: RNView } = jest.requireActual("react-native");
	return {
		ProfileEditForm: ({ onSaved }: { onSaved: () => void }) =>
			ReactActual.createElement(RNView, { testID: "profile-edit-form-saved", onPress: onSaved }),
	};
});

import ProfileScreen from "../app/[locale]/(tabs)/profile/index";
import ProfileEditScreen from "../app/[locale]/(tabs)/profile/edit";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ⚠️ 描画したツリーは必ず unmount すること（テスト終了後の setState と環境破棄の競合を避ける）
const mountedTrees: TestRenderer.ReactTestRenderer[] = [];
const render = async (element: React.ReactElement) => {
	let tree!: TestRenderer.ReactTestRenderer;
	await act(async () => {
		tree = TestRenderer.create(element);
	});
	mountedTrees.push(tree);
	return tree;
};

afterEach(async () => {
	await act(async () => {
		mountedTrees.splice(0).forEach((tree) => tree.unmount());
	});
});

/** 指定 testID の要素を押す */
const press = async (tree: TestRenderer.ReactTestRenderer, testID: string): Promise<void> => {
	const target = tree.root.find((node) => node.props?.testID === testID);
	await act(async () => {
		await target.props.onPress();
	});
};

beforeEach(() => {
	mockProfile = { id: "profile-1", username: "tester" };
	mockIsProfileResolved = true;
	mockHasLoadFailed = false;
	mockRetry.mockClear();
	mockPush.mockClear();
	mockReplace.mockClear();
	mockBack.mockClear();
	mockCanDismiss = false;
	mockCanGoBack = true;
});

describe("#1369 マイページから編集画面への導線", () => {
	it("「プロフィールを編集」は編集ルートへ locale 付きで push する", async () => {
		const tree = await render(<ProfileScreen />);

		await press(tree, "profile-edit-button");

		expect(mockPush).toHaveBeenCalledTimes(1);
		expect(mockPush).toHaveBeenCalledWith({
			pathname: "/[locale]/(tabs)/profile/edit",
			params: { locale: "ja-JP" },
		});
	});
});

describe("#1369 プロフィール編集画面の離脱", () => {
	it("戻るを押すと、履歴があれば back で戻る", async () => {
		mockCanDismiss = true;
		const tree = await render(<ProfileEditScreen />);

		await press(tree, "profile-edit-screen-back");

		expect(mockBack).toHaveBeenCalledTimes(1);
		expect(mockReplace).not.toHaveBeenCalled();
	});

	/*
	#1404 【バグ】判定に `canGoBack()` を使うと、**この画面へ URL 直リンクで着地したときに
	親へ倒す保険が働かない**。

	`canGoBack()` は React Navigation のナビゲーション状態を親までさかのぼって見る。
	`(tabs)/_layout.tsx` が `initialRouteName="search"` を指定しているため、`(tabs)` 配下の
	ルートへ直接着地するとタブナビゲータが «検索へ戻れる» と答え、true になる。
	その結果、戻るはマイページではなく **検索タブ** へ飛ぶ。

	`canDismiss()` は «スタックが 2 枚以上あるか» だけを見るので、タブ履歴に影響されない。

	⚠️ ここが赤くなったら `canGoBack()` へ戻っている。実機・E2E でしか気付けない形になる。
	*/
	it("canGoBack が true でも、スタックが 1 枚ならマイページへ replace する", async () => {
		mockCanGoBack = true;
		mockCanDismiss = false;
		const tree = await render(<ProfileEditScreen />);

		await press(tree, "profile-edit-screen-back");

		expect(mockBack).not.toHaveBeenCalled();
		expect(mockReplace).toHaveBeenCalledWith({
			pathname: "/[locale]/(tabs)/profile",
			params: { locale: "ja-JP" },
		});
	});

	it("戻るを押したとき履歴が無ければマイページへ replace する", async () => {
		mockCanDismiss = false;
		const tree = await render(<ProfileEditScreen />);

		await press(tree, "profile-edit-screen-back");

		// URL 直リンク・web のリロードで着地した場合。back すると «アプリの外» へ出てしまう
		expect(mockBack).not.toHaveBeenCalled();
		expect(mockReplace).toHaveBeenCalledWith({
			pathname: "/[locale]/(tabs)/profile",
			params: { locale: "ja-JP" },
		});
	});

	it("保存が成功したら、戻ると同じ判定で離脱する", async () => {
		mockCanDismiss = true;
		const tree = await render(<ProfileEditScreen />);

		await press(tree, "profile-edit-form-saved");

		// モーダル時代の `close()` に相当する。保存したのに画面が残る（#498 型）を作らない
		expect(mockBack).toHaveBeenCalledTimes(1);
	});

	it("プロフィールが未ロードの間はフォームを描かない（戻る導線は残す）", async () => {
		// ProfileEditForm は初期値を mount 時に 1 回だけ読む。空のまま mount すると
		// 後から profile が届いても表示名・自己紹介が空欄のままになる
		mockProfile = null;
		// #1387 «まだ読んでいない» 側。決着していないのでエラーではなくスピナー
		mockIsProfileResolved = false;
		const tree = await render(<ProfileEditScreen />);

		expect(tree.root.findAll((node) => node.props?.testID === "profile-edit-form-saved")).toHaveLength(0);
		// 読み込み中にエラーを出さないこと（出すと «一瞬エラーが見えて消える» になる）
		expect(tree.root.findAll((node) => node.props?.testID === "profile-edit-error")).toHaveLength(0);
		// 待っている間も離脱できること（ゲートの外にヘッダーがある）
		expect(tree.root.findAll((node) => node.props?.testID === "profile-edit-screen-back").length).toBeGreaterThan(0);
	});

	it("保存が成功したとき履歴が無ければマイページへ replace する", async () => {
		mockCanDismiss = false;
		const tree = await render(<ProfileEditScreen />);

		await press(tree, "profile-edit-form-saved");

		expect(mockReplace).toHaveBeenCalledWith({
			pathname: "/[locale]/(tabs)/profile",
			params: { locale: "ja-JP" },
		});
	});
});

/*
#1387 【バグ】プロフィール取得が 404 «以外» で失敗（通信断・500 など）すると、
`useEnsureOwnProfileLoaded` は profile を null のまま `isProfileResolved` だけ true にして終わる。
編集画面は profile だけを見ていたため、その人の画面は **スピナーが永久に回り続けていた**。

⚠️ ここが赤くなったら、決着済みの失敗を «読み込み中» と同じ見た目で出している。
ユーザーには終わらない読み込みにしか見えないので、待っても何も起きない。
*/
describe("#1387 プロフィール取得に失敗したときの編集画面", () => {
	/** 「決着したが取れなかった」= 失敗が確定した状態 */
	const arrangeFailed = () => {
		mockProfile = null;
		mockIsProfileResolved = true;
		mockHasLoadFailed = true;
	};

	it("スピナーではなくエラーと再試行を出す", async () => {
		arrangeFailed();
		const tree = await render(<ProfileEditScreen />);

		expect(tree.root.findAll((node) => node.props?.testID === "profile-edit-error").length).toBeGreaterThan(0);
		expect(
			tree.root.findAll((node) => node.props?.testID === "profile-edit-retry-button").length,
		).toBeGreaterThan(0);
		// 空のフォームを mount しないことは «未ロード» のときと同じく守る
		expect(tree.root.findAll((node) => node.props?.testID === "profile-edit-form-saved")).toHaveLength(0);
	});

	it("再試行を押すとフックの retry が呼ばれる", async () => {
		arrangeFailed();
		const tree = await render(<ProfileEditScreen />);

		await press(tree, "profile-edit-retry-button");

		expect(mockRetry).toHaveBeenCalledTimes(1);
	});

	/*
	触覚は PrimaryButton 自身が handlePress の中で鳴らす（components/PrimaryButton.tsx）。
	画面側の onPress でも鳴らすと 1 タップで 2 回になる（PR #1392 のレビュー T-1）。

	⚠️ `press()` が呼ぶのは «画面が PrimaryButton へ渡した onPress»（合成要素の props）であって、
	PrimaryButton 内部の handlePress ではない。だからここで数えているのは «画面側の分» だけで、
	0 回であることが正しい。1 になったら画面側でも鳴らしている。
	ヘッダーの戻る（handleBack）は ScreenHeader が鳴らさないので、あちらは鳴らして正しい。
	*/
	it("再試行では画面側が触覚を鳴らさない（PrimaryButton が鳴らすので二重になる）", async () => {
		arrangeFailed();
		const tree = await render(<ProfileEditScreen />);

		await press(tree, "profile-edit-retry-button");

		expect(mockLightImpact).not.toHaveBeenCalled();
	});

	// ⚠️ «決着済み × profile なし» でも、フックが失敗と言っていなければエラーを出さないこと。
	// 共有ストアは第三者（セッション切替 / 別画面のフックの mount）が空にする。
	// ここが赤くなったら «失敗の推論» に戻っている（PR #1392 のレビュー B-1）
	it("ストアが空でもフックが失敗と言わなければエラーを出さない", async () => {
		mockProfile = null;
		mockIsProfileResolved = true;
		mockHasLoadFailed = false;

		const tree = await render(<ProfileEditScreen />);

		expect(tree.root.findAll((node) => node.props?.testID === "profile-edit-error")).toHaveLength(0);
		// 取得し直しを待っている状態なのでスピナー側へ倒れる
		expect(tree.root.findAll((node) => node.props?.testID === "profile-edit-form-saved")).toHaveLength(0);
	});

	// ⚠️ 押下のテストが 1 本だと «回数» のアサーションが意味を持たない（PR #1392 のレビュー T-2）。
	// なお beforeEach の mockClear 自体は jest.config.js の clearMocks: true と重複している
	it("2 回押せば 2 回呼ばれる（前のテストの回数を持ち越さない）", async () => {
		arrangeFailed();
		const tree = await render(<ProfileEditScreen />);

		await press(tree, "profile-edit-retry-button");
		await press(tree, "profile-edit-retry-button");

		expect(mockRetry).toHaveBeenCalledTimes(2);
	});

	// i18n キーの typo は «描かれている» だけでは気付けない（PR #1392 のレビュー S-3）。
	// このファイルの i18n スタブは `t: (key) => key` なので、描画結果がそのままキーになる
	it("文言は Common.errors.unexpected / Common.retry を使う", async () => {
		arrangeFailed();
		const tree = await render(<ProfileEditScreen />);

		const texts = tree.root
			.findAll((node) => typeof node.props?.children === "string", { deep: false })
			.map((node) => node.props.children as string);

		expect(texts).toContain("Common.errors.unexpected");
		expect(texts).toContain("Common.retry");
	});

	// 失敗表示は «行き止まり» にしないこと。再試行が通らない環境でも離脱はできる必要がある
	// ⚠️ 戻るの testID は #1404 で画面ごと（${testID}-back）になった。
	// 共通 id のままにすると «存在しない id を探して常に緑» になる
	it("失敗表示のままでも戻れる", async () => {
		arrangeFailed();
		const tree = await render(<ProfileEditScreen />);

		expect(
			tree.root.findAll((node) => node.props?.testID === "profile-edit-screen-back").length,
		).toBeGreaterThan(0);
	});

	/*
	B-1 の «裏返し»（PR #1392 の再レビュー N-1）。

	hasLoadFailed は «他者がプロフィールを載せた» ことでは下りない。失敗したあとに別の消費者が
	取得に成功すると、**データが store にあるのにエラー画面** が残りうる。
	画面側で `&& !profile` を掛けて、データがあるなら失敗表示を取り消す。

	⚠️ これは «ストアから失敗を推論する»（B-1 でやめた形）とは逆向きである。
	失敗の判定は hasLoadFailed が持ち、profile はそれを取り消す方向にしか効かない。
	*/
	it("失敗フラグが立っていても、プロフィールが載っていればフォームを描く", async () => {
		mockProfile = { id: "profile-1", username: "tester" };
		mockIsProfileResolved = true;
		mockHasLoadFailed = true;

		const tree = await render(<ProfileEditScreen />);

		expect(tree.root.findAll((node) => node.props?.testID === "profile-edit-error")).toHaveLength(0);
		expect(tree.root.findAll((node) => node.props?.testID === "profile-edit-form-saved").length).toBeGreaterThan(0);
	});

	// プロフィールが取れているときにエラーが出ないこと（対照）。
	// ⚠️ 前提は直前のテストの残りに頼らず自分で置くこと（PR #1392 のレビュー T-2）
	it("取得できていればエラーは出ない", async () => {
		mockIsProfileResolved = true;
		mockHasLoadFailed = false;
		const tree = await render(<ProfileEditScreen />);

		expect(tree.root.findAll((node) => node.props?.testID === "profile-edit-error")).toHaveLength(0);
		expect(tree.root.findAll((node) => node.props?.testID === "profile-edit-form-saved").length).toBeGreaterThan(0);
	});
});
