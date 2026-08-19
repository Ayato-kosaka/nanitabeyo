// https://docs.expo.dev/guides/using-eslint/

/*
  #1363 【設計】`features/contributionTasks/legacyBlurModal` は社内タスク画面専用の凍結コピーである。
  凍結の価値は「利用者が社内タスク画面だけに閉じていること」に全面的に依存しており、公開アプリから
  1 箇所でも import された時点で、共有部品が全画面を人質に取る元の状態（#1350 §7）へ逆戻りする。
  レビューでの目視に頼らず機械的に落とす。warning は素通りするので必ず error にする。

  ただしこの lint は CI で実行されていない（pr-check.yml に lint の step が無く、既存 48 errors で
  落ちるため今すぐには載せられない）。そこでエディタ上で即座に効くのはこの ESLint ルール、CI の
  最後の砦は scripts/assert-legacy-blur-modal-boundary.mjs、という役割分担にしている。
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
	ignorePatterns: ["/dist/*", "/types/supabase/database.types.ts"],
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
			  #1363 【設計】legacyBlurModal を import してよい唯一の範囲。
			  ロケール階層は `[locale]` と直書きせず下のようにワイルドカードで書く。角括弧はグロブでは
			  1 文字の文字クラスとして解釈され、literal な `[locale]` ディレクトリに一致しないため、
			  直書きすると許可範囲が空になり社内タスク画面まで巻き添えで落ちる。
			  凍結モジュール自身の内部 import を塞がないよう features/contributionTasks 配下も許可する。

			  #1350 P6 で features/blurModal は撤去済み。したがって「逆向き（公開アプリから
			  features/blurModal を使う）」という状態はもう存在せず、ここで制限する対象も無い。
			  復活していないことは scripts/assert-legacy-blur-modal-boundary.mjs が CI で見ている
			  （lint は CI で走っていないため。#1366）。
			*/
			files: ["app/**/contribution-tasks/**", "features/contributionTasks/**"],
			rules: {
				"no-restricted-imports": "off",
			},
		},
	],
};
