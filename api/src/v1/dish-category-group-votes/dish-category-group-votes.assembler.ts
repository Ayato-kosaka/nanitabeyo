// api/src/v1/dish-category-group-votes/dish-category-group-votes.assembler.ts
//
// #856 【設計】DB 取得形状を結果画面用 Response に変換する。
// Repository は raw に近い converter 型を返し、この層で response だけを組み立てる。
// こうしておくと、集計ロジックが DB に漏れず、画面契約の変更点もここに集約できる。

import { Injectable } from '@nestjs/common';
import {
  DishCategoryGroupVoteDetailResponse,
  DishCategoryGroupVoteSearchContext,
} from '@shared/v1/res';
import { DishCategoryGroupVoteDetailRecord } from './dish-category-group-votes.repository';
import {
  compareByVoteRank,
  hasSameVoteScore,
  RankableCandidate,
} from './dish-category-group-votes.ranking';

@Injectable()
export class DishCategoryGroupVotesAssembler {
  toDetailResponse(
    entity: DishCategoryGroupVoteDetailRecord,
    viewerUserId: string,
  ): DishCategoryGroupVoteDetailResponse {
    // votes は participant_id しか持たないので、表示名は participants と結合して作る。
    // この join を repository に寄せると、表示契約と永続化契約が混ざるため、ここで閉じる。
    const participantById = new Map(
      entity.participants.map((participant) => [participant.id, participant]),
    );

    // hasVoted は viewer の user_id を participants と突き合わせて決める。
    // localStorage ではなく DB を真実にするので、参加済み判定が複数端末でも揃う。
    const hasVoted = entity.participants.some(
      (participant) => participant.user_id === viewerUserId,
    );

    const voteItemsByCandidateId = new Map<
      string,
      DishCategoryGroupVoteDetailResponse['candidates'][number]['votes']
    >();

    for (const vote of entity.votes) {
      const participant = participantById.get(vote.participant_id);
      // 履歴不整合で orphan vote が混ざっても、結果画面全体を落とさず読めるものだけ返す。
      if (!participant) continue;

      const items = voteItemsByCandidateId.get(vote.candidate_id) ?? [];
      items.push({
        participantId: participant.id,
        displayName: participant.display_name,
        reaction: vote.reaction as 'like' | 'dislike',
      });
      voteItemsByCandidateId.set(vote.candidate_id, items);
    }

    // 集計ビューは持たない方針なので、候補数が小さい前提で GET detail ごとに集計する。
    const countsByCandidateId = new Map<
      string,
      { likeCount: number; dislikeCount: number }
    >();

    for (const candidate of entity.candidates) {
      const votes = voteItemsByCandidateId.get(candidate.id) ?? [];
      countsByCandidateId.set(candidate.id, {
        likeCount: votes.filter((vote) => vote.reaction === 'like').length,
        dislikeCount: votes.filter((vote) => vote.reaction === 'dislike')
          .length,
      });
    }

    // rank は通常 UI と同じ未削除候補だけで採番する。削除済みを含めると表示上の順位が飛ぶ。
    // 配列順は API 互換のため作成順に残し、順位表示の責務は rank に寄せる。
    const rankByCandidateId = this.buildRanks(
      entity.candidates
        .filter((candidate) => candidate.deleted_at === null)
        .map((candidate) => {
          const counts = countsByCandidateId.get(candidate.id) ?? {
            likeCount: 0,
            dislikeCount: 0,
          };
          return {
            candidateId: candidate.id,
            likeCount: counts.likeCount,
            dislikeCount: counts.dislikeCount,
            displayOrder: candidate.display_order,
          };
        }),
    );

    return {
      session: {
        id: entity.session.id,
        shareToken: entity.session.share_token,
        hostUserId: entity.session.host_user_id,
        // searchContext は session 単位の固定情報。
        // 共有リンクを直接開いた参加者が後から店舗提案へ進めるよう、detail に必ず返す。
        searchContext: entity.session
          .search_context as DishCategoryGroupVoteSearchContext,
        isHost: entity.session.host_user_id === viewerUserId,
        hasVoted,
        participantCount: entity.participants.length,
        createdAt: entity.session.created_at.toISOString(),
        updatedAt: entity.session.updated_at.toISOString(),
      },
      candidates: [...entity.candidates]
        // レスポンス配列は既存クライアント向けに作成順を維持し、ランキング順は rank の契約に閉じる。
        .sort((a, b) => a.display_order - b.display_order)
        .map((candidate) => {
          const counts = countsByCandidateId.get(candidate.id) ?? {
            likeCount: 0,
            dislikeCount: 0,
          };
          return {
            id: candidate.id,
            dishCategoryId: candidate.dish_category_id,
            displayName: candidate.display_name,
            tagline: candidate.tagline,
            imageUrl: candidate.image_url,
            // dish_media_ids は初回「店を見る」で固定される。
            // NULL ではなく status を持つ前提なので、ここでは両方を返しておく。
            dishMediaIds: candidate.dish_media_ids,
            dishMediaSearchStatus:
              candidate.dish_media_search_status as DishCategoryGroupVoteDetailResponse['candidates'][number]['dishMediaSearchStatus'],
            displayOrder: candidate.display_order,
            deletedAt: candidate.deleted_at?.toISOString() ?? null,
            likeCount: counts.likeCount,
            dislikeCount: counts.dislikeCount,
            rank: rankByCandidateId.get(candidate.id) ?? null,
            votes: voteItemsByCandidateId.get(candidate.id) ?? [],
          };
        }),
      // コメント表示も参加者情報から派生させるため、参加者を detail の正規データにする。
      participants: entity.participants.map((participant) => ({
        id: participant.id,
        displayName: participant.display_name,
        comment: participant.comment,
        createdAt: participant.created_at.toISOString(),
      })),
    };
  }

  /**
   * rank は likeCount DESC、dislikeCount ASC の競技順位で決める。
   * displayOrder は同順位内の表示順安定化だけに使い、同率判定には含めない。
   *
   * #1505 順位規則そのものは `dish-category-group-votes.ranking.ts` に置いた。
   * 一覧の winnerName（repository.findMeSessions）が同じ規則を使うため、
   * 「結果画面の 1 位」と「一覧に太字で出る候補」が食い違わない。
   */
  private buildRanks(items: RankableCandidate[]): Map<string, number> {
    const sortedItems = [...items].sort(compareByVoteRank);

    let previousItem: RankableCandidate | null = null;
    let currentRank = 0;

    return new Map(
      sortedItems.map((item, index): [string, number] => {
        if (previousItem === null || !hasSameVoteScore(previousItem, item)) {
          currentRank = index + 1;
          previousItem = item;
        }

        return [item.candidateId, currentRank];
      }),
    );
  }
}
