/**
 * dish_category_group_vote_candidate_votes.reaction の公開型。
 */
export type DishCategoryGroupVoteReaction = "like" | "dislike";

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
	imageUrl: string;
	dishMediaIds: string[];
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
 * 結果画面下部に表示する参加者コメント。
 */
export type DishCategoryGroupVoteComment = {
	participantId: string;
	displayName: string;
	comment: string;
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
		isHost: boolean;
		hasVoted: boolean;
		participantCount: number;
		createdAt: string;
		updatedAt: string;
	};
	candidates: DishCategoryGroupVoteCandidate[];
	comments: DishCategoryGroupVoteComment[];
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
	/** true の場合のみ、このリクエストで空配列から保存済みに更新した */
	updated: boolean;
};

/**
 * DELETE /v1/dish-category-group-votes/:sessionId/candidates/:candidateId のレスポンス型。
 */
export type DeleteDishCategoryGroupVoteCandidateResponse = {
	deleted: true;
};
