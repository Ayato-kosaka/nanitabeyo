// api/src/v1/dish-category-group-votes/dish-category-group-votes.assembler.ts
//
// #856 【設計】DB Entity を結果画面用 Response に変換する。
//
// この Assembler は DB 取得形状と画面契約の境界を守る。
// API は集計ビューを持たない方針なので、like/dislike 数、順位、参加者表示名の結合は
// ここで都度組み立てる。候補は削除済みも返し、非表示判断は deletedAt を使って
// フロントが行う。

import { Injectable } from '@nestjs/common';
import { DishCategoryGroupVoteDetailResponse } from '@shared/v1/res';
import { DishCategoryGroupVoteDetailEntity } from './dish-category-group-votes.repository';

@Injectable()
export class DishCategoryGroupVotesAssembler {
  toDetailResponse(
    entity: DishCategoryGroupVoteDetailEntity,
    viewerUserId: string,
  ): DishCategoryGroupVoteDetailResponse {
    // votes は participantId だけを持つため、画面表示に必要な displayName は
    // participants と結合して作る。Repository では集計用 join を固定せず、
    // レスポンス契約の都合をこの層に閉じる。
    const participantById = new Map(
      entity.participants.map((participant) => [participant.id, participant]),
    );
    // hasVoted は「この端末の匿名/ログイン user_id が既に参加済みか」の判定。
    // localStorage と併用するが、API側の真実は participants の unique(session_id,user_id)。
    const hasVoted = entity.participants.some(
      (participant) => participant.userId === viewerUserId,
    );

    const voteItemsByCandidateId = new Map<
      string,
      DishCategoryGroupVoteDetailResponse['candidates'][number]['votes']
    >();

    for (const vote of entity.votes) {
      const participant = participantById.get(vote.participantId);
      // 壊れた履歴や将来の移行不整合で orphan vote が混ざっても、
      // 結果画面全体を落とさず、表示可能な投票だけで集計する。
      if (!participant) continue;

      const items = voteItemsByCandidateId.get(vote.candidateId) ?? [];
      items.push({
        participantId: participant.id,
        displayName: participant.displayName,
        reaction: vote.reaction,
      });
      voteItemsByCandidateId.set(vote.candidateId, items);
    }

    // 集計ビューは作らない方針なので、候補最大数が小さい前提で
    // GET detail ごとにメモリ上で集計する。
    const countsByCandidateId = new Map<
      string,
      { likeCount: number; dislikeCount: number }
    >();

    for (const candidate of entity.candidates) {
      const votes = voteItemsByCandidateId.get(candidate.id) ?? [];
      countsByCandidateId.set(candidate.id, {
        likeCount: votes.filter((vote) => vote.reaction === 'like').length,
        dislikeCount: votes.filter((vote) => vote.reaction === 'dislike').length,
      });
    }

    // 結果画面は候補順を固定し、順位バッジだけを動かす。
    // そのため rank は map として別に算出し、候補配列の並び替えには使わない。
    const rankByCandidateId = this.buildRanks(entity.candidates.map((candidate) => {
      const counts = countsByCandidateId.get(candidate.id) ?? {
        likeCount: 0,
        dislikeCount: 0,
      };
      return {
        candidateId: candidate.id,
        likeCount: counts.likeCount,
      };
    }));

    return {
      session: {
        id: entity.session.id,
        shareToken: entity.session.shareToken,
        hostUserId: entity.session.hostUserId,
        // searchContext は session 単位の店舗提案条件。
        // 共有リンクから入った参加者は検索画面の route params を持たないため、
        // detail レスポンスでこの値を受け取り、候補の dishCategoryId と組み合わせて検索する。
        searchContext: entity.session.searchContext,
        isHost: entity.session.hostUserId === viewerUserId,
        hasVoted,
        participantCount: entity.participants.length,
        createdAt: entity.session.createdAt.toISOString(),
        updatedAt: entity.session.updatedAt.toISOString(),
      },
      candidates: [...entity.candidates]
        // ホストが作成した候補順を保存し続けることが仕様。
        // ランキング順に並び替えると「迷わず決める」画面の比較軸が変わる。
        .sort((a, b) => a.displayOrder - b.displayOrder)
        .map((candidate) => {
          const counts = countsByCandidateId.get(candidate.id) ?? {
            likeCount: 0,
            dislikeCount: 0,
          };
          return {
            id: candidate.id,
            dishCategoryId: candidate.dishCategoryId,
            displayName: candidate.displayName,
            imageUrl: candidate.imageUrl,
            // 店舗提案キャッシュは初回「店を見る」後に固定される。
            // null は未検索、[] は検索済み0件として返し、フロントがUI表示を分ける。
            dishMediaIds: candidate.dishMediaIds,
            displayOrder: candidate.displayOrder,
            // 削除済み候補も返す。既存 votes の説明可能性を残しつつ、
            // 表示・店舗提案対象から外す判断はフロントの deletedAt チェックに寄せる。
            deletedAt: candidate.deletedAt?.toISOString() ?? null,
            likeCount: counts.likeCount,
            dislikeCount: counts.dislikeCount,
            rank: rankByCandidateId.get(candidate.id) ?? null,
            votes: voteItemsByCandidateId.get(candidate.id) ?? [],
          };
        }),
      // コメントは料理ごとではなく参加者ごとに1件という仕様。
      // 空コメントは結果画面のコメント一覧からは除外する。
      comments: entity.participants
        .filter((participant) => !!participant.comment)
        .map((participant) => ({
          participantId: participant.id,
          displayName: participant.displayName,
          comment: participant.comment!,
          createdAt: participant.createdAt.toISOString(),
        })),
    };
  }

  /**
   * 同率は同じ順位にする。
   * 表示順は並び替えないため、rank だけを候補に付与する。
   * vote がまだない状態でも候補間の順位計算を壊さないよう、
   * likeCount の値だけで順位表を作る。
   */
  private buildRanks(
    items: { candidateId: string; likeCount: number }[],
  ): Map<string, number> {
    const sortedScores = [...new Set(items.map((item) => item.likeCount))]
      .sort((a, b) => b - a);
    const rankByScore = new Map(
      sortedScores.map((score, index) => [score, index + 1]),
    );

    return new Map(
      items.map((item) => [
        item.candidateId,
        rankByScore.get(item.likeCount) ?? 1,
      ]),
    );
  }
}
