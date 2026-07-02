// api/src/v1/dish-category-group-votes/dish-category-group-votes.service.ts
//
// #856 【設計】dish_category グループ投票のユースケース境界。
//
// この Service は「共有リンク型の投票」という仕様上の不変条件を守る層。
// Controller は認証済み user_id と DTO を渡すだけにし、Repository は DB 操作に閉じる。
// ここでは、候補削除とのレース耐性、一発勝負、店舗提案キャッシュの固定化、
// detail 再取得に必要な updated_at 更新をまとめて扱う。

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../../../shared/prisma/client';
import {
  CreateDishCategoryGroupVoteDto,
  SubmitDishCategoryGroupVoteDto,
  UpdateDishCategoryGroupVoteCandidateDishMediaDto,
} from '@shared/v1/dto';
import {
  CreateDishCategoryGroupVoteResponse,
  DeleteDishCategoryGroupVoteCandidateResponse,
  DishCategoryGroupVoteDetailResponse,
  SubmitDishCategoryGroupVoteResponse,
  UpdateDishCategoryGroupVoteCandidateDishMediaResponse,
} from '@shared/v1/res';
import { PrismaService } from '../../prisma/prisma.service';
import { AppLoggerService } from '../../core/logger/logger.service';
import { DishCategoryGroupVotesRepository } from './dish-category-group-votes.repository';
import { DishCategoryGroupVotesAssembler } from './dish-category-group-votes.assembler';

@Injectable()
export class DishCategoryGroupVotesService {
  constructor(
    private readonly repo: DishCategoryGroupVotesRepository,
    private readonly assembler: DishCategoryGroupVotesAssembler,
    private readonly prisma: PrismaService,
    private readonly logger: AppLoggerService,
  ) {}

  private validateCreateCandidates(dto: CreateDishCategoryGroupVoteDto): void {
    const seen = new Set<string>();
    const duplicated = new Set<string>();

    for (const candidate of dto.candidates) {
      if (seen.has(candidate.dishCategoryId)) {
        duplicated.add(candidate.dishCategoryId);
      }
      seen.add(candidate.dishCategoryId);
    }

    if (duplicated.size > 0) {
      throw new BadRequestException('Duplicated candidate dishCategoryId');
    }
  }

  async create(
    dto: CreateDishCategoryGroupVoteDto,
    hostUserId: string,
  ): Promise<CreateDishCategoryGroupVoteResponse> {
    this.logger.debug('DishCategoryGroupVotes.create', 'start', {
      hostUserId,
      candidateCount: dto.candidates.length,
      radius: dto.searchContext.radius,
      localLanguageCode: dto.searchContext.localLanguageCode,
    });

    this.validateCreateCandidates(dto);

    try {
      // session と candidates は共有URL公開後に分離して見えてはいけない。
      // shareToken だけ発行され候補が未作成、または候補だけ残る状態を避けるため、
      // 作成系は1トランザクションに閉じる。searchContext も session と同時に固定し、
      // 共有リンクを直接開いたゲストが店舗提案へ進めない状態を作らない。
      const result = await this.prisma.withTransaction(
        async (tx: Prisma.TransactionClient) => {
          return this.repo.createSessionWithCandidates(tx, dto, hostUserId);
        },
      );

      this.logger.debug('DishCategoryGroupVotes.create', 'completed', {
        hostUserId,
        sessionId: result.id,
        shareToken: result.shareToken,
        candidateCount: dto.candidates.length,
      });

      return {
        id: result.id,
        shareToken: result.shareToken,
      };
    } catch (error) {
      this.logger.error('DishCategoryGroupVotes.createFailed', 'create', {
        hostUserId,
        candidateCount: dto.candidates.length,
        error,
      });
      if (this.repo.isUniqueViolation(error)) {
        throw new ConflictException('Failed to create dish category group vote');
      }
      throw error;
    }
  }

