// api/src/v1/dish-category-group-votes/dish-category-group-votes.repository.ts
//
// #856 【設計】dish_category グループ投票の永続化境界。
// この機能は DB スキーマと画面契約の両方に依存するため、Repository では
// 変換済みの shared converter 型を使い、ローカル Entity を増やさない。
// こうしておくと、Prisma schema / Supabase schema / API response の3者が
// ずれていないかを型で追いやすい。

import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '../../../../shared/prisma/client';
import { PrismaDishCategoryGroupVoteCandidateVotes } from '../../../../shared/converters/convert_dish_category_group_vote_candidate_votes';
import { PrismaDishCategoryGroupVoteCandidates } from '../../../../shared/converters/convert_dish_category_group_vote_candidates';
import { PrismaDishCategoryGroupVoteParticipants } from '../../../../shared/converters/convert_dish_category_group_vote_participants';
import { PrismaDishCategoryGroupVoteSessions } from '../../../../shared/converters/convert_dish_category_group_vote_sessions';
import {
  CreateDishCategoryGroupVoteDto,
  SubmitDishCategoryGroupVoteDto,
} from '@shared/v1/dto';
import {
  DishCategoryGroupVoteDishMediaSearchStatus,
  DishCategoryGroupVoteSearchContext,
} from '@shared/v1/res';

export type PrismaExecutor = Prisma.TransactionClient | PrismaClient;

export type DishCategoryGroupVoteDetailRecord = {
  session: PrismaDishCategoryGroupVoteSessions;
  candidates: PrismaDishCategoryGroupVoteCandidates[];
  participants: PrismaDishCategoryGroupVoteParticipants[];
  votes: PrismaDishCategoryGroupVoteCandidateVotes[];
};

@Injectable()
export class DishCategoryGroupVotesRepository {
  /**
   * session と candidates を同一トランザクションで作る。
   * 共有リンクは session だけ先に存在しても意味がなく、候補だけ先に見えても意味がない。
   * そのため、公開識別子の発行と候補スナップショットの固定を同じ commit に閉じる。
   */
  async createSessionWithCandidates(
    db: PrismaExecutor,
    dto: CreateDishCategoryGroupVoteDto,
    hostUserId: string,
  ): Promise<{ id: string; shareToken: string }> {
    const shareToken = randomUUID().replace(/-/g, '');

    const session = await db.dish_category_group_vote_sessions.create({
      data: {
        host_user_id: hostUserId,
        share_token: shareToken,
        // 共有リンク参加者は検索画面の route params を持たないので、
        // 店を見る時点の検索条件を session に固定しておく。
        search_context: dto.searchContext as unknown as Prisma.InputJsonValue,
      },
      select: {
        id: true,
        share_token: true,
      },
    });

    // 候補は配列順で display_order を振る。body 由来の序列を信用しない。
    // 同一 session 内での候補の見え方を安定させるため、表示名/画像もここで固定する。
    await db.dish_category_group_vote_candidates.createMany({
      data: dto.candidates.map((candidate, index) => ({
        session_id: session.id,
        dish_category_id: candidate.dishCategoryId,
        display_name: candidate.displayName,
        tagline: candidate.tagline,
        image_url: candidate.imageUrl,
        dish_media_ids: [],
        dish_media_search_status: 'not_searched',
        display_order: index,
      })),
    });

    return {
      id: session.id,
      shareToken: session.share_token,
    };
  }

