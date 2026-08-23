import { useDishMediaEntriesStore, type DishReview, type NormalizedDishMediaEntry } from "./useDishMediaEntriesStore";

/**
 * #1513 論理削除をストアへ反映する removeDishMediaEntry / removeDishReview の回帰テスト。
 *
 * サーバー側で deleted_at を立てても、**既に読み込み済みの画面は再取得しない限り
 * その投稿を持ち続ける**。ここが壊れると「削除したのに画面に残る」「削除したら
 * 他人の投稿まで消えた」という、どちらもユーザーからは同じ『バグ』に見える形で出る。
 *
 * とくに固定したいのは「同じ料理に付いた他人のレビューを巻き添えにしない」こと。
 * entry.dishReviewIds は *料理* 単位のレビューを持つので、それを削除集合に使うと
 * 他人の本文が消える。
 */

const buildEntry = (mediaId: string, dishReviewIds: string[]): NormalizedDishMediaEntry =>
	({
		restaurant: { id: "restaurant-1", name: "テスト店" },
		dish: { id: "dish-1" },
		dish_media: { id: mediaId, isMine: true },
		dishReviewIds,
	}) as unknown as NormalizedDishMediaEntry;

const buildReview = (id: string, createdDishMediaId: string, userId: string | null): DishReview =>
	({
		id,
		created_dish_media_id: createdDishMediaId,
		user_id: userId,
		comment: `${id} のコメント`,
		rating: 4,
		lock_no: 0,
	}) as unknown as DishReview;

/**
 * 同じ料理に 2 つの投稿がぶら下がる状態を作る。
 * - media-mine   … 自分の投稿。origin レビューは review-mine
 * - media-others … 他人の投稿。origin レビューは review-others
 * どちらの entry も、料理単位のレビュー 2 件を dishReviewIds に持つ
 */
const seed = () => {
	useDishMediaEntriesStore.setState({
		entriesByMediaId: {
			"media-mine": buildEntry("media-mine", ["review-mine", "review-others"]),
			"media-others": buildEntry("media-others", ["review-mine", "review-others"]),
		},
		reviewsByReviewId: {
			"review-mine": buildReview("review-mine", "media-mine", "me"),
			"review-others": buildReview("review-others", "media-others", "someone-else"),
		},
		mediaIdsByKey: {
			feed: ["media-mine", "media-others"],
			profile: ["media-mine"],
		},
		reviewIdsByKey: {
			"profile-reviews": ["review-mine", "review-others"],
		},
	});
};

describe("#1513 removeDishMediaEntry", () => {
	beforeEach(seed);

	it("削除した投稿を全ての並びから外す", () => {
		useDishMediaEntriesStore.getState().removeDishMediaEntry("media-mine");
		const state = useDishMediaEntriesStore.getState();

		expect(state.entriesByMediaId["media-mine"]).toBeUndefined();
		expect(state.mediaIdsByKey.feed).toEqual(["media-others"]);
		expect(state.mediaIdsByKey.profile).toEqual([]);
	});

	it("その投稿と一緒に作られたレビューも巻き添えで消す", () => {
		useDishMediaEntriesStore.getState().removeDishMediaEntry("media-mine");
		const state = useDishMediaEntriesStore.getState();

		expect(state.reviewsByReviewId["review-mine"]).toBeUndefined();
		expect(state.reviewIdsByKey["profile-reviews"]).toEqual(["review-others"]);
	});

	it("同じ料理に付いた他人のレビューは残す", () => {
		useDishMediaEntriesStore.getState().removeDishMediaEntry("media-mine");
		const state = useDishMediaEntriesStore.getState();

		expect(state.reviewsByReviewId["review-others"]).toBeDefined();
		// 他人の投稿は残り、その dishReviewIds からは消えたレビューだけが外れている
		expect(state.entriesByMediaId["media-others"].dishReviewIds).toEqual(["review-others"]);
	});
});

describe("#1513 removeDishReview", () => {
	beforeEach(seed);

	it("レビューだけを消し、紐づく投稿は残す", () => {
		useDishMediaEntriesStore.getState().removeDishReview("review-mine");
		const state = useDishMediaEntriesStore.getState();

		expect(state.reviewsByReviewId["review-mine"]).toBeUndefined();
		expect(state.reviewIdsByKey["profile-reviews"]).toEqual(["review-others"]);
		// 投稿(dish_media)はサーバー側でも消えないので、ここでも残す
		expect(state.entriesByMediaId["media-mine"]).toBeDefined();
	});

	it("entry.dishReviewIds からも外す（本文欄が空行を引かないように）", () => {
		useDishMediaEntriesStore.getState().removeDishReview("review-mine");
		const state = useDishMediaEntriesStore.getState();

		expect(state.entriesByMediaId["media-mine"].dishReviewIds).toEqual(["review-others"]);
	});

	it("存在しないレビューの削除は何も壊さない", () => {
		const before = useDishMediaEntriesStore.getState();
		useDishMediaEntriesStore.getState().removeDishReview("review-unknown");
		const after = useDishMediaEntriesStore.getState();

		expect(after.reviewsByReviewId).toBe(before.reviewsByReviewId);
	});
});
