// #1079 app-expo のユニットテスト設定。
// package.json には "test": "jest --watchAll" という Expo テンプレの残骸だけがあり
// jest 本体が入っていなかったため、フロントの純ロジック（lib/ 配下）に一切テストが書けなかった。
const jestExpoPreset = require("jest-expo/jest-preset");

// jest-expo の既定の transformIgnorePatterns は
//   /node_modules/(?!((jest-)?react-native|@react-native...|expo...)/)
// という「node_modules 直下にパッケージ名が来る」前提で書かれている。
// pnpm の実体パスは /node_modules/.pnpm/<pkg>@<ver>/node_modules/<pkg>/... となり、
// 最初の /node_modules/ の直後が ".pnpm" なので許可リストに当たらず、
// react-native 等の Flow 構文のソースが素通しされて SyntaxError になる。
// そこで「最後の /node_modules/ でのみ判定する」ようにし、pnpm でも素の node_modules でも
// 同じ許可リストが効くようにする。
const ALLOWED_TO_TRANSFORM =
	"((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|native-base|react-native-svg";

/** @type {import('jest').Config} */
module.exports = {
	...jestExpoPreset,
	transformIgnorePatterns: [
		`/node_modules/(?!.*/node_modules/)(?!(?:${ALLOWED_TO_TRANSFORM}))`,
		"/node_modules/react-native-reanimated/plugin/",
	],
	// #1092 PR3 preset 側の setupFiles（react-native / jest-expo）は必ず残すこと。
	// 消すと react-native の native モジュールのモックごと消える
	setupFiles: [...(jestExpoPreset.setupFiles ?? []), "<rootDir>/jest.setup.js"],
	testMatch: ["<rootDir>/**/*.test.ts", "<rootDir>/**/*.test.tsx"],
	testPathIgnorePatterns: ["/node_modules/", "/dist/", "/dist-e2e-check/", "/.expo/", "/e2e/"],
	// テスト間でモック呼び出し履歴を持ち越さない（logQueue のようなモジュール状態を持つ対象で事故りやすい）
	clearMocks: true,
};
