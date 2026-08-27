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
import { pickWinnerCandidate } from './dish-category-group-votes.ranking';
import {
  formatCompositeCursor,
  parseCompositeCursor,
} from '../../core/pagination/composite-cursor';

export type PrismaExecutor = Prisma.TransactionClient | PrismaClient;

export type DishCategoryGroupVoteDetailRecord = {
  session: PrismaDishCategoryGroupVoteSessions;
  candidates: PrismaDishCategoryGroupVoteCandidates[];
  participants: PrismaDishCategoryGroupVoteParticipants[];
  votes: PrismaDishCategoryGroupVoteCandidateVotes[];
};

/**
 * #1505 一覧の行に出すサムネイル + 候補名の件数。
 *
 * 3 件はデザイン側の決定（44pt のサムネイルを 3 枚重ねた幅が、
 * 文字列 2 行とシェブロンを置いても最小幅の端末で溢れない上限）。
 * 4 件目以降は candidateCount との差から「+N」として表現するので、ここを増やすと
 * 画面側の「+N」の意味も変わる。増減させるときは両方を見ること。
 */
const ME_LIST_CANDIDATE_PREVIEW_LIMIT = 3;

export type MeDishCategoryGroupVoteCandidatePreviewRecord = {
  displayName: string;
  imageUrl: string;
};

