// api/src/v1/logs/frontend-log-batch.pipe.ts
//
// #1079 【設計】バッチ内 1 件の不正で全体を棄却しないための検証 pipe
//
// 封筒（logs 配列そのもの）の検証は Nest 標準 ValidationPipe へ委譲し、
// 要素は 1 件ずつ検証して「受理された DTO」と「棄却の要約」に振り分ける。
//

import {
  ArgumentMetadata,
  Injectable,
  PipeTransform,
  ValidationPipe,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CreateFrontendLogBatchDto,
  CreateFrontendLogDto,
} from '@shared/v1/dto';

/**
 * 棄却された 1 件の要約。
 * #1079 値を一切持たない（PII を構造的に持てなくするための型）。
 */
export type RejectedFrontendLogSummary = {
  /** 配列内の位置 */
  index: number;
  /** 不正だったプロパティ名（例: ["created_commit_id"]） */
  fields: string[];
  /** 破られた制約名のみ（例: ["isString"]）。メッセージ本文は載せない */
  constraints: string[];
};

/** FrontendLogBatchValidationPipe が @Body() へ渡す値 */
export type ValidatedFrontendLogBatch = {
  accepted: CreateFrontendLogDto[];
  rejected: RejectedFrontendLogSummary[];
};

/** 非オブジェクト要素を棄却するときに使う擬似フィールド名 */
export const REJECTED_ROOT_FIELD = '(root)';

@Injectable()
export class FrontendLogBatchValidationPipe
  implements PipeTransform<unknown, Promise<unknown>>
{
  // 封筒(= logs 配列そのもの)の検証は Nest 標準 pipe に委譲する。
  // main.ts:44 のグローバル pipe と同じオプションにして 400 の条件・メッセージ形式を不変に保つ。
  private readonly envelopePipe = new ValidationPipe({
    whitelist: true,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
    forbidUnknownValues: false,
  });

  async transform(
    value: unknown,
    metadata: ArgumentMetadata,
  ): Promise<unknown> {
    // #1079 route-scoped pipe は handler の「全パラメータ」に適用される
    // (@nestjs/core router-execution-context の pipes.concat(paramPipes))。
    // このガードが無いと @CurrentUser() が返す RequestUser まで封筒として検証され、
    // `logs must be an array` で正常リクエストが常に 400 になる。
    // 標準 ValidationPipe が metadata.type === 'custom' をスキップするのと同じ流儀。
    if (metadata.type !== 'body') {
      return value;
    }

    // IsArray / ArrayMinSize(1) / ArrayMaxSize(100) はここで従来どおり 400 になる
    const envelope = (await this.envelopePipe.transform(value, {
      type: 'body',
      metatype: CreateFrontendLogBatchDto,
    })) as CreateFrontendLogBatchDto;

    const accepted: CreateFrontendLogDto[] = [];
    const rejected: RejectedFrontendLogSummary[] = [];

    for (const [index, raw] of envelope.logs.entries()) {
      // 非オブジェクト要素は class-validator が throw する（null の object.constructor 参照）か、
      // forbidUnknownValues: false だとエラー 0 件で素通りするため、明示的に弾く。
      if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
        rejected.push({
          index,
          fields: [REJECTED_ROOT_FIELD],
          constraints: ['isObject'],
        });
        continue;
      }

      // transform 維持: 単発エンドポイントと同じ変換規則(暗黙変換込み)を要素へ適用する
      const instance = plainToInstance(CreateFrontendLogDto, raw, {
        enableImplicitConversion: true,
      });

      const errors = await validate(instance, {
        // whitelist: 未知プロパティを instance から delete する（@ValidateNested を外した分の埋め合わせ）
        whitelist: true,
        forbidUnknownValues: true,
        // PII 保険: ValidationError に元オブジェクト・元値を載せさせない
        validationError: { target: false, value: false },
      });

      if (errors.length === 0) {
        accepted.push(instance);
      } else {
        rejected.push({
          index,
          fields: errors.map((e) => e.property).sort(),
          constraints: errors
            .flatMap((e) => Object.keys(e.constraints ?? {}))
            .sort(),
        });
      }
    }

    return { accepted, rejected } satisfies ValidatedFrontendLogBatch;
  }
}
