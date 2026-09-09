const fs = require("node:fs");
const path = require("node:path");

const { withXcodeProject, IOSConfig } = require("expo/config-plugins");

/**
 * `@expo/plist` は Expo の config plugin 基盤が持っている依存で、このパッケージの直接の依存ではない。
 * pnpm の厳密な node_modules では素の require が解決できないため、`expo/config-plugins` の
 * 位置から辿る。**依存を 1 つ増やさないための解決であって、深追いする意味は無い。**
 *
 * ⚠️ **モジュールの読み込み時に解決しないこと（= トップレベルへ書かないこと）。**
 * この plugin ファイルは prebuild だけでなく **`eas update`（OTA）でも読み込まれる**
 * （`expo config` が plugins を resolve するため。ファイルを消して実際に確かめた）。
 * トップレベルで解決すると、解決に失敗した瞬間に **OTA 配信ごと落ちる**。
 * ここで要るのは prebuild のときだけなので、mod の中まで遅らせる。
 */
const requirePlist = () =>
	require(require.resolve("@expo/plist", { paths: [path.dirname(require.resolve("expo/config-plugins"))] })).default;

/**
 * #1928 【設計】iOS Share Extension のバンドルへ、アプリ本体と同じ表示名の翻訳を焼き込む。
 *
 * ## 何が壊れていたか
 *
 * 日本語端末で Instagram の共有シートを開くと、このアプリだけ
 * 「CraveCatch - Find your dish」（英語）で並んでいた。ホーム画面は「なに食べよ」なのに、である。
 *
 * 原因は **翻訳の置き場所がアプリ本体ターゲットにしか無かった**こと。
 *
 * - `app.config.ts` の `locales` を処理するのは Expo の `withLocales` で、これは
 *   `ios/<project>/Supporting/<lang>.lproj/InfoPlist.strings` を作り、
 *   **アプリ本体ターゲットの Resources にだけ**登録する。
 * - 一方 `expo-share-intent` が生成する Share Extension は **別バンドル（.appex）／別ターゲット**で、
 *   `.lproj` を 1 つも持たない（生成物は `ShareExtension-Info.plist` /
 *   `ShareExtension.entitlements` / storyboard / swift / preprocessor だけ）。
 *
 * Apple の App Extension Programming Guide が要求しているのはこれである
 * — "Make sure you localize the app extension's name when you provide a localized app extension."
 * 翻訳を持たないバンドルの名前は開発地域（`CFBundleDevelopmentRegion` = `en`）へ落ちるので、
 * 共有シートだけが英語になっていた。
 *
 * ⚠️ iOS 13 以降、共有シートに出るのは **拡張の表示名ではなくアプリの名前**になった
 * （Apple Developer Forums thread/122248。Apple の回答は "working as expected"）。
 * だからここで書き込む値は «拡張用の別名» ではなく **アプリ本体と同じ表示名**にする。
 * 出どころは `languages/<locale>.json` の `ios.CFBundleDisplayName` ただ 1 つで、
 * **この plugin へ文字列を書き写さない**（写した複製は本体だけ直したときに古いまま残る）。
 *
 * ## 依存する前提
 *
 * - **`expo-share-intent` が先に走っていること。** ターゲットと `ShareExtension-Info.plist`
 *   （expo-share-intent は毎回これを丸ごと書き直す）が出来た後でないと上書きできない。
 *   ⚠️ そのために `app.config.ts` の `plugins` では **`expo-share-intent` より «前» に書く**。
 *   同じ mod（`ios.xcodeproj`）へ積んだ plugin は **後から登録したものが先に走る**（LIFO）。
 * - 拡張のターゲット名は `expo-share-intent` の既定値 `ShareExtension`（`iosShareExtensionName`
 *   を渡していないため）。ターゲットやグループが見つからなければ **黙って素通りせず例外にする** —
 *   素通りすると「英語のまま出荷される」に戻り、次にオーナーが実機で踏むまで誰も気づけない。
 */
const EXTENSION_TARGET_NAME = "ShareExtension";
const STRINGS_FILE_NAME = "InfoPlist.strings";
/** `CFBundleDevelopmentRegion` = `$(DEVELOPMENT_LANGUAGE)`。Xcode の既定は `en`。 */
const DEVELOPMENT_LANGUAGE = "en";

/**
 * 拡張の PBXNativeTarget を引く。
 *
 * ⚠️ `pbxProject.pbxTargetByName("ShareExtension")` では **引けない**。
 * `expo-share-intent` が使う xcode ライブラリの `addTarget` は、pbxproj へ
 * `name = "ShareExtension";` と **引用符ごと**書き込むため、素の名前と厳密比較すると外れる
 * （ライブラリ自身の «既にあればスキップ» の判定も同じ理由で毎回 false になっている）。
 * 引用符を剥がして突き合わせる。
 */
