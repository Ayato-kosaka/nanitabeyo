/*
このファイルの責務
- **ルート Stack 側の** お店選択画面。中身は `(tabs)/my-dishes/select-restaurant.tsx` そのもの。

## なぜ同じ画面をもう 1 ルートで公開するのか（#1375 3 巡目）

sns-import は `presentation: "modal"`（ルート Stack）で出る。そこから
`/(tabs)/my-dishes/select-restaurant` へ push すると **タブナビゲータ側**に画面が積まれ、
モーダルの背面で遷移が起きる。実機ではこれが「お店選択が閉じられない・戻るを押すと
検索画面へ行く」という壊れ方に見えていた。

ルート Stack にも同じ画面を置けば、モーダルの **上** に普通に push され、
`router.back()` でモーダル（統合フォーム）へ素直に帰れる。

呼び出し側は必ず `?mode=pick` を付けること（この経路は選択して戻る用途しかない）。
*/
export { default } from "./(tabs)/my-dishes/select-restaurant";
