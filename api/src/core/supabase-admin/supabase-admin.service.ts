// api/src/core/supabase-admin/supabase-admin.service.ts
//
// #1511 ACC-01 アカウント削除
//
// Supabase Auth（GoTrue）の admin API を service_role 鍵で叩くための薄いクライアント。
//
// ## なぜ `@supabase/supabase-js` を入れないのか
// API 側にはこれまで `@supabase/supabase-js` の依存も `createClient` の呼び出しも無い
// （JWT の検証は SUPABASE_JWT_SECRET によるローカル検証で、Supabase サーバーへは 1 度も
// 通信していない）。ここで欲しいのは **admin API を 1 本叩くこと**だけなので、
// SDK を丸ごと持ち込むより素の fetch（Node 18+ のグローバル fetch）で足りる。
// 依存が増えないぶん、Cloud Run のイメージにも CI にも影響しない。
//
// ## 冪等性
// GoTrue の `DELETE /auth/v1/admin/users/:id` は、対象が既に存在しない場合 404 を返す。
// アカウント削除はリトライ可能でなければならない（DB 側の匿名化だけ成功して auth 削除が
// 落ちた、という状態から再実行で完了できる必要がある）ため、**404 は成功として扱う**。

import { Injectable } from '@nestjs/common';
import { env } from '../config/env';
import { AppLoggerService } from '../logger/logger.service';

/** admin API 呼び出しのタイムアウト（ms）。削除 API 全体がここで詰まるのを防ぐ */
const ADMIN_REQUEST_TIMEOUT_MS = 10_000;

/**
 * service_role 鍵が未設定のまま auth 削除を要求されたときに投げるエラー。
 *
 * 呼び出し側（users.service）はこれを握り潰さない。握り潰すと
 * 「削除したのに同じ資格情報でログインできる」状態を成功として返してしまう。
 */
export class SupabaseAdminNotConfiguredError extends Error {
  constructor() {
    super(
      'Supabase admin API is not configured: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are missing',
    );
    this.name = 'SupabaseAdminNotConfiguredError';
  }
}

@Injectable()
export class SupabaseAdminService {
  constructor(private readonly logger: AppLoggerService) {}

  /** service_role 鍵と URL が両方揃っているか（= auth 削除を実行できるか） */
  isConfigured(): boolean {
    return Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);
  }

  /**
   * Supabase Auth のユーザーを物理削除する。
   *
   * @param userId auth.users.id（= public.users.id と同じ UUID）
   * @throws SupabaseAdminNotConfiguredError 鍵が未設定のとき
   * @throws Error admin API が 2xx / 404 以外を返したとき
   */
  async deleteAuthUser(userId: string): Promise<void> {
    if (!this.isConfigured()) throw new SupabaseAdminNotConfiguredError();

    const url = `${env.SUPABASE_URL!.replace(/\/$/, '')}/auth/v1/admin/users/${userId}`;
    const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY!;

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      ADMIN_REQUEST_TIMEOUT_MS,
    );

    try {
      const response = await fetch(url, {
        method: 'DELETE',
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      });

      // 404 = 既に存在しない。再実行で完了できるようにするため成功として扱う（冪等）
      if (response.status === 404) {
        this.logger.log('SupabaseAuthUserAlreadyDeleted', 'deleteAuthUser', {
          userId,
        });
        return;
      }

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(
          `Supabase admin deleteUser failed: status=${response.status} body=${body.slice(0, 500)}`,
        );
      }

      this.logger.log('SupabaseAuthUserDeleted', 'deleteAuthUser', { userId });
    } catch (err) {
      this.logger.error('SupabaseAuthUserDeleteError', 'deleteAuthUser', {
        userId,
        error_message: (err as Error).message,
      });
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }
}
