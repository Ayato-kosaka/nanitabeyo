/**
 * dish_category_group_vote_candidate_votes.reaction の公開型。
 */
export type DishCategoryGroupVoteReaction = "like" | "dislike";

/**
 * 店舗提案用 dish_media 検索状態。
 *
 * Prisma は PostgreSQL scalar list の NULL を型表現できないため、
 * dishMediaIds の null ではなく明示的な status で未検索/0件/候補ありを区別する。
 */
export type DishCategoryGroupVoteDishMediaSearchStatus = "not_searched" | "found" | "empty";

/**
 * 店舗提案用 dish_media 検索条件のスナップショット。
 *
 * 共有リンクを直接開いたゲストでも「店を見る」を実行できるよう、
 * session detail で返す。
 */
export type DishCategoryGroupVoteSearchContext = {
	location: {
		latitude: number;
		longitude: number;
	};
	radius: number;
	priceLevels: string[];
	localLanguageCode: string;
};

/**
 * POST /v1/dish-category-group-votes のレスポンス型。
 */
export type CreateDishCategoryGroupVoteResponse = {
	/** 内部操作・Realtime購読に使う session id */
	id: string;
	/** 共有URLに載せる公開トークン */
	shareToken: string;
};

/**
 * 結果画面で表示する候補ごとの投票者反応。
 */
export type DishCategoryGroupVoteCandidateVoter = {
	participantId: string;
	displayName: string;
	reaction: DishCategoryGroupVoteReaction;
};

/**
 * GET /v1/dish-category-group-votes/:shareToken の候補レスポンス。
 *
 * 削除済み候補も返す。フロントは deletedAt !== null の候補を非表示にする。
 */
export type DishCategoryGroupVoteCandidate = {
	id: string;
	dishCategoryId: string;
	displayName: string;
	tagline: string;
	imageUrl: string;
	dishMediaIds: string[];
	dishMediaSearchStatus: DishCategoryGroupVoteDishMediaSearchStatus;
	displayOrder: number;
	deletedAt: string | null;
	likeCount: number;
	dislikeCount: number;
	/**
	 * likeCount の順位。同率は同じ順位。
	 * 投票が一件もない場合の扱いは API 実装時に最終調整する。
	 */
	rank: number | null;
	votes: DishCategoryGroupVoteCandidateVoter[];
};

/**
 * GET detail で返す参加者。
 *
 * コメント一覧も参加者から派生させ、参加者名列挙とコメント表示の真実を一本化する。
 */
export type DishCategoryGroupVoteParticipant = {
	id: string;
	displayName: string;
	comment: string | null;
	createdAt: string;
};

/**
 * GET /v1/dish-category-group-votes/:shareToken のレスポンス型。
 */
export type DishCategoryGroupVoteDetailResponse = {
	session: {
		id: string;
		shareToken: string;
		hostUserId: string;
		searchContext: DishCategoryGroupVoteSearchContext;
		isHost: boolean;
		hasVoted: boolean;
		participantCount: number;
		createdAt: string;
		updatedAt: string;
	};
	candidates: DishCategoryGroupVoteCandidate[];
	participants: DishCategoryGroupVoteParticipant[];
};

/**
 * POST /v1/dish-category-group-votes/:sessionId/vote のレスポンス型。
 */
export type SubmitDishCategoryGroupVoteResponse = {
	participantId: string;
	stored: true;
};

/**
 * PATCH /v1/dish-category-group-votes/:sessionId/candidates/:candidateId/dish-media
 * のレスポンス型。
 */
export type UpdateDishCategoryGroupVoteCandidateDishMediaResponse = {
	candidateId: string;
	dishMediaIds: string[];
	dishMediaSearchStatus: DishCategoryGroupVoteDishMediaSearchStatus;
	/** true の場合のみ、このリクエストで未検索から検索済みに更新した */
	updated: boolean;
};

/**
 * DELETE /v1/dish-category-group-votes/:sessionId/candidates/:candidateId のレスポンス型。
 */
export type DeleteDishCategoryGroupVoteCandidateResponse = {
	deleted: true;
};
