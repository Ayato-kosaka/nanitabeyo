import type { MarkAsEatenOrigin } from "./analytics";

/**
 * #1403 (PR2) 「保存 → 食べた」の遷移を **入口から出口まで** 1 本で計測するための受け渡し。
 *
 * ## なぜ必要か
 *
 * 入口（want 行の「食べたを記録」）は `my_dishes_mark_as_eaten_pressed` で既に取れている。
 * しかし出口（実際に記録が完了した瞬間）は `review-from-media/[dishMediaId].tsx` の
 * `handleReviewSuccess` にあり、**この画面は my-dishes 専用ではない**。
 * 同じルートへは少なくとも次の 4 経路が入ってくる。
 *
 * - my-dishes 一覧のカード（`MyDishesListView`）
 * - my-dishes の店舗 Sheet（`MyDishesRestaurantSheet`）
 * - フィードの「この料理にレビューを書く」（`ActionButtons` / `FeedDishMediaViewer`）
 * - 店舗詳細のレビューグリッド（`SelectedRestaurantDetails`）
 *
 * したがって完了時に無条件でログを出すと、**my-dishes を一度も開いていない投稿まで
 * 「保存→食べた の完了」として数えてしまう**。どこから来たかを知る必要がある。
 *
 * ## なぜ URL のパラメータにしないのか
 *
 * `buildMarkAsEatenRoute` に `from` を足せば済むように見えるが、それは
 * **計測の都合でルートの契約（= 共有ルートの params）を汚す**ことになる。
 * `review-from-media` は 4 経路の共有ルートで、`__tests__/reviewFormRoutes.test.tsx` /
 * `__tests__/restaurantDetailRoutes.test.tsx` が params の形をそのまま固定している。
 * 計測のためだけに全経路へ任意パラメータを生やす形は採らない。
 *
 * そこで「直前に my-dishes から押した」という **意図だけ**をモジュール内に一時保持し、
 * 完了時に取り出して消す（take-once）。押下と完了の間はクライアント内遷移なので保持は効く。
 *
 * ## 誤集計を防ぐ 3 つの条件
 *
 * 1. **take-once**: 一度取り出したら消える。同じ意図で 2 回完了イベントが出ない
 * 2. **dishMediaId の一致**: 別の料理の投稿が完了しても紐付かない。押したあと戻って
 *    フィードから «別の» 料理を投稿した、が「保存→食べた」に化けるのを防ぐ
 * 3. **TTL**: 押したまま放置して数時間後に別経路で投稿しても紐付かない。
 *    紐付かなければ完了イベントは «出ない»。**取りこぼす側に倒す**（水増ししない）
 *
 * web のリロードでこの意図は失われる。そのときも完了イベントは出ない。
 * 「押した数 > 完了した数」になるのは正しい方向の誤差であり、逆よりよい。
 */

/** 押下から完了までをひと続きとみなす上限。超えたら別の行動として扱う */
export const MARK_AS_EATEN_INTENT_TTL_MS = 30 * 60 * 1000;

export type MarkAsEatenIntent = {
	from: MarkAsEatenOrigin;
	itemKey: string;
	restaurantId: string;
	dishMediaId: string;
	/** `Date.now()`。完了時との差が `durationMs` になる */
	startedAt: number;
};

/**
 * 保持するのは常に «最後に押した 1 件» だけ。押し直したら上書きする。
 * 複数を保持しても、完了するのは高々 1 件であり、残りは TTL で腐るだけである。
 */
let pendingIntent: MarkAsEatenIntent | null = null;

/**
 * 「食べたを記録」を押した瞬間に呼ぶ。`my_dishes_mark_as_eaten_pressed` と同じ場所で呼ぶこと。
 */
export const beginMarkAsEaten = (intent: MarkAsEatenIntent): void => {
	pendingIntent = intent;
};

/**
 * 記録が完了した瞬間に呼ぶ。条件を満たす意図があればそれを返し、保持を消す。
 *
 * @param dishMediaId 完了した投稿の元メディア id。押したときのものと一致しなければ紐付けない
 * @param now テストから固定するための時刻。既定は `Date.now()`
 * @returns 紐付いた意図。紐付かなければ `null`（= 完了イベントを出さない）
 */
export const takeMarkAsEaten = (dishMediaId: string, now: number = Date.now()): MarkAsEatenIntent | null => {
	const intent = pendingIntent;
	if (intent === null) return null;
	// 一致しなくても «消す»。my-dishes 由来でない完了が挟まった時点でその意図は追跡不能である
	pendingIntent = null;
	if (intent.dishMediaId !== dishMediaId) return null;
	if (now - intent.startedAt > MARK_AS_EATEN_INTENT_TTL_MS) return null;
	// 端末時計が巻き戻った場合に負の durationMs を作らない
	if (now < intent.startedAt) return null;
	return intent;
};

/** テストと、明示的に追跡をやめたいときのための口 */
export const clearMarkAsEatenIntent = (): void => {
	pendingIntent = null;
};

/** 現在の保持内容（テスト専用。プロダクションコードから読まないこと） */
export const peekMarkAsEatenIntent = (): MarkAsEatenIntent | null => pendingIntent;
