// https://docs.expo.dev/guides/using-eslint/

/*
  #1363 【設計】`features/contributionTasks/legacyBlurModal` は社内タスク画面専用の凍結コピーである。
  凍結の価値は「利用者が社内タスク画面だけに閉じていること」に全面的に依存しており、公開アプリから
  1 箇所でも import された時点で、共有部品が全画面を人質に取る元の状態（#1350 §7）へ逆戻りする。
  レビューでの目視に頼らず機械的に落とす。warning は素通りするので必ず error にする。
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

			  #1363 【設計】逆向き（公開アプリから features/blurModal を使うこと）は制限しない。
			  他の画面群の移行が終わるまでは正規の利用であり、禁止すると移行途中の全画面が落ちる。
			  features/blurModal の削除は #1350 の P6 で行う。
			*/
			files: ["app/**/contribution-tasks/**", "features/contributionTasks/**"],
			rules: {
				"no-restricted-imports": "off",
			},
		},
	],
};
