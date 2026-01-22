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