  async getDetailByShareToken(
    shareToken: string,
    viewerUserId: string,
  ): Promise<DishCategoryGroupVoteDetailResponse> {
    this.logger.debug('DishCategoryGroupVotes.getDetail', 'start', {
      shareToken,
      viewerUserId,
    });

    try {
      // shareToken は共有リンクの bearer secret として扱う。
      // URLから得た shareToken で sessionId を解決し、detail には内部IDも含める。
      const entity = await this.repo.findDetailByShareToken(
        this.prisma.prisma,
        shareToken,
      );

      if (!entity) {
        throw new NotFoundException('Dish category group vote not found');
      }

      const response = this.assembler.toDetailResponse(entity, viewerUserId);
      this.logger.debug('DishCategoryGroupVotes.getDetail', 'completed', {
        shareToken,
        viewerUserId,
        candidateCount: response.candidates.length,
        participantCount: response.session.participantCount,
      });
      return response;
    } catch (error) {
      this.logger.error('DishCategoryGroupVotes.getDetailFailed', 'getDetailByShareToken', {
        shareToken,
        viewerUserId,
        error,
      });
      throw error;
    }
  }

  async submitVote(
    sessionId: string,
    dto: SubmitDishCategoryGroupVoteDto,
    userId: string,
  ): Promise<SubmitDishCategoryGroupVoteResponse> {
    // DB の複合PKでも重複 candidate vote は防げるが、DTO内重複は
    // 「既に投票済み」ではなくリクエスト形状の衝突として早めに落とす。
    const duplicatedCandidateIds = this.findDuplicatedCandidateIds(
      dto.votes.map((vote) => vote.candidateId),
    );
    if (duplicatedCandidateIds.length > 0) {
      throw new ConflictException('Duplicated candidate vote');
    }

    try {
      // participant と votes と sessions.updated_at は同じ commit に乗せ、
      // GET detail の再取得で必ず整合した投票結果を読めるようにする。
      const participant = await this.prisma.withTransaction(
        async (tx: Prisma.TransactionClient) => {
          const session = await this.repo.findSessionById(tx, sessionId);
          if (!session) {
            throw new NotFoundException('Dish category group vote not found');
          }

          // 投票中にホストが候補削除しても送信をエラーにしない。
          // ここで守るのは「候補が同一セッションに属すること」だけで、
          // deleted_at や votes.length と未削除候補数の一致は検証しない。
          const candidatesBelong = await this.repo.assertCandidatesBelongToSession(
            tx,
            sessionId,
            dto.votes.map((vote) => vote.candidateId),
          );
          if (!candidatesBelong) {
            throw new NotFoundException('Candidate not found');
          }

          const created = await this.repo.createParticipantWithVotes(
            tx,
            sessionId,
            userId,
            dto,
          );
          await this.repo.touchSession(tx, sessionId);
          return created;
        },
      );

      this.logger.debug('DishCategoryGroupVotes.submitVote', 'completed', {
        sessionId,
        userId,
        participantId: participant.id,
        voteCount: dto.votes.length,
      });

      return {
        participantId: participant.id,
        stored: true,
      };
    } catch (error) {
      this.logger.error('DishCategoryGroupVotes.submitVoteFailed', 'submitVote', {
        sessionId,
        userId,
        voteCount: dto.votes.length,
        error,
      });
      // 一発勝負の最終防衛線は unique(session_id, user_id)。
      // APIインスタンス間の同時送信でも DB 制約に寄せて 409 に正規化する。
      if (this.repo.isUniqueViolation(error)) {
        throw new ConflictException('Already voted');
      }
      throw error;
    }
  }

