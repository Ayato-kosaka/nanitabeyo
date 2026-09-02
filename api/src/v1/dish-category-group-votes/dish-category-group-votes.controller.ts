// api/src/v1/dish-category-group-votes/dish-category-group-votes.controller.ts
//
// #856 【設計】dish_category グループ投票 API。
// 全エンドポイントは匿名ユーザーを含む認証必須とし、user_id は JWT から取得する。
// shareToken は閲覧用、sessionId は投票・候補更新など内部操作用に分ける。

import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

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

import { AuthAnonGuard } from '../../core/auth/auth.guard';
import { CurrentUser } from '../../core/auth/current-user.decorator';
import { RequestUser } from '../../core/auth/auth.types';
import { DishCategoryGroupVotesService } from './dish-category-group-votes.service';

@ApiTags('DishCategoryGroupVotes')
@Controller('v1/dish-category-group-votes')
export class DishCategoryGroupVotesController {
  constructor(private readonly service: DishCategoryGroupVotesService) {}

  /* ------------------------------------------------------------------ */
  /*              POST /v1/dish-category-group-votes                    */
  /* ------------------------------------------------------------------ */
  @Post()
  @UseGuards(AuthAnonGuard)
  @ApiBearerAuth()
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  @ApiOperation({
    summary: 'dish_category グループ投票セッション作成',
    description:
      '候補表示名・画像を作成時点のスナップショットとして固定し、共有用 shareToken を発行する。' +
      ' #1507 body に idempotencyKey (UUID v4) を付けると再送に対して冪等になり、' +
      '同一ホスト・同一キーの 2 回目以降は新規セッションを作らず初回と同じ id / shareToken を 201 で返す。',
  })
  @ApiResponse({
    status: 201,
    description: '作成成功（冪等キーによる再送で既存セッションを返した場合も 201）',
  })
  async create(
    @Body() dto: CreateDishCategoryGroupVoteDto,
    @CurrentUser() user: RequestUser,
  ): Promise<CreateDishCategoryGroupVoteResponse> {
    return this.service.create(dto, user.id);
  }

  /* ------------------------------------------------------------------ */
  /*           GET /v1/dish-category-group-votes/:shareToken            */
  /* ------------------------------------------------------------------ */
  @Get(':shareToken')
  @UseGuards(AuthAnonGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'dish_category グループ投票詳細取得',
    description:
      'shareToken からセッションを解決し、sessionId、候補、投票、コメント、集計結果を返す。',
  })
  @ApiParam({ name: 'shareToken', required: true })
  @ApiResponse({ status: 200, description: '取得成功' })
  @ApiResponse({ status: 404, description: 'セッションが見つからない' })
  async getDetail(
    @Param('shareToken') shareToken: string,
    @CurrentUser() user: RequestUser,
  ): Promise<DishCategoryGroupVoteDetailResponse> {
    return this.service.getDetailByShareToken(shareToken, user.id);
  }

  /* ------------------------------------------------------------------ */
  /*        POST /v1/dish-category-group-votes/:sessionId/vote          */
  /* ------------------------------------------------------------------ */
  @Post(':sessionId/vote')
  @UseGuards(AuthAnonGuard)
  @ApiBearerAuth()
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  @ApiOperation({
    summary: 'dish_category グループ投票を送信',
    description:
      '参加者と候補別投票を同一トランザクションで保存する。候補削除とのレースを避けるため deleted_at は問わない。',
  })
  @ApiParam({ name: 'sessionId', required: true })
  @ApiResponse({ status: 201, description: '投票保存成功' })
  @ApiResponse({ status: 409, description: '既に投票済み' })
  async submitVote(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Body() dto: SubmitDishCategoryGroupVoteDto,
    @CurrentUser() user: RequestUser,
  ): Promise<SubmitDishCategoryGroupVoteResponse> {
    return this.service.submitVote(sessionId, dto, user.id);
  }

  /* ------------------------------------------------------------------ */
  /* PATCH /v1/dish-category-group-votes/:sessionId/candidates/:candidateId/dish-media */
  /* ------------------------------------------------------------------ */
  @Patch(':sessionId/candidates/:candidateId/dish-media')
  @UseGuards(AuthAnonGuard)
  @ApiBearerAuth()
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  @ApiOperation({
    summary: '店舗提案用 dish_media_ids を候補にキャッシュ',
    description:
      '誰でも実行可能。dish_media_search_status が not_searched の場合だけ保存する。空配列は empty、値ありは found として扱い、既に検索済みなら上書きせず既存値を返す。',
  })
  @ApiParam({ name: 'sessionId', required: true })
  @ApiParam({ name: 'candidateId', required: true })
  @ApiResponse({ status: 200, description: 'キャッシュ更新または既存値返却' })
  async updateCandidateDishMedia(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Param('candidateId', ParseUUIDPipe) candidateId: string,
    @Body() dto: UpdateDishCategoryGroupVoteCandidateDishMediaDto,
    @CurrentUser() user: RequestUser,
  ): Promise<UpdateDishCategoryGroupVoteCandidateDishMediaResponse> {
    return this.service.updateCandidateDishMedia(
      sessionId,
      candidateId,
      dto,
      user.id,
    );
  }

  /* ------------------------------------------------------------------ */
  /* DELETE /v1/dish-category-group-votes/:sessionId/candidates/:candidateId */
  /* ------------------------------------------------------------------ */
  @Delete(':sessionId/candidates/:candidateId')
  @UseGuards(AuthAnonGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: '候補を論理削除',
    description:
      'ホストのみ実行可能。投票後も削除でき、deleted_at を更新する。既に削除済みなら冪等に成功する。',
  })
  @ApiParam({ name: 'sessionId', required: true })
  @ApiParam({ name: 'candidateId', required: true })
  @ApiResponse({ status: 200, description: '削除成功' })
  @ApiResponse({ status: 403, description: 'ホスト以外は削除不可' })
  async deleteCandidate(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Param('candidateId', ParseUUIDPipe) candidateId: string,
    @CurrentUser() user: RequestUser,
  ): Promise<DeleteDishCategoryGroupVoteCandidateResponse> {
    return this.service.deleteCandidate(sessionId, candidateId, user.id);
  }

  /* ------------------------------------------------------------------ */
  /* PATCH /v1/dish-category-group-votes/:sessionId/candidates/:candidateId/restore */
  /* ------------------------------------------------------------------ */
  @Patch(':sessionId/candidates/:candidateId/restore')
  @UseGuards(AuthAnonGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: '論理削除した候補を復元',
    description:
      'ホストのみ実行可能。削除のUndo導線として使う。既に復元済み(未削除)なら冪等に成功する。',
  })
  @ApiParam({ name: 'sessionId', required: true })
  @ApiParam({ name: 'candidateId', required: true })
  @ApiResponse({ status: 200, description: '復元成功' })
  @ApiResponse({ status: 403, description: 'ホスト以外は復元不可' })
  async restoreCandidate(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Param('candidateId', ParseUUIDPipe) candidateId: string,
    @CurrentUser() user: RequestUser,
  ): Promise<RestoreDishCategoryGroupVoteCandidateResponse> {
    return this.service.restoreCandidate(sessionId, candidateId, user.id);
  }
}
