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
	 * likeCount DESC、dislikeCount ASC の競技順位。
	 * 同順位内の表示順安定化は displayOrder で行い、削除済み候補は null。
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

/**
 * #943 PATCH /v1/dish-category-group-votes/:sessionId/candidates/:candidateId/restore のレスポンス型。
 */
export type RestoreDishCategoryGroupVoteCandidateResponse = {
	restored: true;
};

/**
 * 一覧の行に出す候補のプレビュー。
 *
 * #1505 【設計】サムネイル列と、勝者未確定時の要約文(「ラーメン・寿司ほか2件」)は
 * **同じ候補の同じ並び**を指す。image_url と display_name を別々の配列で返すと
 * 「i 番目同士が対応する」という暗黙の契約が生まれ、片方だけ欠けたときに崩れるので、
 * 1 件を 1 オブジェクトにまとめて返す。
 */
export type MeDishCategoryGroupVoteCandidatePreview = {
	displayName: string;
	imageUrl: string;
};

/**
 * GET /v1/users/me/dish-category-group-votes の1件分。
 *
 * #1505 【仕様】返すのは **自分が主催(作成)したセッションだけ**。
 * 参加(投票)しただけのセッションは含まない(オーナー指示)。
 * 全行が主催なので isHost は持たない。hasVoted は「主催者自身が投票済みか」を表す。
 *
 * #1505 【設計】行に «何を投票したのか» を出すため、料理そのもの(サムネイル・候補名)と
 * 規模(参加人数)を一覧の時点で返す。詳細 API を行ごとに叩かせない
 * (= 一覧を開くだけで N+1 リクエストが飛ぶ形にしない)ためのフィールドである。
 */
export type MeDishCategoryGroupVoteListItem = {
	id: string;
	shareToken: string;
	hasVoted: boolean;
	/** 未削除(deleted_at IS NULL)の候補数 */
	candidateCount: number;
	/**
	 * display_order 昇順の先頭 3 件(未削除のみ)。候補が 3 件未満ならその数だけ返る。
	 * 4 件目以降は candidateCount との差で「+N」として表現する。
	 */
	candidatePreviews: MeDishCategoryGroupVoteCandidatePreview[];
	/** 投票した参加者の数 */
	participantCount: number;
	/**
	 * 首位が確定していれば、その候補の display_name。未確定なら null。
	 *
	 * 【仕様】「確定」の条件は次の両方を満たすこと。順位の付け方(likeCount DESC,
	 * dislikeCount ASC)は結果画面の rank と同じ規則を共有している。
	 * - 首位候補の likeCount が 1 以上(誰も投票していない投票に勝者は無い)
	 * - 同率首位が居ない(likeCount と dislikeCount が完全に一致する候補が 2 件以上無い)
	 */
	winnerName: string | null;
	createdAt: string;
	updatedAt: string;
};
