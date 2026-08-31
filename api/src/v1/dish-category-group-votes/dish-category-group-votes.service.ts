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
  RestoreDishCategoryGroupVoteCandidateResponse,
  SubmitDishCategoryGroupVoteResponse,
  UpdateDishCategoryGroupVoteCandidateDishMediaResponse,
} from '@shared/v1/res';
import { PrismaService } from '../../prisma/prisma.service';
import { AppLoggerService } from '../../core/logger/logger.service';
import { CloudTasksService } from '../../core/cloud-tasks/cloud-tasks.service';
import { DishCategoryGroupVotesRepository } from './dish-category-group-votes.repository';
import { DishCategoryGroupVotesAssembler } from './dish-category-group-votes.assembler';

@Injectable()
export class DishCategoryGroupVotesService {
  constructor(
    private readonly repo: DishCategoryGroupVotesRepository,
    private readonly assembler: DishCategoryGroupVotesAssembler,
    private readonly prisma: PrismaService,
    private readonly logger: AppLoggerService,
    private readonly cloudTasks: CloudTasksService,
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
      hasIdempotencyKey: Boolean(dto.idempotencyKey),
    });

    this.validateCreateCandidates(dto);

    // #1507 【設計】作成の冪等化。
    //
    // フロントの useRef 同期ガード（#1205）は「同一 JS タスク内の連打」しか守れず、
    // 通信のリトライ・オフライン復帰後の再送・再マウントでは二重に POST が届く。
    // 二重に作られると **別々の shareToken を持つ投票セッションが 2 件**でき、
    // 片方のリンクを配った参加者とホストが別の投票を見ることになる。
    //
    // 経路は notifications.repository.ts の三段構え（find → create → P2002 で再 find）と同じ。
    // ① 事前チェックで大半の再送を例外を通さずに返し、
    // ③ で「事前チェックをすり抜けた並行リクエスト」を DB の unique 制約で受け止める。
    // 正しさは ③ だけで成立し、① は fast path。
    if (dto.idempotencyKey) {
      const replayed = await this.repo.findSessionByIdempotencyKey(
        this.prisma.prisma,
        hostUserId,
        dto.idempotencyKey,
      );
      if (replayed) {
        // 再送でもステータスは 201・レスポンス形も同じにする。
        // 「何回送っても結果が同じ」が冪等なので、クライアントに分岐を持たせない。
        this.logger.debug('DishCategoryGroupVotes.create', 'idempotentReplay', {
          hostUserId,
          sessionId: replayed.id,
          via: 'lookup',
        });
        return {
          id: replayed.id,
          shareToken: replayed.share_token,
        };
      }
    }

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
      // #1507 並行して届いた同一キーの 2 発目。
      //
      // PostgreSQL の unique index により、後着の INSERT は先着のトランザクションが
      // commit / abort するまでブロックされる。ここへ来たということは先着が commit 済み
      // （= session と candidates が揃っている）なので、その行を読んで返せばよい。
      //
      // ⚠️ 元のトランザクションは abort しているため、必ずトランザクション外の
      //    this.prisma.prisma で読み直すこと。
      if (
        dto.idempotencyKey &&
        this.repo.isUniqueViolationOn(error, 'idempotency_key')
      ) {
        const replayed = await this.repo.findSessionByIdempotencyKey(
          this.prisma.prisma,
          hostUserId,
          dto.idempotencyKey,
        );
        if (replayed) {
          this.logger.warn(
            'DishCategoryGroupVotes.idempotentReplay',
            'create',
            {
              hostUserId,
              sessionId: replayed.id,
              via: 'uniqueViolation',
            },
          );
          return {
            id: replayed.id,
            shareToken: replayed.share_token,
          };
        }
        // セッションに削除経路が無い以上ここへは到達しないが、握り潰さずに落とす
        // （notifications.repository.ts の retry が見つからなければ throw と同じ防御）。
      }

      this.logger.error('DishCategoryGroupVotes.createFailed', 'create', {
        hostUserId,
        candidateCount: dto.candidates.length,
        error,
      });
      // share_token の偶発衝突は従来どおり 409。冪等キー衝突は上で処理済みなのでここには来ない。
      if (this.repo.isUniqueViolation(error)) {
        throw new ConflictException(
          'Failed to create dish category group vote',
        );
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
      this.logger.error(
        'DishCategoryGroupVotes.getDetailFailed',
        'getDetailByShareToken',
        {
          shareToken,
          viewerUserId,
          error,
        },
      );
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
          const candidatesBelong =
            await this.repo.assertCandidatesBelongToSession(
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

      // #1506 【設計】GRP-04 投票完了通知。「全員投票し終えた」を判定するカラムが
      // モデルに無いため、参加者が1人投票を終えるたびにホストへ通知する。
      // idempotencyKey は session 単位にし、複数参加者の投票を同一スレッドへ
      // 集約する（dish_media の like と同じ設計）。ホスト自身の投票は
      // NotificationJobService 側の自己通知 skip に任せる。
      const idempotencyKey = `dish_category_group_vote_sessions:vote:${sessionId}`;
      this.cloudTasks
        .enqueueNotification({
          actionType: 'vote',
          targetTable: 'dish_category_group_vote_sessions',
          targetId: sessionId,
          actorId: userId,
          idempotencyKey,
        })
        .catch((error) => {
          this.logger.error(
            'DishCategoryGroupVotes.enqueueNotificationFailed',
            'submitVote',
            {
              sessionId,
              userId,
              participantId: participant.id,
              error: error instanceof Error ? error.message : String(error),
            },
          );
        });

      return {
        participantId: participant.id,
        stored: true,
      };
    } catch (error) {
      this.logger.error(
        'DishCategoryGroupVotes.submitVoteFailed',
        'submitVote',
        {
          sessionId,
          userId,
          voteCount: dto.votes.length,
          error,
        },
      );
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
    this.logger.debug(
      'DishCategoryGroupVotes.updateCandidateDishMedia',
      'start',
      {
        sessionId,
        candidateId,
        userId,
        count: dto.dishMediaIds.length,
      },
    );

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
              dishMediaSearchStatus:
                candidate.dish_media_search_status as UpdateDishCategoryGroupVoteCandidateDishMediaResponse['dishMediaSearchStatus'],
              updated: false,
            };
          }

          // #1513 【設計】投票候補は「墓標を出さず黙って除外する」側の画面。
          // 削除済みメディアは固定する前に落とす（一度固定すると上書きしないので、
          // ここで混ぜると以後ずっと «もう無い写真» が候補に居座る）。
          // 全部落ちたときは «検索済み 0 件» と同じ empty になる
          const liveDishMediaIds = await this.repo.filterLiveDishMediaIds(
            tx,
            dto.dishMediaIds,
          );
          const nextStatus = liveDishMediaIds.length > 0 ? 'found' : 'empty';
          const cached = await this.repo.updateCandidateDishMediaIds(
            tx,
            sessionId,
            candidateId,
            liveDishMediaIds,
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

      this.logger.debug(
        'DishCategoryGroupVotes.updateCandidateDishMedia',
        'completed',
        {
          sessionId,
          candidateId,
          userId,
          count: dto.dishMediaIds.length,
          updated: result.updated,
          dishMediaSearchStatus: result.dishMediaSearchStatus,
        },
      );

      return result;
    } catch (error) {
      this.logger.error(
        'DishCategoryGroupVotes.updateCandidateDishMediaFailed',
        'updateCandidateDishMedia',
        {
          sessionId,
          candidateId,
          userId,
          count: dto.dishMediaIds.length,
          error,
        },
      );
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
      this.logger.error(
        'DishCategoryGroupVotes.deleteCandidateFailed',
        'deleteCandidate',
        {
          sessionId,
          candidateId,
          userId,
          error,
        },
      );
      throw error;
    }
  }

  // #943 【仕様】誤削除からの回復用。deleteCandidateと対になる操作なので認可・冪等の扱いを揃える。
  async restoreCandidate(
    sessionId: string,
    candidateId: string,
    userId: string,
  ): Promise<RestoreDishCategoryGroupVoteCandidateResponse> {
    try {
      await this.prisma.withTransaction(
        async (tx: Prisma.TransactionClient) => {
          const session = await this.repo.findSessionById(tx, sessionId);
          if (!session) {
            throw new NotFoundException('Dish category group vote not found');
          }
          if (session.host_user_id !== userId) {
            throw new ForbiddenException('Only host can restore candidates');
          }

          const candidate = await this.repo.findCandidateById(
            tx,
            sessionId,
            candidateId,
          );
          if (!candidate) {
            throw new NotFoundException('Candidate not found');
          }

          if (candidate.deleted_at) {
            await this.repo.restoreCandidate(tx, sessionId, candidateId);
            await this.repo.touchSession(tx, sessionId);
          }
        },
      );

      this.logger.debug(
        'DishCategoryGroupVotes.restoreCandidate',
        'completed',
        {
          sessionId,
          candidateId,
          userId,
        },
      );

      return { restored: true };
    } catch (error) {
      this.logger.error(
        'DishCategoryGroupVotes.restoreCandidateFailed',
        'restoreCandidate',
        {
          sessionId,
          candidateId,
          userId,
          error,
        },
      );
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
