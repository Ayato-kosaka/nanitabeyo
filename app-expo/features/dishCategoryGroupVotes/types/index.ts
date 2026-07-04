import type {
	DishCategoryGroupVoteCandidate,
	DishCategoryGroupVoteDetailResponse,
	DishCategoryGroupVoteReaction,
} from "@shared/api/v1/res";

export type DishCategoryGroupVoteDetail = DishCategoryGroupVoteDetailResponse;
export type DishCategoryGroupVoteCandidateItem = DishCategoryGroupVoteCandidate;
export type DishCategoryGroupVoteChoice = DishCategoryGroupVoteReaction;

export type DishCategoryGroupVoteDraftVote = {
	candidateId: string;
	reaction: DishCategoryGroupVoteChoice;
};

export type DishCategoryGroupVoteCompletionState = {
	displayName: string;
	comment: string;
};