  /**
   * shareToken から detail に必要な 4 テーブル分をまとめて読む。
   * 集計ビューを置かず、候補順・参加者順・投票順の意味づけは assembler 側に残す。
   */
  async findDetailByShareToken(
    db: PrismaExecutor,
    shareToken: string,
  ): Promise<DishCategoryGroupVoteDetailRecord | null> {
    const session = (await db.dish_category_group_vote_sessions.findUnique({
      where: { share_token: shareToken },
      select: {
        id: true,
        host_user_id: true,
        share_token: true,
        search_context: true,
        created_at: true,
        updated_at: true,
      },
    })) as PrismaDishCategoryGroupVoteSessions | null;

    if (!session) return null;

    const candidates = (await db.dish_category_group_vote_candidates.findMany({
      where: { session_id: session.id },
      orderBy: { display_order: 'asc' },
      select: {
        id: true,
        session_id: true,
        dish_category_id: true,
        display_name: true,
        tagline: true,
        image_url: true,
        dish_media_ids: true,
        dish_media_search_status: true,
        display_order: true,
        deleted_at: true,
        created_at: true,
      },
    })) as PrismaDishCategoryGroupVoteCandidates[];

    const participants =
      (await db.dish_category_group_vote_participants.findMany({
        where: { session_id: session.id },
        orderBy: { created_at: 'asc' },
        select: {
          id: true,
          session_id: true,
          user_id: true,
          display_name: true,
          comment: true,
          created_at: true,
        },
      })) as PrismaDishCategoryGroupVoteParticipants[];

    const votes =
      candidates.length === 0
        ? []
        : ((await db.dish_category_group_vote_candidate_votes.findMany({
            where: {
              candidate_id: { in: candidates.map((candidate) => candidate.id) },
            },
            orderBy: { created_at: 'asc' },
            select: {
              participant_id: true,
              candidate_id: true,
              reaction: true,
              created_at: true,
            },
          })) as PrismaDishCategoryGroupVoteCandidateVotes[]);

    return { session, candidates, participants, votes };
  }

