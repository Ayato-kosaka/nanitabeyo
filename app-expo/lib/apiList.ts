/*
#1561 **API が «200 だが本文の形が違う» を返したときに、画面ごと落ちるのを止める。**

## 何が起きたか

`my-dishes/select-restaurant` が、開くだけでアプリの ErrorBoundary
（「予期しないエラーが発生しました」）へ落ちた。#1509 のダークモード撮影で
3 プリセット × ライト/ダークの 6 通りすべて再現し、9 ルート中この 1 本だけが落ちた。

    const response = await callBackend<…>(…);
    setSavedRestaurants(response.data);      // undefined が state へ入る
    …
    {savedRestaurants.map(…)}                // 次のレンダーで throw

    TypeError: Cannot read properties of undefined (reading 'map')

## なぜ try/catch では防げないのか

`setState` は `try` の中にあるが、**throw するのは次のレンダー**であり、
そこは `try` の外である。`catch` が拾えるのは通信エラーだけで、
「200 が返ったが `data` が無い」は素通りして state を汚し、描画時に爆発する。

型（`…Response`）は `data: T[]` と宣言しているので **TypeScript では検出できない**。
型は「サーバがそう返すはず」という約束でしかなく、実際に返ってくるものの保証ではない。

## 方針

`response.data` を **state へ入れる／反復する直前に**この関数を通す。
`?? []` をその場に書いても同じだが、関数にしてあるのは

- `grep asApiList` で «外から来た配列を信じている場所» を一覧できるようにするため
- 「なぜ防御が要るのか」の説明を 1 か所に置くため

配列でない値（null / undefined / オブジェクト / 文字列）はすべて空配列へ落とす。
`Array.isArray` で見るので、`data: {}` のような «形は返ってきたが配列ではない»
応答も安全に握り潰せる。**握り潰した事実は呼び出し側でログに残す必要はない**
（通信エラーは既存の catch がログしており、ここは «空で描く» が正しい縮退であるため）。
*/

/** 外から来た値を、必ず «その型の配列» にして返す。配列でなければ空配列 */
export function asApiList<T>(value: T[] | null | undefined): T[] {
	return Array.isArray(value) ? value : [];
}
