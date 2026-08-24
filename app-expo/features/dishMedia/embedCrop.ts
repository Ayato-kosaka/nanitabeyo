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

## どう切り取るか

埋め込みは別オリジンなので、**中の DOM は触れない**（web の iframe は同一オリジンポリシー、
ネイティブも注入は Instagram のクラス名依存になり向こうの変更で無言で壊れる）。
そこで **外側から位置とサイズだけで切り取る**。

写真の寸法は «iframe の幅» だけで決まる（高さを増やしても写真は大きくならない）。
つまり iframe を**セルの高さと同じ幅**で描けば、写真はセルを覆う大きさになる。
あとは写真の中心をセルの中心へ合わせ、はみ出しを `overflow: hidden` で捨てればよい。
これは既存の写真の `contentFit: "cover"` と同じ振る舞いで、隙間（黒帯）は絶対に出ない。

## 定数の根拠と、外れたときに何が起きるか

- `EMBED_HEADER_RATIO`: ヘッダ帯の高さ ÷ iframe 幅。上の実測 17/320 から。
  外れると写真の中心が上下に少しずれる（隙間は出ない）
- `EMBED_MEDIA_ASPECT`: 写真の «高さ ÷ 幅»。**1（正方形）を採る。**
  実測値は 400/320 = 1.25（4:5）だったが、1.25 を前提にすると、Instagram が
  正方形で返した投稿で **写真がセルより小さくなり黒帯が出る**。
  1 を前提にしておけば、4:5 が来たときは上下が切り取られるだけで済む。
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
 * 埋め込み全体の高さ ÷ 幅。**写真の下端が入りきる最小限**にする。
 *
 * ⚠️ 大きくしすぎてはいけない。初版は 2 にしていたが、それだと Android で
 * **セルが真っ黒になった**（実機 Detox / run 32724564583。iOS は同じ設定でも描けていた）。
 * 幅はセルの高さぶん（端末実寸で約 2000px）あるので、高さを 2 倍にすると
 * 描画面が 4000px を超え、Android の WebView が扱えるテクスチャの上限を越える。
 *
 * 必要なのは «ヘッダ + 写真» が収まる高さだけで、その下（いいね欄・白帯）は
 * どのみち切り取って捨てる。ヘッダ 0.053 + 写真 1.0 に少しの余裕を足した値にする。
 */
export const EMBED_FRAME_HEIGHT_RATIO = EMBED_HEADER_RATIO + EMBED_MEDIA_ASPECT + 0.05;

/**
 * 写真をセルより何割大きく敷くか。
 *
 * ぴったり（1.0）にすると、写真の上下端とセルの上下端が **数値上ちょうど一致**する。
 * 端末の丸め（小数のレイアウト）が 1px でも逆に転ぶと、そこに黒い線が出る。
 * 2% だけ大きく敷いて、必ず «少しはみ出している» 状態にしておく。
 */
export const EMBED_OVERSCAN = 1.02;

export type EmbedCropLayout = {
	/** 埋め込み（iframe / WebView）に与える幅 */
	frameWidth: number;
	/** 埋め込みに与える高さ */
	frameHeight: number;
	/** 切り取り枠の中での埋め込みの位置（負値になる。= 左と上を切り落とす） */
	left: number;
	top: number;
};

/**
 * セルの寸法から、埋め込みをどう置けば «写真だけが全面に出るか» を返す。
 *
 * 呼び出し側は、返り値の `frameWidth` / `frameHeight` を埋め込みに与え、
 * `left` / `top` で位置をずらし、**親を `overflow: "hidden"` にする**こと。
 * 親が切り取らないと、はみ出した Instagram の UI がセルの外へ出て他の要素に重なる。
 *
 * セルの寸法がまだ確定していない（0 以下）ときは null を返す。呼び出し側は
 * `onLayout` で寸法が来るまで埋め込みを描かない。中途半端な寸法で一度描くと、
 * WebView がその寸法でページを読み込んでしまい、切り取り位置がずれたまま残る。
 */
export function computeEmbedCropLayout(cell: { width: number; height: number }): EmbedCropLayout | null {
	if (!(cell.width > 0) || !(cell.height > 0)) return null;

	// 写真がセルの高さを覆う幅。写真の高さ = 幅 × EMBED_MEDIA_ASPECT なので逆算する。
	// ⚠️ 横長のセル（タブレット等）では、高さから決めた幅がセル幅に届かず
	// **左右に隙間が出る**。幅側の要求とを比べて大きいほうを採る（= cover）
	const frameWidth = Math.max((cell.height * EMBED_OVERSCAN) / EMBED_MEDIA_ASPECT, cell.width * EMBED_OVERSCAN);
	const frameHeight = frameWidth * EMBED_FRAME_HEIGHT_RATIO;

	const mediaTop = frameWidth * EMBED_HEADER_RATIO;
	const mediaHeight = frameWidth * EMBED_MEDIA_ASPECT;

	return {
		frameWidth,
		frameHeight,
		// 写真の中心をセルの中心へ合わせる
		left: (cell.width - frameWidth) / 2,
		top: cell.height / 2 - (mediaTop + mediaHeight / 2),
	};
}
