/*
このファイルの責務
- 取り込み画面（`app/[locale]/add-record.tsx`）が読み取り結果の下に出す
  **1 行の文言**を、レスポンスから決める。文言そのものは持たない（i18n のキーを返す）。

## なぜ画面から切り出すのか

#1834【チーム指摘】「読み取れたのか、読み取れてないのかよく分からんかった」。
真因は分岐が «候補が 1 件でもあるか» だけだったことで、**サーバは理由まで返していたのに
画面がそれを見ていなかった**。分岐を JSX の中の三項演算子で持つとテストできず、
理由が増えるたびに «どれがどの文言になるのか» が読めなくなる。純関数にして表で持つ。
*/
import type { ResolveDishMediaImportResponse } from "@shared/api/v1/res";

/** `SnsImport.result.*` の i18n キー */
export type SnsImportResultSummaryKey =
	| "SnsImport.result.summary"
	| "SnsImport.result.noInfo"
	| "SnsImport.result.fetchFailed";

/**
 * 読み取り結果に対して出す文言のキーを決める。
 *
 * | 状態 | 出すもの | ユーザーが次にすること |
 * | --- | --- | --- |
 * | 候補が 1 件でもある | `summary`（読み取りました） | 候補から選ぶ |
 * | **取りに行って失敗した**（`unknown`） | `fetchFailed`（取得できなかった／もう一度） | 押し直す or 手入力 |
 * | 取れたが手がかりが無い（`ok` で候補ゼロ） | `noInfo` | 手入力 |
 *
 * ⚠️ **`unknown` を `noInfo` に混ぜないこと。** «投稿に情報が無い» と
 *    «こちらが取れなかった» では、ユーザーが次に取る行動が違う。実測では
 *    Instagram のレート制限（302）がこの `unknown` として出ており、
 *    押し直すと取れることがある（2026-09-04 本番ログ）。
 *
 * ⚠️ `unsupported` / `unavailable` はここへ来ない（呼び出し側が先に分岐して
 *    `SnsImport.reasons.*` を出す）。混ぜると «URL が悪い» と «一時的に取れない» が
 *    また同じ文言に戻る。
 */
export function resolveResultSummaryKey(
	resolved: Pick<ResolveDishMediaImportResponse, "status" | "candidates">,
): SnsImportResultSummaryKey {
	const hasCandidates = resolved.candidates.dishCategories.length > 0 || resolved.candidates.restaurants.length > 0;
	if (hasCandidates) return "SnsImport.result.summary";
	return resolved.status === "unknown" ? "SnsImport.result.fetchFailed" : "SnsImport.result.noInfo";
}

/*
#1918【チーム指摘】「読み取ってからの操作が直感的に分かりにくい」「手入力方式もあるんかな？」

欠陥をパターンで言い直すと «読み取り結果を «システムの答え（確認してもらうもの）» ではなく
«ユーザーが埋めるフォームの部品» として並べていた»。見出しがその一部で、
「お店を選ぶ」「料理カテゴリーを選ぶ」という命令形は **読み取りへの言及がゼロ**なので、
候補チップと結びつかず «自分で入れる欄» に読める。

候補があるときだけ «読み取った◯◯を確認» へ振る。候補ゼロは異常系ではなく主要経路
（Instagram はサーバ側にメタデータ取得手段が無い）なので、そこは従来どおり «選ぶ» のままにする。
«読み取った候補を確認» と言いながら候補が 1 つも無いのは嘘になる。

⚠️ **i18n は動的キー生成が禁止**（CONTRIBUTING §i18n。未翻訳検出が壊れる）。
だから静的キーを 2 本持ってここで選ぶ。画面側に三項演算子を書かないのは
`resolveResultSummaryKey` と同じ理由で、**テストできる場所に判断を集める**ため。
*/

/** ②③ のステップ見出しに使う i18n キー */
export interface SnsImportStepHeadingKeys {
	restaurant: "SnsImport.steps.restaurant" | "SnsImport.steps.restaurantConfirm";
	dishCategory: "SnsImport.steps.dish" | "SnsImport.steps.dishConfirm";
}

/**
 * ②③ の見出しキーを、**その種類の候補があるかどうか**で決める。
 *
 * 店舗と料理を別々に見るのが肝で、片方だけ候補が出るのは普通に起きる
 * （キャプションに料理名だけあって店名が無い、など）。まとめて 1 つのフラグで
 * 振ると、候補ゼロの側に «読み取った◯◯を確認» が出てしまう。
 *
 * `resolved` が無い（まだ読み取っていない）ときは «選ぶ» 側。
 */
export function resolveStepHeadingKeys(
	resolved: Pick<ResolveDishMediaImportResponse, "candidates"> | null | undefined,
): SnsImportStepHeadingKeys {
	return {
		restaurant:
			(resolved?.candidates.restaurants.length ?? 0) > 0
				? "SnsImport.steps.restaurantConfirm"
				: "SnsImport.steps.restaurant",
		dishCategory:
			(resolved?.candidates.dishCategories.length ?? 0) > 0 ? "SnsImport.steps.dishConfirm" : "SnsImport.steps.dish",
	};
}
