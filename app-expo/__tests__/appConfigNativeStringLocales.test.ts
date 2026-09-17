/*
#1928 【設計】«アプリ本体の `locales` が届かない場所に置かれたユーザー向けネイティブ文言が、
日本語端末でも英語のまま出る» という欠陥を復活させないための回帰テスト。

## 何が起きたか

日本語端末の Instagram の共有シートで、このアプリだけ「CraveCatch - Find your dish」と
英語で並んでいた（ホーム画面は「なに食べよ」）。Expo の `withLocales` は
`ios/<project>/Supporting/<lang>.lproj` を **アプリ本体ターゲットにしか**作らないのに対し、
`expo-share-intent` が生やす Share Extension は **別バンドル**で `.lproj` を 1 つも持たず、
表示名が開発地域（en）へ落ちていた。

同じ形の欠陥が許可ダイアログにもあった（カメラ / マイク / 写真ライブラリ / ATT の文言が
`languages/*.json` に無く、英語のまま）。

## 何を固定するか（個別の値ではなく «形» を固定する）

1. `ios.infoPlist` と各 plugin へ渡した **ユーザーに見える文言は、すべて 8 言語ぶん翻訳がある**
   （＝ 新しい許可を足したとき、翻訳を忘れたら落ちる）
2. その既定値は `languages/en-US.json` から取っており、**app.config.ts へ写経されていない**
3. Share Extension のバンドルへ翻訳を焼き込む plugin が、`expo-share-intent` **より前**に居る
   （同じ mod は後から登録したものが先に走るので、配列上の «前» が実行順の «後» になる）
*/
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import type { ExpoConfig } from "@expo/config";

const loadConfig = (): ExpoConfig => require("../app.config").default({ config: {} });

const LANGUAGES_DIR = join(__dirname, "../languages");

const readLanguageFile = (fileName: string): { ios: Record<string, string>; android: Record<string, string> } =>
	JSON.parse(readFileSync(join(LANGUAGES_DIR, fileName), "utf8"));

const languageFiles = () => readdirSync(LANGUAGES_DIR).filter((name) => name.endsWith(".json")).sort();

/**
 * 写経の検査はコードだけを見る。**コメントで «こういう文字列が出ていた» と説明するのは写経ではない**
 * （むしろ経緯として残すべきもの）ので、行コメントとブロックコメントを落としてから走査する。
 */
const codeWithoutComments = (relativePath: string): string =>
	readFileSync(join(__dirname, relativePath), "utf8")
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/^[ \t]*\/\/.*$/gm, "");

/**
 * `plugins` に渡した設定値のうち、ユーザーへ提示される許可ダイアログの文言を、
 * 対応する Info.plist のキーへ読み替えて集める。
 * **plugin を足して文言オプションを渡したら、ここへ 1 行足すこと**（足さないと 1 の検査を素通りする）。
 */
const PERMISSION_OPTION_TO_INFO_PLIST_KEY: Record<string, string> = {
	cameraPermission: "NSCameraUsageDescription",
	microphonePermission: "NSMicrophoneUsageDescription",
	photosPermission: "NSPhotoLibraryUsageDescription",
	locationWhenInUsePermission: "NSLocationWhenInUseUsageDescription",
	locationAlwaysAndWhenInUsePermission: "NSLocationAlwaysAndWhenInUseUsageDescription",
	locationAlwaysPermission: "NSLocationAlwaysUsageDescription",
	userTrackingPermission: "NSUserTrackingUsageDescription",
};

/** ネイティブでユーザーの目に触れる文言のキーと、その既定値。 */
const userFacingNativeStrings = (): Map<string, string> => {
	const config = loadConfig();
	const collected = new Map<string, string>();

	const displayName = config.ios?.infoPlist?.CFBundleDisplayName;
	if (typeof displayName === "string") {
		collected.set("CFBundleDisplayName", displayName);
	}
	for (const [key, value] of Object.entries(config.ios?.infoPlist ?? {})) {
		if (key.endsWith("UsageDescription") && typeof value === "string") {
			collected.set(key, value);
		}
	}
	for (const plugin of config.plugins ?? []) {
		if (!Array.isArray(plugin)) continue;
		const [, options] = plugin as [string, Record<string, unknown> | undefined];
		for (const [option, infoPlistKey] of Object.entries(PERMISSION_OPTION_TO_INFO_PLIST_KEY)) {
			const value = options?.[option];
			if (typeof value === "string") {
				collected.set(infoPlistKey, value);
			}
		}
	}
	return collected;
};

