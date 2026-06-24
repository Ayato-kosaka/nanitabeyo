// api/src/v1/dish-category-group-votes/dish-category-group-votes.repository.ts
//
// #856 【設計】dish_category グループ投票の永続化境界。
// Prisma schema 生成前でもAPI設計をレビューできるよう、ここでは
// Entity とメソッド境界を先に定義し、DB実装は後続タスクで埋める。
// 実装時は migration のテーブル名を使って Prisma Client 再生成後に置き換える。

import { Injectable } from '@nestjs/common';
import { Prisma, PrismaClient } from '../../../../shared/prisma/client';
import {
  CreateDishCategoryGroupVoteDto,
  SubmitDishCategoryGroupVoteDto,
} from '@shared/v1/dto';
import { DishCategoryGroupVoteSearchContext } from '@shared/v1/res';


// TODO: 実装時は  type の定義は無駄に行わないこと。shared/converter を使うこと。
export type PrismaExecutor = Prisma.TransactionClient | PrismaClient;

export type DishCategoryGroupVoteSessionEntity = {
  id: string;
  hostUserId: string;
  shareToken: string;
  searchContext: DishCategoryGroupVoteSearchContext;
  createdAt: Date;
  updatedAt: Date;
};

export type DishCategoryGroupVoteCandidateEntity = {
  id: string;
  sessionId: string;
  dishCategoryId: string;
  displayName: string;
  imageUrl: string;
  dishMediaIds: string[] | null;
  displayOrder: number;
  deletedAt: Date | null;
  createdAt: Date;
};

export type DishCategoryGroupVoteParticipantEntity = {
  id: string;
  sessionId: string;
  userId: string;
  displayName: string;
  comment: string | null;
  createdAt: Date;
};

export type DishCategoryGroupVoteCandidateVoteEntity = {
  participantId: string;
  candidateId: string;
  reaction: 'like' | 'dislike';
  createdAt: Date;
};

export type DishCategoryGroupVoteDetailEntity = {
  session: DishCategoryGroupVoteSessionEntity;
  candidates: DishCategoryGroupVoteCandidateEntity[];
  participants: DishCategoryGroupVoteParticipantEntity[];
  votes: DishCategoryGroupVoteCandidateVoteEntity[];
};

@Injectable()
export class DishCategoryGroupVotesRepository {
  /**
   * セッションと候補を同一トランザクションで作成する。
   * searchContext は、共有リンク参加者が後から店舗提案へ進むために session に固定する。
   * shareToken は推測困難な値を生成し、displayOrder は candidates の配列順で採番する。
   */
  async createSessionWithCandidates(
    db: PrismaExecutor,
    dto: CreateDishCategoryGroupVoteDto,
    hostUserId: string,
  ): Promise<{ id: string; shareToken: string }> {
    void db;
    void dto;
    void hostUserId;
    throw new Error('Not implemented');
  }

  /**
   * shareToken から結果画面に必要な全データを取得する。
   * 集計ビューは使わず、Service/Assembler 側で like/dislike 数と順位を計算する。
   */
  async findDetailByShareToken(
    db: PrismaExecutor,
    shareToken: string,
  ): Promise<DishCategoryGroupVoteDetailEntity | null> {
    void db;
    void shareToken;
    throw new Error('Not implemented');
  }

  async findSessionById(
    db: PrismaExecutor,
    sessionId: string,
  ): Promise<DishCategoryGroupVoteSessionEntity | null> {
    void db;
    void sessionId;
    throw new Error('Not implemented');
  }

  async findCandidateById(
    db: PrismaExecutor,
    sessionId: string,
    candidateId: string,
  ): Promise<DishCategoryGroupVoteCandidateEntity | null> {
    void db;
    void sessionId;
    void candidateId;
    throw new Error('Not implemented');
  }

  /**
   * 投票対象 candidateId がすべて session 配下に存在することだけ確認する。
   * deleted_at は候補削除とのレースを許容するため問わない。
   */
  async assertCandidatesBelongToSession(
    db: PrismaExecutor,
    sessionId: string,
    candidateIds: string[],
  ): Promise<void> {
    void db;
    void sessionId;
    void candidateIds;
    throw new Error('Not implemented');
  }

  /**
   * participant と votes を作成する。
   * unique(session_id, user_id) により二重投票はDBで防ぐ。
   */
  async createParticipantWithVotes(
    db: PrismaExecutor,
    sessionId: string,
    userId: string,
    dto: SubmitDishCategoryGroupVoteDto,
  ): Promise<{ id: string }> {
    void db;
    void sessionId;
    void userId;
    void dto;
    throw new Error('Not implemented');
  }

  /**
   * 店舗提案用 dish_media_ids を未検索(NULL)の場合だけ保存する。
   * 空配列は「検索済み0件」なので、既に検索済みの場合の上書き抑止は Service 側で判定する。
   */
  async updateCandidateDishMediaIds(
    db: PrismaExecutor,
    sessionId: string,
    candidateId: string,
    dishMediaIds: string[],
  ): Promise<{ dishMediaIds: string[] }> {
    void db;
    void sessionId;
    void candidateId;
    void dishMediaIds;
    throw new Error('Not implemented');
  }

  async softDeleteCandidate(
    db: PrismaExecutor,
    sessionId: string,
    candidateId: string,
  ): Promise<void> {
    void db;
    void sessionId;
    void candidateId;
    throw new Error('Not implemented');
  }

  async touchSession(db: PrismaExecutor, sessionId: string): Promise<void> {
    void db;
    void sessionId;
    throw new Error('Not implemented');
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