  /**
   * sessionId を明示して read するのは、shareToken ではなく内部操作の境界を守るため。
   * 候補更新や detail 再取得では、公開トークンを経由しない方が責務がぶれない。
   */
  async findSessionById(
    db: PrismaExecutor,
    sessionId: string,
  ): Promise<PrismaDishCategoryGroupVoteSessions | null> {
    const session = (await db.dish_category_group_vote_sessions.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        host_user_id: true,
        share_token: true,
        search_context: true,
        created_at: true,
        updated_at: true,
      },
    })) as PrismaDishCategoryGroupVoteSessions | null;

    return session;
  }

  async findCandidateById(
    db: PrismaExecutor,
    sessionId: string,
    candidateId: string,
  ): Promise<PrismaDishCategoryGroupVoteCandidates | null> {
    const candidate = (await db.dish_category_group_vote_candidates.findFirst({
      where: {
        id: candidateId,
        session_id: sessionId,
      },
      select: {
        id: true,
        session_id: true,
        dish_category_id: true,
        display_name: true,
        tagline: true,
        image_url: true,
        dish_media_ids: true,
        dish_media_search_status: true,
        display_order: true,
        deleted_at: true,
        created_at: true,
      },
    })) as PrismaDishCategoryGroupVoteCandidates | null;

    return candidate;
  }

  /**
   * 投票では「候補が同じ session に属するか」だけを検証する。
   * deleted_at は投票送信と候補削除のレースを許容するため、ここでは見ない。
   */
  async assertCandidatesBelongToSession(
    db: PrismaExecutor,
    sessionId: string,
    candidateIds: string[],
  ): Promise<boolean> {
    const uniqueCandidateIds = [...new Set(candidateIds)];
    const rows = await db.dish_category_group_vote_candidates.findMany({
      where: {
        session_id: sessionId,
        id: { in: uniqueCandidateIds },
      },
      select: { id: true },
    });

    return rows.length === uniqueCandidateIds.length;
  }

  /**
   * participant と votes は同じトランザクションに入れる。
   * そうしないと detail 再取得時に participant だけ先に見えて、候補別投票がまだ無い状態になる。
   */
  async createParticipantWithVotes(
    db: PrismaExecutor,
    sessionId: string,
    userId: string,
    dto: SubmitDishCategoryGroupVoteDto,
  ): Promise<{ id: string }> {
    const participant = await db.dish_category_group_vote_participants.create({
      data: {
        session_id: sessionId,
        user_id: userId,
        display_name: dto.displayName,
        comment: dto.comment ?? null,
      },
      select: { id: true },
    });

    if (dto.votes.length > 0) {
      await db.dish_category_group_vote_candidate_votes.createMany({
        data: dto.votes.map((vote) => ({
          participant_id: participant.id,
          candidate_id: vote.candidateId,
          reaction: vote.reaction,
        })),
      });
    }

    return { id: participant.id };
  }

  /**
   * 店を見るで得た検索結果を固定する。
   * not_searched 以外は上書きせず、最初に保存された結果だけを真実にする。
   */
  async updateCandidateDishMediaIds(
    db: PrismaExecutor,
    sessionId: string,
    candidateId: string,
    dishMediaIds: string[],
    dishMediaSearchStatus: Exclude<
      DishCategoryGroupVoteDishMediaSearchStatus,
      'not_searched'
    >,
  ): Promise<{
    dishMediaIds: string[];
    dishMediaSearchStatus: DishCategoryGroupVoteDishMediaSearchStatus;
    updated: boolean;
  }> {
    const result = await db.dish_category_group_vote_candidates.updateMany({
      where: {
        id: candidateId,
        session_id: sessionId,
        dish_media_search_status: 'not_searched',
      },
      data: {
        dish_media_ids: dishMediaIds,
        dish_media_search_status: dishMediaSearchStatus,
      },
    });

    if (result.count === 1) {
      // 1 件更新できた場合は、not_searched からの初回更新なので、更新済みとして返す。
      return {
        dishMediaIds,
        dishMediaSearchStatus,
        updated: true,
      };
    }

    // 0 件更新の場合は、すでに検索済みのため、既存値を返す。
    const existingCandidate =
      await db.dish_category_group_vote_candidates.findFirst({
        where: {
          id: candidateId,
          session_id: sessionId,
        },
        select: {
          dish_media_ids: true,
          dish_media_search_status: true,
        },
      });

    if (!existingCandidate) {
      throw new Error(
        `Candidate not found for id ${candidateId} and sessionId ${sessionId}`,
      );
    }

    return {
      dishMediaIds: existingCandidate.dish_media_ids,
      dishMediaSearchStatus:
        existingCandidate.dish_media_search_status as DishCategoryGroupVoteDishMediaSearchStatus,
      updated: false,
    };
  }

  /**
   * 候補は物理削除しない。
   * 既存 vote の説明可能性を守るため、deleted_at だけを立てる。
   */
  async softDeleteCandidate(
    db: PrismaExecutor,
    sessionId: string,
    candidateId: string,
  ): Promise<void> {
    await db.dish_category_group_vote_candidates.updateMany({
      where: {
        id: candidateId,
        session_id: sessionId,
        deleted_at: null,
      },
      data: {
        deleted_at: new Date(),
      },
    });
  }

  // #943 【仕様】ホストの誤削除からの回復用。削除済み(deleted_at IS NOT NULL)のときだけ戻す。
  async restoreCandidate(
    db: PrismaExecutor,
    sessionId: string,
    candidateId: string,
  ): Promise<void> {
    await db.dish_category_group_vote_candidates.updateMany({
      where: {
        id: candidateId,
        session_id: sessionId,
        deleted_at: { not: null },
      },
      data: {
        deleted_at: null,
      },
    });
  }

  /**
   * session.updated_at を更新する。
   * ここを明示更新にしておくと、候補追加・削除・dish_media 固定を同じ再取得パスへ寄せられる。
   */
  async touchSession(db: PrismaExecutor, sessionId: string): Promise<void> {
    await db.dish_category_group_vote_sessions.update({
      where: { id: sessionId },
      data: {
        updated_at: new Date(),
      },
      select: {
        id: true,
      },
    });
  }

  isUniqueViolation(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'P2002'
    );
  }
}