describe("#1928 ネイティブに出る文言の翻訳", () => {
	it("languages/*.json は 8 言語そろっていて、ios のキー集合が全言語で一致する", () => {
		const files = languageFiles();
		expect(files.length).toBe(8);

		const [first, ...rest] = files;
		const baseline = Object.keys(readLanguageFile(first).ios).sort();
		for (const file of rest) {
			expect({ file, keys: Object.keys(readLanguageFile(file).ios).sort() }).toEqual({ file, keys: baseline });
		}
	});

	it("ユーザーに見えるネイティブ文言は、例外なく全言語ぶん翻訳がある", () => {
		const required = [...userFacingNativeStrings().keys()].sort();
		// 少なくとも表示名と主要な許可ダイアログは拾えているはず（集め方が壊れたことに気づくため）
		expect(required).toContain("CFBundleDisplayName");
		expect(required).toContain("NSCameraUsageDescription");
		expect(required).toContain("NSUserTrackingUsageDescription");

		const missing: string[] = [];
		for (const file of languageFiles()) {
			const translated = readLanguageFile(file).ios;
			for (const key of required) {
				if (!translated[key]) missing.push(`${file}: ${key}`);
			}
		}
		expect(missing).toEqual([]);
	});

	it("既定値は languages/en-US.json から取っており、app.config.ts へ写経されていない", () => {
		const english = readLanguageFile("en-US.json").ios;
		for (const [key, value] of userFacingNativeStrings()) {
			expect({ key, value }).toEqual({ key, value: english[key] });
		}

		// 写経の再発は «同じ文字列がソースへ直接書かれていないか» で見張る
		const source = codeWithoutComments("../app.config.ts");
		for (const value of Object.values(english)) {
			expect(source).not.toContain(value);
		}
	});

	it("Android の app_name も全言語ぶんある", () => {
		for (const file of languageFiles()) {
			expect({ file, appName: Boolean(readLanguageFile(file).android?.app_name) }).toEqual({ file, appName: true });
		}
	});
});

describe("#1928 Share Extension のバンドルへ翻訳を届ける plugin", () => {
	const pluginNames = () =>
		(loadConfig().plugins ?? []).map((plugin) => (Array.isArray(plugin) ? plugin[0] : plugin) as string);

	/*
	同じ mod（`ios.xcodeproj`）へ積んだ plugin は **後から登録したものが先に走る**
	（@expo/config-plugins の `withMod` が新しい action で既存の chain を包むため LIFO）。
	拡張のターゲットと Info.plist が出来た後で上書きしたいので、**配列上は前**に置く必要がある。
	逆にすると prebuild が «ターゲットが見つからない» で落ちる（実際に踏んで確かめた）。
	*/
	it("expo-share-intent より «前» に置かれている（同じ mod は後勝ちで先に走る）", () => {
		const names = pluginNames();
		const shareIntent = names.indexOf("expo-share-intent");
		const locales = names.indexOf("./plugins/withShareExtensionLocales");
		expect(shareIntent).toBeGreaterThanOrEqual(0);
		expect(locales).toBeGreaterThanOrEqual(0);
		expect(locales).toBeLessThan(shareIntent);
	});

	it("拡張へ書き込む表示名は languages/*.json から読む（plugin へ写経しない）", () => {
		const source = codeWithoutComments("../plugins/withShareExtensionLocales.js");
		for (const file of languageFiles()) {
			expect(source).not.toContain(readLanguageFile(file).ios.CFBundleDisplayName);
		}
	});
});
