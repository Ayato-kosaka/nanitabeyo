/**
 * POST /v1/contribution-tasks のレスポンス型
 *
 * 協力タスクの作成結果を返す
 */
export type CreateContributionTaskResponse = {
	/** 作成された協力タスクのID */
	id: string;
	/** 作成日時 */
	createdAt: string;
};

/**
 * 協力タスクの基本情報（一覧用）
 */
export type ContributionTaskItem = {
	/** 協力タスクID */
	id: string;
	/** 協力の種類 */
	type: string;
	/** 企画を識別するキー */
	taskKey: string;
	/** 協力対象の種別 */
	targetType: string;
	/** 協力対象のID */
	targetId: string;
	/** 作成日時 */
	createdAt: string;
	/** ユーザーに提示した情報（include=payload 指定時のみ） */
	payload?: Record<string, unknown>;
	/** ユーザーの回答・選択結果（include=result 指定時のみ） */
	result?: Record<string, unknown>;
};

/**
 * GET /v1/contribution-tasks のレスポンス型
 *
 * 自分の協力タスク履歴一覧を返す
 */
export type ListContributionTasksResponse = {
	/** 協力タスクの配列 */
	items: ContributionTaskItem[];
	/** 次ページのカーソル（ない場合はnull） */
	nextCursor: string | null;
};

/**
 * GET /v1/contribution-tasks/:id のレスポンス型
 *
 * 協力タスクの詳細情報を返す
 */
export type GetContributionTaskByIdResponse = {
	/** 協力タスクID */
	id: string;
	/** 協力の種類 */
	type: string;
	/** 企画を識別するキー */
	taskKey: string;
	/** 協力対象の種別 */
	targetType: string;
	/** 協力対象のID */
	targetId: string;
	/** ユーザーに提示した情報 */
	payload: Record<string, unknown>;
	/** ユーザーの回答・選択結果 */
	result: Record<string, unknown>;
	/** 作成日時 */
	createdAt: string;
};

/**
 * GET /v1/contribution-tasks/exists のレスポンス型
 *
 * 既に完了済みかどうかを返す
 */
export type ExistsContributionTaskResponse = {
	/** 存在するかどうか */
	exists: boolean;
	/** 存在する場合のID */
	id?: string;
	/** 存在する場合の作成日時 */
	createdAt?: string;
};

/**
 * 完了済みtargetIdの集計情報
 */
export type CompletedTargetIdItem = {
	/** 対象ID */
	targetId: string;
	/** 完了回数 */
	count: number;
	/** 最後に完了された日時 */
	lastCompletedAt: string;
};

/**
 * GET /v1/contribution-tasks/completed-target-ids のレスポンス型
 *
 * グローバル完了済みtargetIdの一覧を返す（個人特定情報は含まない）
 */
export type CompletedTargetIdsResponse = {
	/** タスクキー */
	taskKey: string;
	/** 対象タイプ */
	targetType: string;
	/** タイプ（フィルタ指定時のみ） */
	type?: string;
	/** 最小完了回数 */
	minCount: number;
	/** 完了済みtargetIdの配列 */
	completed: CompletedTargetIdItem[];
	/** 次ページのカーソル（ない場合はnull） */
	nextCursor: string | null;
};