  async updateCandidateDishMedia(
    sessionId: string,
    candidateId: string,
    dto: UpdateDishCategoryGroupVoteCandidateDishMediaDto,
    userId: string,
  ): Promise<UpdateDishCategoryGroupVoteCandidateDishMediaResponse> {
    this.logger.debug('DishCategoryGroupVotes.updateCandidateDishMedia', 'start', {
      sessionId,
      candidateId,
      userId,
      count: dto.dishMediaIds.length,
    });

    // 店舗提案は「最初に誰かが見た検索結果」をセッション内で固定する。
    // Prisma は PostgreSQL scalar list の NULL を [] と区別できないため、
    // dishMediaIds ではなく dishMediaSearchStatus で未検索/0件/候補ありを判断する。
    // 既に検索済みの場合は、後続ユーザーの検索タイミングで候補が差し替わらないように上書きしない。
    try {
      const result = await this.prisma.withTransaction(
        async (tx: Prisma.TransactionClient) => {
          const candidate = await this.repo.findCandidateById(
            tx,
            sessionId,
            candidateId,
          );
          if (!candidate) {
            throw new NotFoundException('Candidate not found');
          }

          if (candidate.dish_media_search_status !== 'not_searched') {
            // 冪等化により、複数ユーザーが同時に「店を見る」を押しても
            // クライアントは保存済みの固定結果をそのまま使える。
            // empty も「検索済み0件」という有効な固定結果なので上書きしない。
            return {
              candidateId,
              dishMediaIds: candidate.dish_media_ids,
              dishMediaSearchStatus: candidate.dish_media_search_status as UpdateDishCategoryGroupVoteCandidateDishMediaResponse["dishMediaSearchStatus"],
              updated: false,
            };
          }

          const nextStatus =
            dto.dishMediaIds.length > 0 ? 'found' : 'empty';
          const cached = await this.repo.updateCandidateDishMediaIds(
            tx,
            sessionId,
            candidateId,
            dto.dishMediaIds,
            nextStatus,
          );
          if (cached.updated) {
            // 更新があった場合のみ sessions.updated_at を更新し、次回 detail 再取得で反映させる。
            await this.repo.touchSession(tx, sessionId);
          }

          return {
            candidateId,
            dishMediaIds: cached.dishMediaIds,
            dishMediaSearchStatus: cached.dishMediaSearchStatus,
            updated: cached.updated,
          };
        },
      );

      this.logger.debug('DishCategoryGroupVotes.updateCandidateDishMedia', 'completed', {
        sessionId,
        candidateId,
        userId,
        count: dto.dishMediaIds.length,
        updated: result.updated,
        dishMediaSearchStatus: result.dishMediaSearchStatus,
      });

      return result;
    } catch (error) {
      this.logger.error('DishCategoryGroupVotes.updateCandidateDishMediaFailed', 'updateCandidateDishMedia', {
        sessionId,
        candidateId,
        userId,
        count: dto.dishMediaIds.length,
        error,
      });
      throw error;
    }
  }

  async deleteCandidate(
    sessionId: string,
    candidateId: string,
    userId: string,
  ): Promise<DeleteDishCategoryGroupVoteCandidateResponse> {
    // 削除はホストの意思決定として扱うが、既存 votes の説明可能性を残すため
    // 物理削除はしない。結果画面は deletedAt を見て非表示にする。
    try {
      await this.prisma.withTransaction(
        async (tx: Prisma.TransactionClient) => {
          const session = await this.repo.findSessionById(tx, sessionId);
          if (!session) {
            throw new NotFoundException('Dish category group vote not found');
          }
          if (session.host_user_id !== userId) {
            throw new ForbiddenException('Only host can delete candidates');
          }

          const candidate = await this.repo.findCandidateById(
            tx,
            sessionId,
            candidateId,
          );
          if (!candidate) {
            throw new NotFoundException('Candidate not found');
          }

          if (!candidate.deleted_at) {
            // 候補削除の即時反映は sessions.updated_at と次回 detail 再取得で整合させる。
            await this.repo.softDeleteCandidate(tx, sessionId, candidateId);
            await this.repo.touchSession(tx, sessionId);
          }
        },
      );

      this.logger.debug('DishCategoryGroupVotes.deleteCandidate', 'completed', {
        sessionId,
        candidateId,
        userId,
      });

      return { deleted: true };
    } catch (error) {
      this.logger.error('DishCategoryGroupVotes.deleteCandidateFailed', 'deleteCandidate', {
        sessionId,
        candidateId,
        userId,
        error,
      });
      throw error;
    }
  }

  private findDuplicatedCandidateIds(candidateIds: string[]): string[] {
    // DTO内重複の検出だけを担当する小さな helper。
    // 「投票済みかどうか」は session/user のDB制約に寄せる。
    const seen = new Set<string>();
    const duplicated = new Set<string>();

    for (const id of candidateIds) {
      if (seen.has(id)) {
        duplicated.add(id);
      }
      seen.add(id);
    }

    return [...duplicated];
  }
}