const findNativeTarget = (project, name) => {
	const targets = project.pbxNativeTargetSection();
	for (const [uuid, target] of Object.entries(targets)) {
		if (uuid.endsWith("_comment") || typeof target !== "object") continue;
		if (String(target.name).replace(/"/g, "") === name) return { uuid, target };
	}
	return null;
};

/**
 * ルートから名前をたどって PBXGroup を引く。
 *
 * ⚠️ `IOSConfig.XcodeUtils.ensureGroupRecursively` の **戻り値を使ってはいけない**。
 * 中で `pbxGroupByName(名前)` を呼んでおり、これは **プロジェクト全体から最初の同名グループ**を返す。
 * アプリ本体側にも `ja.lproj` があるので、拡張の `ja.lproj` を作った直後でも
 * **本体の `ja.lproj` が返ってくる**（＝ そこには既に InfoPlist.strings が居るので
 * 「もう追加済み」と誤判定し、拡張へは 1 つも入らない）。実際にこれを踏んだ。
 * グループの «作成» だけ委ね、参照はこの関数で親からたどる。
 */
const findGroupByPath = (project, segments) => {
	const { firstProject } = project.getFirstProject();
	let group = project.getPBXGroupByKey(firstProject.mainGroup);
	for (const name of segments) {
		const child = group?.children.find(({ comment }) => comment === name);
		if (!child) return null;
		group = project.getPBXGroupByKey(child.value);
	}
	return group ?? null;
};

/** `languages/<locale>.json` を読み、`ios` セクションだけを返す。 */
const readIosLocalization = (projectRoot, localePath) => {
	const resolved = path.resolve(projectRoot, localePath);
	const contents = JSON.parse(fs.readFileSync(resolved, "utf8"));
	return contents.ios ?? {};
};

const withShareExtensionLocales = (config) =>
	withXcodeProject(config, async (cfg) => {
		const locales = cfg.locales ?? {};
		const languages = Object.keys(locales);
		if (languages.length === 0) {
			throw new Error("withShareExtensionLocales: app.config.ts の `locales` が空である");
		}

		const project = cfg.modResults;
		const target = findNativeTarget(project, EXTENSION_TARGET_NAME);
		if (!target) {
			throw new Error(
				`withShareExtensionLocales: Xcode ターゲット "${EXTENSION_TARGET_NAME}" が見つからない。` +
					"app.config.ts の plugins で expo-share-intent より «前» に置かれているか確認すること" +
					"（同じ mod は後から登録したものが先に走る）。",
			);
		}

		const projectRoot = cfg.modRequest.projectRoot;
		const extensionDir = path.join(cfg.modRequest.platformProjectRoot, EXTENSION_TARGET_NAME);

		// 1. 拡張の Info.plist を、本体と同じ «翻訳を持つバンドル» の形にする。
		//    - CFBundleDisplayName の既定値: expo-share-intent が入れる "<name> - Share Extension" は
		//      ユーザーへ見せる文字列として不適切なので、本体の既定（= 開発地域 en の表示名）へ揃える。
		//    - CFBundleLocalizations: このバンドルがどの言語を持つかの宣言。
		//    - CFBundleAllowMixedLocalizations: 本体の infoPlist と同じ扱いに揃える。
		const infoPlistPath = path.join(extensionDir, `${EXTENSION_TARGET_NAME}-Info.plist`);
		const plist = requirePlist();
		const infoPlist = plist.parse(await fs.promises.readFile(infoPlistPath, "utf8"));
		// 既定値は開発地域（`CFBundleDevelopmentRegion` = `$(DEVELOPMENT_LANGUAGE)` = `en`）の翻訳。
		const fallback = readIosLocalization(projectRoot, locales[DEVELOPMENT_LANGUAGE]).CFBundleDisplayName;
		if (!fallback) {
			throw new Error(`withShareExtensionLocales: ${locales[DEVELOPMENT_LANGUAGE]} に ios.CFBundleDisplayName が無い`);
		}
		infoPlist.CFBundleDisplayName = fallback;
		infoPlist.CFBundleLocalizations = languages;
		infoPlist.CFBundleAllowMixedLocalizations = true;
		await fs.promises.writeFile(infoPlistPath, plist.build(infoPlist));

		// 2. 言語ごとの InfoPlist.strings を書き出し、**拡張ターゲットの** Resources へ登録する。
		//    アプリ本体ターゲットへ足しても拡張のバンドルには入らない（それが今回の不具合そのもの）。
		for (const language of languages) {
			const displayName = readIosLocalization(projectRoot, locales[language]).CFBundleDisplayName;
			if (!displayName) {
				throw new Error(`withShareExtensionLocales: ${locales[language]} に ios.CFBundleDisplayName が無い`);
			}

			const localeDir = path.join(extensionDir, `${language}.lproj`);
			await fs.promises.mkdir(localeDir, { recursive: true });
			await fs.promises.writeFile(path.join(localeDir, STRINGS_FILE_NAME), `CFBundleDisplayName = "${displayName}";`);

			const groupName = `${EXTENSION_TARGET_NAME}/${language}.lproj`;
			// 作成だけ任せ、参照は親からたどる（上の findGroupByPath のコメント参照）。
			IOSConfig.XcodeUtils.ensureGroupRecursively(project, groupName);
			const group = findGroupByPath(project, [EXTENSION_TARGET_NAME, `${language}.lproj`]);
			if (!group) {
				throw new Error(`withShareExtensionLocales: PBXGroup "${groupName}" を作れなかった`);
			}
			if (group.children.some(({ comment }) => comment === STRINGS_FILE_NAME)) {
				continue;
			}
			IOSConfig.XcodeUtils.addResourceFileToGroup({
				filepath: `${language}.lproj/${STRINGS_FILE_NAME}`,
				groupName,
				project,
				isBuildFile: true,
				verbose: true,
				targetUuid: target.uuid,
			});
		}

		return cfg;
	});

module.exports = withShareExtensionLocales;
