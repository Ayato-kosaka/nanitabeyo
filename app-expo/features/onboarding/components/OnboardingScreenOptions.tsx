/*
このファイルの責務
- オンボーディングの各画面が自分に課すナビゲーションの設定を 1 箇所へまとめる。

## なぜ `_layout.tsx` を置かないのか（#1486）

オンボーディングの 4 画面を `app/[locale]/onboarding/_layout.tsx` で 1 つのスタックに
束ねると、**Welcome の「はじめる」でアプリ本体へ戻れなくなる**。

`router.dismissAll()` は `POP_TO_TOP` を投げるだけで、それを処理するのは
**いちばん近いスタックナビゲータ**である。ネストしたスタックを作ると、
「はじめる」は `[locale]` スタックの根（= タブ）ではなく、オンボーディングスタックの
根（= 3 ステップの 1 枚目）まで戻ることになる。つまり完了したはずのオンボーディングが
もう一度出てくる。

`app/[locale]/auth/`（login.tsx / callback.tsx）や `app/[locale]/legal/` と同じく
**`_layout.tsx` を置かない**でおけば、4 画面は `[locale]` スタックの兄弟として並び、
`dismissAll()` はタブまで戻る。ディレクトリを掘っても、レイアウトが無ければ
ナビゲータは増えない。

## なぜ画面ごとに `gestureEnabled: false` なのか

許可フローは «一方通行» で組んである（位置情報 → 通知 → Welcome はいずれも `replace`）。
iOS のスワイプバックが効いたままだと、OS の許可ダイアログが出ている最中に画面の端を
引っ張って前の画面へ戻れてしまい、「ダイアログには答えたのに画面は前のまま」という
状態が作れる。3 ステップ側の «戻る» は画面内のボタンが担うので、ジェスチャは不要。
*/
import React from "react";
import { Stack } from "expo-router";

/**
 * 自分の画面の options を宣言する（`app/[locale]/+not-found.tsx` と同じ書き方）。
 *
 * ルート側で `<Stack.Screen name="onboarding/..." />` を列挙する形にしないのは、
 * 画面が増えるたびに離れた `app/[locale]/_layout.tsx` を触ることになるため。
 */
export function OnboardingScreenOptions() {
	return <Stack.Screen options={{ gestureEnabled: false, animation: "fade" }} />;
}