export type MeDishCategoryGroupVoteSessionRecord = {
  id: string;
  shareToken: string;
  hasVoted: boolean;
  candidateCount: number;
  candidatePreviews: MeDishCategoryGroupVoteCandidatePreviewRecord[];
  participantCount: number;
  winnerName: string | null;
  createdAt: Date;
  updatedAt: Date;
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
        // #1507 冪等キーは行そのものに刻む。未送信（旧クライアント）は NULL のまま入れる。
        // (host_user_id, idempotency_key) の複合 unique が最終防衛線で、
        // PostgreSQL の UNIQUE は NULL 同士を衝突と見なさないため NULL は何件でも入る。
        idempotency_key: dto.idempotencyKey ?? null,
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

    // #1513 【設計】投票候補は「黙って除外する」側の画面。削除済みメディアは墓標を出さず
    // 候補から落とす（投票の場に「もう無い写真」を並べる意味が無いため）。
    // 過去に保存された dish_media_ids は migration で書き換えず、**読み出し時に落とす**。
    // dish_media_search_status は保存時のまま返す（'found' のまま 0 件になり得る）。
    // 状態を読み出し側で作り替えると、固定済みの検索結果という契約が崩れる
    await this.dropDeletedDishMediaIds(db, candidates);

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

  /**
   * #1513 `dish_media_ids` のうち **実体が生きているものだけ** を、元の順序で返す。
   *
   * 投票候補は「墓標を出さず黙って除外する」側の画面なので、削除済みメディアは
   * 保存時（`updateCandidateDishMediaIds` の呼び出し元）にも読み出し時にも落とす。
   */
  async filterLiveDishMediaIds(
    db: PrismaExecutor,
    dishMediaIds: string[],
  ): Promise<string[]> {
    if (dishMediaIds.length === 0) return [];

    const rows = await db.dish_media.findMany({
      where: { id: { in: [...new Set(dishMediaIds)] }, deleted_at: null },
      select: { id: true },
    });
    const live = new Set(rows.map((row) => row.id));

    // 検索結果の並びは «おすすめ順» なので、生存 id の順序は入力どおりに保つ
    return dishMediaIds.filter((id) => live.has(id));
  }

  /**
   * #1513 候補行の `dish_media_ids` から削除済みメディアを落とす（破壊的に書き換える）。
   *
   * 全候補ぶんを **1 本の問い合わせ**で判定する。候補ごとに引くと、
   * detail 1 回の取得で候補数ぶんのクエリが走る。
   */
  private async dropDeletedDishMediaIds(
    db: PrismaExecutor,
    candidates: PrismaDishCategoryGroupVoteCandidates[],
  ): Promise<void> {
    const allIds = candidates.flatMap((candidate) => candidate.dish_media_ids);
    if (allIds.length === 0) return;

    const live = new Set(await this.filterLiveDishMediaIds(db, allIds));
    for (const candidate of candidates) {
      if (candidate.dish_media_ids.some((id) => !live.has(id))) {
        candidate.dish_media_ids = candidate.dish_media_ids.filter((id) =>
          live.has(id),
        );
      }
    }
  }

  /**
   * #1505 【設計】GET /v1/users/me/dish-category-group-votes 用。
   * **自分が主催(host_user_id = 自分)したセッションだけ**を返す。
   *
   * オーナー指示により、参加しただけ(participants に自分が居るだけ)のセッションは一覧に出さない。
   * 絞り込みは呼び出し側やクライアントではなくこの where 句 1 箇所に閉じる。
   * ここで返さなかった行は API のどの層からも復元できないので、
   * 「一覧に他人の投票が混ざらない」保証もこの 1 箇所を見れば足りる。
   *
   * ページングは updated_at 降順の単一カーソル。session の更新
   * (候補追加・削除・dish_media 固定・submitVote の touchSession)で updated_at が動くため、
   * 主催した投票の「最後に動きがあった順」で並ぶ。
   */
  async findMeSessions(
    db: PrismaExecutor,
    userId: string,
    cursor?: string,
    limit = 20,
  ): Promise<{
    items: MeDishCategoryGroupVoteSessionRecord[];
    nextCursor: string | null;
  }> {
    const whereClause: Prisma.dish_category_group_vote_sessionsWhereInput = {
      host_user_id: userId,
    };
    // #1596 カーソルは (updated_at, id) の複合。updated_at 単独だと、同じ
    // updated_at を持つ行がページ境界をまたいだとき `lt` が **同時刻の行をまとめて
    // 飛ばす**（20 件目と 21 件目が同時刻なら 21 件目以降が一覧から消える）。
    // touchSession は候補追加・削除・投票のたびに走るので、同一ミリ秒での複数更新は
    // «稀» であって «起きない» ではない。
    const parsed = parseCompositeCursor(cursor);
    if (parsed?.id) {
      whereClause.OR = [
        { updated_at: { lt: parsed.at } },
        { updated_at: parsed.at, id: { lt: parsed.id } },
      ];
    } else if (parsed) {
      // 旧形式（ISO8601 のみ）。配信済みクライアントが持っているカーソルを
      // 無効にしないため、従来どおりの絞り込みで受ける。
      whereClause.updated_at = { lt: parsed.at };
    }

    const sessions = await db.dish_category_group_vote_sessions.findMany({
      where: whereClause,
      // id を副次キーに入れて同点時の並びを固定する。ここが無いと複合カーソルの
      // 比較と実際の並びがズレ、やはり重複・欠落が出る。
      orderBy: [{ updated_at: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: {
        id: true,
        share_token: true,
        created_at: true,
        updated_at: true,
        _count: {
          select: {
            dish_category_group_vote_candidates: {
              where: { deleted_at: null },
            },
            // 参加者数は「何人が投票したか」として行に出す。
            // 下の participants select は自分の 1 件しか引かないので、そこからは数えられない。
            dish_category_group_vote_participants: true,
          },
        },
        dish_category_group_vote_participants: {
          where: { user_id: userId },
          select: { id: true },
          take: 1,
        },
      },
    });

    // #479 【設計】limit+1 件取得できた場合のみ nextCursor を返す
    const hasMore = sessions.length > limit;
    const page = hasMore ? sessions.slice(0, limit) : sessions;
    const nextCursor = hasMore
      ? formatCompositeCursor(
          page[page.length - 1].updated_at,
          page[page.length - 1].id,
        )
      : null;

    // #1505 【設計】候補と得票は **ページ全体を 2 クエリでまとめて引く**。
    // セッションごとに引くと 1 ページ 20 行で 40 クエリになり、一覧を開くだけで DB を叩き潰す。
    const previewsBySessionId = await this.buildCandidatePreviews(
      db,
      page.map((session) => session.id),
    );

    return {
      items: page.map((session) => {
        const preview = previewsBySessionId.get(session.id);
        return {
          id: session.id,
          shareToken: session.share_token,
          // 主催者自身が自分の投票に投票済みかどうか。主催と投票済みは独立なので残す。
          hasVoted: session.dish_category_group_vote_participants.length > 0,
          candidateCount: session._count.dish_category_group_vote_candidates,
          candidatePreviews: preview?.previews ?? [],
          participantCount:
            session._count.dish_category_group_vote_participants,
          winnerName: preview?.winnerName ?? null,
          createdAt: session.created_at,
          updatedAt: session.updated_at,
        };
      }),
      nextCursor,
    };
  }

  /**
   * #1505 一覧の行に出す «料理» を作る。セッション ID ごとに
   * 「先頭 3 件のサムネイル + 候補名」と「勝者名（確定していれば）」を返す。
   *
   * クエリは 2 本だけに保つ。
   * 1. ページ内の全セッションの未削除候補（display_order 昇順）
   * 2. その候補に対する得票を groupBy で候補 × reaction の件数に畳んだもの
   *
   * 得票を集計ビューに持たない方針（assembler と同じ）なのでここで数えるが、
   * 数えるのは «取得済みの候補 ID に紐づく行だけ» で、セッション単位のループでは引かない。
   */
  private async buildCandidatePreviews(
    db: PrismaExecutor,
    sessionIds: string[],
  ): Promise<
    Map<
      string,
      {
        previews: MeDishCategoryGroupVoteCandidatePreviewRecord[];
        winnerName: string | null;
      }
    >
  > {
    const result = new Map<
      string,
      {
        previews: MeDishCategoryGroupVoteCandidatePreviewRecord[];
        winnerName: string | null;
      }
    >();
    if (sessionIds.length === 0) return result;

    const candidates = await db.dish_category_group_vote_candidates.findMany({
      where: { session_id: { in: sessionIds }, deleted_at: null },
      // 一覧のサムネイルは結果画面の候補の並びと同じ順にする（display_order が表示順の正本）。
      orderBy: [{ session_id: 'asc' }, { display_order: 'asc' }],
      select: {
        id: true,
        session_id: true,
        display_name: true,
        image_url: true,
        display_order: true,
      },
    });

    if (candidates.length === 0) return result;

    // 候補 ID × reaction の件数。votes 本体は行に出さないので、明細は引かない。
    const voteCounts =
      await db.dish_category_group_vote_candidate_votes.groupBy({
        by: ['candidate_id', 'reaction'],
        where: {
          candidate_id: { in: candidates.map((candidate) => candidate.id) },
        },
        _count: { _all: true },
      });

    const countsByCandidateId = new Map<
      string,
      { likeCount: number; dislikeCount: number }
    >();
    for (const row of voteCounts) {
      const counts = countsByCandidateId.get(row.candidate_id) ?? {
        likeCount: 0,
        dislikeCount: 0,
      };
      // reaction は 'like' | 'dislike' の 2 値だが DB は String なので、
      // 未知の値が入っていてもどちらのカウントにも足さずに黙って無視する
      // （一覧が 500 で落ちるより、勝者が出ないほうが害が小さい）。
      if (row.reaction === 'like') counts.likeCount += row._count._all;
      if (row.reaction === 'dislike') counts.dislikeCount += row._count._all;
      countsByCandidateId.set(row.candidate_id, counts);
    }

    const candidatesBySessionId = new Map<string, typeof candidates>();
    for (const candidate of candidates) {
      const bucket = candidatesBySessionId.get(candidate.session_id) ?? [];
      bucket.push(candidate);
      candidatesBySessionId.set(candidate.session_id, bucket);
    }

    for (const [sessionId, sessionCandidates] of candidatesBySessionId) {
      const winner = pickWinnerCandidate(
        sessionCandidates.map((candidate) => {
          const counts = countsByCandidateId.get(candidate.id) ?? {
            likeCount: 0,
            dislikeCount: 0,
          };
          return {
            candidateId: candidate.id,
            likeCount: counts.likeCount,
            dislikeCount: counts.dislikeCount,
            displayOrder: candidate.display_order,
            displayName: candidate.display_name,
          };
        }),
      );

      result.set(sessionId, {
        previews: sessionCandidates
          .slice(0, ME_LIST_CANDIDATE_PREVIEW_LIMIT)
          .map((candidate) => ({
            displayName: candidate.display_name,
            imageUrl: candidate.image_url,
          })),
        winnerName: winner?.displayName ?? null,
      });
    }

    return result;
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

    // #1513 detail と同じく、読み出し時に削除済みメディアを落とす
    if (candidate) await this.dropDeletedDishMediaIds(db, [candidate]);

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

  /**
   * #1507 冪等キーから既存セッションを引く。
   *
   * 複合 unique (host_user_id, idempotency_key) なので findUnique で引ける。
   * **host_user_id を where に含めることが本質**で、これにより「既存行を返す」経路が
   * 呼び出し本人の行しか返さないことが制約と型の両方で保証される
   * （他人のセッションと share_token を返す漏洩経路を作らない）。
   */
  async findSessionByIdempotencyKey(
    db: PrismaExecutor,
    hostUserId: string,
    idempotencyKey: string,
  ): Promise<{ id: string; share_token: string } | null> {
    return db.dish_category_group_vote_sessions.findUnique({
      where: {
        host_user_id_idempotency_key: {
          host_user_id: hostUserId,
          idempotency_key: idempotencyKey,
        },
      },
      select: {
        id: true,
        share_token: true,
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

  /**
   * #1507 unique 違反が「どの列で起きたか」まで見る。
   *
   * このテーブルには share_token（偶発衝突 → 409 にすべき）と idempotency_key
   * （再送 → 既存行を返すべき）の 2 つの unique があるので、`isUniqueViolation` の
   * P2002 判定だけでは扱いを分けられない。
   *
   * Prisma の P2002 は `meta.target` に **列名の配列**（例 `['host_user_id', 'idempotency_key']`）
   * を載せるが、DB やドライバによっては **インデックス名の文字列**
   * （例 `'dcgvs_host_user_id_idempotency_key_uq'`）になる。両方の形式を受ける。
   */
  isUniqueViolationOn(error: unknown, columnName: string): boolean {
    if (!this.isUniqueViolation(error)) return false;

    const target = (error as { meta?: { target?: unknown } }).meta?.target;

    if (Array.isArray(target)) {
      return target.some(
        (entry) => typeof entry === 'string' && entry.includes(columnName),
      );
    }
    if (typeof target === 'string') {
      return target.includes(columnName);
    }
    return false;
  }
}
