/*
#1375（オーナー判断: 案 A）**外部埋め込みから «写真の部分だけ» を切り出して全画面に敷く。**

## なぜ要るのか

Instagram の `/embed/` は、こちらが要求していない UI を必ず一緒に返してくる。
実機（Detox / Android）で撮った動画のコマを実測した内訳が次である（セル幅 320 のとき）。

    y   0 –  17   Instagram のヘッダ帯（アカウント名・「Instagram で表示」ボタン）
    y  17 – 417   写真（幅いっぱい）
    y 417 –  …    いいね／コメント／シェアのアイコン列、「いいね！169,527件」、
                  「コメントを追加…」、そして何も無い白い帯

これをセルへそのまま貼ると、**写真は縦の半分ほどしか占めず、下に白帯が出る**。
既存の dish_media（写真が全画面）と並ぶと明らかに浮く、というのがオーナー指摘である。

`/embed/captioned/` ではなく `/embed/` を使ってもこの内訳は変わらない（実測済み）。
URL のパラメータで消せるものではない。

## ⚠️ 拡大はしない（オーナー判断 2026-08-25）

一度は «写真がセル全面を覆う» ように `transform: scale` で拡大していたが、実機で

- 拡大した中身が指の動きを **ドラッグとして食う**（フィードを送りたいのに中身が動く）
- Instagram 自身の再生ボタンも一緒に拡大・移動して **押しにくい**
- 結果として **再生できない**

という状態になった。オーナー判断で **拡大をやめ、等倍で置く**。
写真はセル幅いっぱい・正方形で、上下にはアプリの地色が残る。
«既存の写真投稿と同じ全画面» にはならないが、**触って操作できること**を優先する。

## どう切り取るか

埋め込みは別オリジンなので、**中の DOM は触れない**（web の iframe は同一オリジンポリシー、
ネイティブも注入は Instagram のクラス名依存になり向こうの変更で無言で壊れる）。
そこで **外側から位置と拡大率だけで切り取る**。

    ┌ 切り取り枠（セル全面 / overflow: hidden / 中身を中央寄せ）
    │   ┌ 写真の箱（幅 = セル幅、高さ = 幅 × 写真の縦横比）… 等倍で中央に置く
    │   │   ┌ 埋め込み本体（幅 = セル幅の «素のまま»。上へ header ぶんずらす）
    │   │   │   ヘッダ帯 ← 箱の外へ出るので見えない
    │   │   │   写真     ← 箱いっぱい
    │   │   │   いいね欄 ← 箱の外へ出るので見えない

⚠️ **埋め込み本体を «セルの高さぶんの幅» まで引き伸ばしてはいけない。**
最初はそう作ったが、それだと **Android でセルが真っ黒になった**（実機 Detox /
run 32724564583・32727534712 で 2 回再現。iOS は同じ設定で描けていた）。
Android の WebView は与えられた寸法ぶんの描画面を確保するので、実寸で 2000px を
超える幅を渡すと描けなくなる。**本体は素の幅のまま置き、拡大は transform で行う。**
transform はプラットフォームのビュー変換なので新しい描画面を作らない。

## 定数の根拠と、外れたときに何が起きるか

- `EMBED_HEADER_RATIO`: ヘッダ帯の高さ ÷ 幅。実機の動画のコマから 17/320。
  外れると写真の上下が少しずれる（隙間は出ない）
- `EMBED_MEDIA_ASPECT`: 写真の «高さ ÷ 幅»。**1（正方形）を採る。**
  実測は 4:5 だったが、1.25 を前提にすると正方形の投稿で写真がセルより小さくなり
  黒帯が出る。1 なら 4:5 が来ても上下が切れるだけで済む。
  «隙間が出る» より «少し切れる» を選ぶ、という判断である
*/

/** ヘッダ帯の高さ ÷ iframe 幅（実測 17/320） */
export const EMBED_HEADER_RATIO = 17 / 320;

/**
 * 写真の «高さ ÷ 幅»。正方形を前提に置く。
 * ここを実測値 1.25 にすると正方形投稿で黒帯が出るため、あえて小さい側に倒してある。
 */
export const EMBED_MEDIA_ASPECT = 1;

/**
 * 埋め込み本体の高さ ÷ 幅。**写真の下端が入りきる最小限**にする。
 * その下（いいね欄・白帯）はどのみち箱の外へ出るので、余分に高くしても描画が重くなるだけ。
 */
export const EMBED_FRAME_HEIGHT_RATIO = EMBED_HEADER_RATIO + EMBED_MEDIA_ASPECT + 0.05;

export type EmbedCropLayout = {
	/** 埋め込み本体（iframe / WebView）に与える幅。**セル幅そのまま**（引き伸ばさない） */
	frameWidth: number;
	/** 埋め込み本体に与える高さ */
	frameHeight: number;
	/** 埋め込み本体を上へずらす量（ヘッダ帯を箱の外へ追い出す）。負値で指定する */
	frameTop: number;
	/** 写真の箱の高さ（幅は frameWidth と同じ） */
	mediaHeight: number;
};

export function computeEmbedCropLayout(cell: { width: number; height: number }): EmbedCropLayout | null {
	if (!(cell.width > 0) || !(cell.height > 0)) return null;

	// 本体は «素の幅» のまま。ここを大きくすると Android が描けなくなる（ヘッダ参照）
	const frameWidth = cell.width;
	const frameHeight = frameWidth * EMBED_FRAME_HEIGHT_RATIO;
	const mediaTop = frameWidth * EMBED_HEADER_RATIO;
	const mediaHeight = frameWidth * EMBED_MEDIA_ASPECT;

	return { frameWidth, frameHeight, frameTop: -mediaTop, mediaHeight };
}
