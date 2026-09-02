// https://docs.expo.dev/guides/using-eslint/

/*
  #1363 【設計】`features/contributionTasks/legacyBlurModal` は社内タスク画面専用の凍結コピーである。
  凍結の価値は「利用者が社内タスク画面だけに閉じていること」に全面的に依存しており、公開アプリから
  1 箇所でも import された時点で、共有部品が全画面を人質に取る元の状態（#1350 §7）へ逆戻りする。
  レビューでの目視に頼らず機械的に落とす。warning は素通りするので必ず error にする。

  #1366 で既存 48 errors を解消し `pnpm --filter app-expo lint` を pr-check.yml へ載せたので、
  このルールは **CI でも評価される**（それ以前は「書いてあるが誰も評価しない」状態だった）。
  それでも scripts/assert-legacy-blur-modal-boundary.mjs は残してある。あちらは
  features/blurModal の復活と Portal の import 許可リストも見ており、ここと範囲が重ならない。
  許可範囲を変えるときは両方を必ず揃えること。
*/
const LEGACY_BLUR_MODAL_PATTERNS = [
	// `@/` エイリアス経由と相対パス経由の両方を塞ぐ。片方だけだと迂回できてしまう。
	"@/features/contributionTasks/legacyBlurModal",
	"@/features/contributionTasks/legacyBlurModal/**",
	"**/features/contributionTasks/legacyBlurModal",
	"**/features/contributionTasks/legacyBlurModal/**",
];

const LEGACY_BLUR_MODAL_MESSAGE =
	"legacyBlurModal は社内タスク画面 (app/[locale]/contribution-tasks) 専用の凍結コピーです。" +
	"公開アプリから import しないでください。詳細は #1350 / #1363 を参照。";

module.exports = {
	extends: "expo",
	/*
	  #1400 (PR3) `/ios/*` `/android/*` は CNG（`expo prebuild`）の生成物で、git 管理外
	  （app-expo/.gitignore）かつ我々が書いたコードではない。prebuild 済みの作業ツリーで
	  `pnpm --filter app-expo lint` を走らせると、expo-share-intent が生成する
	  `ios/ShareExtension/ShareExtensionPreprocessor.js`（拡張の中で **ブラウザ** として動く
	  スクリプトなので `document` を触り、`var` を使う）が no-undef / no-var で **error** になり、
	  「error 0」の完了条件をローカルだけ満たせなくなる。CI は prebuild しないので落ちず、
	  手元でだけ落ちるという気づきにくい壊れ方をするため、明示的に除外する。
	*/
	ignorePatterns: ["/dist/*", "/ios/*", "/android/*", "/types/supabase/database.types.ts"],
	rules: {
		"no-restricted-imports": [
			"error",
			{
				patterns: [
					{
						group: LEGACY_BLUR_MODAL_PATTERNS,
						message: LEGACY_BLUR_MODAL_MESSAGE,
					},
				],
			},
		],
	},
	overrides: [
		{
			/*
			  #1366 【設計】Jest のランタイム下でだけ評価されるファイル。`jest` / `describe` / `expect` は
			  Jest が実行時に注入するグローバルであり、import して使うものではない。env を宣言しないと
			  no-undef が「未定義の変数」として誤検出する（コードの誤りではなく globals 設定の漏れ）。

			  型付きファイル（.ts / .tsx）では eslint-config-expo が no-undef を無効化しているため
			  現に落ちていたのは jest.setup.js だけだが、同じ性質のファイルはまとめてここで宣言する。
			*/
			files: ["jest.setup.js", "**/*.test.ts", "**/*.test.tsx"],
			env: { jest: true },
		},
		{
			/*
			  #1363 【設計】legacyBlurModal を import してよい唯一の範囲。
			  ロケール階層は `[locale]` と直書きせず下のようにワイルドカードで書く。角括弧はグロブでは
			  1 文字の文字クラスとして解釈され、literal な `[locale]` ディレクトリに一致しないため、
			  直書きすると許可範囲が空になり社内タスク画面まで巻き添えで落ちる。
			  凍結モジュール自身の内部 import を塞がないよう features/contributionTasks 配下も許可する。

			  #1350 P6 で features/blurModal は撤去済み。したがって「逆向き（公開アプリから
			  features/blurModal を使う）」という状態はもう存在せず、ここで制限する対象も無い。
			  復活していないことは scripts/assert-legacy-blur-modal-boundary.mjs が CI で見ている
			  （#1366 以降はこの lint も CI で走るが、features/blurModal の «再出現» はグロブでは
			  見られないので、あちらの担当のまま）。
			*/
			files: ["app/**/contribution-tasks/**", "features/contributionTasks/**"],
			rules: {
				"no-restricted-imports": "off",
			},
		},
	],
};
