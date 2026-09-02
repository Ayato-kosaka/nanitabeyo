// #1092 PR3 AsyncStorage の native モジュールは jest では null なので、import した時点で
// 「NativeModule: AsyncStorage is null」で suite ごと落ちる。
// `lib/remoteConfig.ts` が Remote Config の永続キャッシュ（stale-while-revalidate）で
// AsyncStorage を読むようになったため、パッケージ公式のインメモリ実装へ差し替えておく。
//
// ⚠️ 各 suite で個別に jest.mock するのではなく、ここで一括して差し替える。
//    AsyncStorage は supabase / logQueue など芋づるで読み込まれる位置に居るので、
//    「テストを書き足したら関係ない依存で落ちた」を毎回踏まないようにするため。
//
// 状態（__INTERNAL_MOCK_STORAGE__）は suite 内で共有される。中身に依存するテストは
// beforeEach で `AsyncStorage.clear()` すること。
jest.mock("@react-native-async-storage/async-storage", () =>
	require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);

// #1087 jest-expo は app.config.ts を評価しないため `Constants.expoConfig` は空オブジェクトになる。
// 一方 `constants/Env.ts` は `extra.eas.projectId` を無条件に触るので、Env へ到達した suite は
// 「Cannot read properties of undefined (reading 'projectId')」で **ロード段階ごと**落ちる。
// Env は lib/supabase → contexts/AuthProvider → 各 hooks と芋づるで読み込まれる位置に居るため、
// AsyncStorage と同じ理由でここへ一括して置く（画面を描画する suite は必ず踏む）。
//
// ⚠️ 値はテスト用のダミー。**本物の app.config.ts の値と一致させる必要はない**が、
//    Env 経由の値をアサートするテストを書くときは、この既定値を見ていることに注意すること。
jest.mock("expo-constants", () => {
	const actual = jest.requireActual("expo-constants");
	const expoConfig = { ...(actual.default?.expoConfig ?? {}) };
	expoConfig.version = expoConfig.version ?? "0.0.0-test";
	expoConfig.extra = { eas: { projectId: "00000000-0000-0000-0000-000000000000" }, ...(expoConfig.extra ?? {}) };
	// `__esModule: true` は明示すること。requireActual の戻り値では非列挙で定義されており
	// スプレッドでは引き継がれないため、落とすと babel の interop が既定 export を解決できなくなる
	return { ...actual, __esModule: true, default: { ...actual.default, expoConfig } };
});

// #1397 `@lodev09/react-native-true-sheet` はネイティブビュー（Fabric の codegen 生成物）を
// 持つため、jest-expo の環境ではそのままレンダーできない。パッケージは
// `@lodev09/react-native-true-sheet/mock` を同梱しているが、pnpm + jest の subpath exports
// 解決に依存させたくないので、同等の最小実装をここへ置く。
//
// ⚠️ このモックは **present / dismiss の状態を持たない**（children を常に描く）。
//    「開いているときだけ中身がある」ことをテストで見たい側は、コンポーネント自身が
//    描き分けていること（例: MyDishesRestaurantSheet は `pin === null` で中身を描かない）
//    を前提にすること。ここへ present 状態を足すと、モックが本物より賢くなって嘘をつく。
jest.mock("@lodev09/react-native-true-sheet", () => {
	const React = require("react");
	const { View } = require("react-native");

	const renderSlot = (slot) => {
		if (!slot) return null;
		return React.isValidElement(slot) ? slot : React.createElement(slot);
	};

	class TrueSheet extends React.Component {
		present = jest.fn(() => Promise.resolve());
		dismiss = jest.fn(() => Promise.resolve());
		dismissStack = jest.fn(() => Promise.resolve());
		resize = jest.fn(() => Promise.resolve());
		render() {
			const { children, style, header, footer, testID } = this.props;
			return React.createElement(
				View,
				{ style, testID },
				renderSlot(header),
				children,
				renderSlot(footer),
			);
		}
	}

	return {
		__esModule: true,
		TrueSheet,
		TrueSheetProvider: ({ children }) => children,
		TrueSheetPeek: ({ children, ...rest }) => React.createElement(View, rest, children),
		useTrueSheet: () => ({
			present: jest.fn(() => Promise.resolve()),
			dismiss: jest.fn(() => Promise.resolve()),
			dismissAll: jest.fn(() => Promise.resolve()),
			dismissStack: jest.fn(() => Promise.resolve()),
			resize: jest.fn(() => Promise.resolve()),
		}),
	};
});

/*
#1629 **safe area は全テストで既定のモックを敷く。**

`useSafeAreaInsets()` は `<SafeAreaProvider>` が無いと «No safe area value available» で
throw する。本番はアプリの根に必ず居るので問題ないが、テストは対象コンポーネントだけを
素で描くので、**下端の余白を足しただけで無関係なテストが 9 本落ちた**（実際に起きた）。

ライブラリ同梱のモック（inset は 0）を敷いておけば、safe area を «使ったかどうか» に
テストが左右されなくなる。個別に上書きしたいテストは、これまでどおり
`jest.mock("react-native-safe-area-context", ...)` を書けば勝つ。
*/
jest.mock("react-native-safe-area-context", () => require("react-native-safe-area-context/jest/mock").default);
