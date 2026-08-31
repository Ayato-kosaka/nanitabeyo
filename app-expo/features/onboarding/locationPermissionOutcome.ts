/*
このファイルの責務
- オンボーディングの位置情報許可画面（app/[locale]/onboarding/location.tsx）が
  **このアプリ起動中に** 何と答えられたかを覚えておく。

#1736 【バグ】**断った直後に、説明の無い許可ダイアログがもう一度出る。**

Welcome の「はじめる」で検索画面へ戻ると、検索画面は現在地の自動取得を走らせる
（features/search/hooks/useAutoCurrentLocation.ts → hooks/useCurrentLocationPosition.ts）。
その入口は `requestForegroundPermissionsAsync()` を **無条件で**呼ぶため、
オンボーディングで «許可しない» と答えた人にも Android は（`canAskAgain` が残っている限り）
同じダイアログをもう一度出す。ユーザーから見ると「今断ったのに、また聞かれた」になる。

そこで «オンボーディングがこの起動で尋ねて、許可されなかった» ことだけを覚えておき、
自動取得側がそれを見て要求を見送る。永続化しない（AsyncStorage へ書かない）のは、
次回の起動や、設定アプリで許可へ変えて戻ってきた場合まで抑止したくないため。

⚠️ ユーザー操作起点の取得（検索画面の «現在地» ボタン）は抑止しない。
自分で押した人には OS のダイアログが出るのが正しい。
*/
import type { PermissionOutcome } from "./permissions";

/** `null` = このアプリ起動中、オンボーディングはまだ位置情報を尋ねていない */
let outcome: PermissionOutcome | null = null;

/** オンボーディングの位置情報許可の答えを記録する */
export const rememberOnboardingLocationOutcome = (next: PermissionOutcome): void => {
	outcome = next;
};

/** オンボーディングがこの起動で受け取った答え。まだ尋ねていなければ `null` */
export const getOnboardingLocationOutcome = (): PermissionOutcome | null => outcome;

/** テスト専用: モジュールスコープの状態を初期化する */
export const __resetOnboardingLocationOutcomeForTest = (): void => {
	outcome = null;
};
