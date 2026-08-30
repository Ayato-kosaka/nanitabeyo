/*
#1403 (PR2) 「保存 → 食べた」の入口と出口を結ぶ受け渡しを固定する。

出口（`review-from-media` の `handleReviewSuccess`）は **my-dishes 専用ではない**。
フィードの「この料理にレビューを書く」や店舗詳細のレビューグリッドも同じルートへ入ってくるので、
無条件に完了イベントを出すと «my-dishes を開いてすらいない投稿» まで
「保存→食べた の完了」に数えてしまう。

そこで誤集計を防ぐ 3 条件（take-once / dishMediaId 一致 / TTL）をここで固定する。
どれも「紐付かなければ出さない」＝ **取りこぼす側に倒す**方向であり、水増しはしない。
*/
import {
	MARK_AS_EATEN_INTENT_TTL_MS,
	beginMarkAsEaten,
	clearMarkAsEatenIntent,
	peekMarkAsEatenIntent,
	takeMarkAsEaten,
} from "./markAsEatenFunnel";

const START = 1_700_000_000_000;

const intent = (overrides: Partial<Parameters<typeof beginMarkAsEaten>[0]> = {}) => ({
	from: "list" as const,
	itemKey: "item-1",
	restaurantId: "rest-1",
	dishMediaId: "media-1",
	startedAt: START,
	...overrides,
});

beforeEach(() => clearMarkAsEatenIntent());

describe("#1403 保存→食べた の入口と出口を結ぶ", () => {
	it("押してから同じ料理で完了すると、押下時の情報がそのまま返る", () => {
		beginMarkAsEaten(intent());
		expect(takeMarkAsEaten("media-1", START + 42_000)).toEqual(intent());
	});

	it("押していなければ何も返らない（= 完了イベントを出さない）", () => {
		expect(takeMarkAsEaten("media-1", START)).toBeNull();
	});

	// これが無いと、リロードや別経路の投稿を挟んだあとに «直前の 1 件» が何度も再利用される
	it("take-once。2 回目は返らない（完了イベントが二重に出ない）", () => {
		beginMarkAsEaten(intent());
		expect(takeMarkAsEaten("media-1", START + 1_000)).not.toBeNull();
		expect(takeMarkAsEaten("media-1", START + 2_000)).toBeNull();
	});

	// 「食べたを記録」を押して戻り、フィードから «別の» 料理を投稿した、が
	// 「保存→食べた」に化けるのを防ぐ
	it("別の dishMediaId の完了には紐付かない", () => {
		beginMarkAsEaten(intent());
		expect(takeMarkAsEaten("media-999", START + 1_000)).toBeNull();
	});

	it("紐付かなかった意図はその場で捨てる（あとから別の完了に付け替わらない）", () => {
		beginMarkAsEaten(intent());
		takeMarkAsEaten("media-999", START + 1_000);
		expect(peekMarkAsEatenIntent()).toBeNull();
		expect(takeMarkAsEaten("media-1", START + 2_000)).toBeNull();
	});

	it("TTL を超えたら紐付かない（押したまま放置して数時間後の投稿を数えない）", () => {
		beginMarkAsEaten(intent());
		expect(takeMarkAsEaten("media-1", START + MARK_AS_EATEN_INTENT_TTL_MS)).not.toBeNull();

		beginMarkAsEaten(intent());
		expect(takeMarkAsEaten("media-1", START + MARK_AS_EATEN_INTENT_TTL_MS + 1)).toBeNull();
	});

	it("端末時計が巻き戻っても負の durationMs を作らない", () => {
		beginMarkAsEaten(intent());
		expect(takeMarkAsEaten("media-1", START - 1)).toBeNull();
	});

	it("押し直したら最後の 1 件で上書きする", () => {
		beginMarkAsEaten(intent());
		beginMarkAsEaten(intent({ from: "sheet", itemKey: "item-2", dishMediaId: "media-2" }));
		expect(takeMarkAsEaten("media-1", START + 1_000)).toBeNull();

		beginMarkAsEaten(intent({ from: "sheet", itemKey: "item-2", dishMediaId: "media-2" }));
		expect(takeMarkAsEaten("media-2", START + 1_000)?.from).toBe("sheet");
	});
});
