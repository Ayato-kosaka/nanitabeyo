// api/src/core/cookie-queue/cookie-queue.service.ts
//
// リクエストスコープで Set-Cookie ヘッダ用のクッキー情報をキューイングするサービス
//
// ■ 目的
// ──────────────────────────────────────────────
// 各ユースケース（Dish Media 等）で直接 Response オブジェクトを操作せず、
// 「クッキーを登録」するだけで最後に ResponseWrapInterceptor で一括反映する。
//
// ■ 利用例
// ──────────────────────────────────────────────
// ```ts
// this.cookieQueue.enqueue(
//   'Cloud-CDN-Cookie=value; Domain=.example.com; Path=/; Max-Age=600; HttpOnly; Secure; SameSite=None'
// );
// ```

import { Injectable, Scope } from '@nestjs/common';

/**
 * Set-Cookie 用のクッキー記述子
 */
export interface CookieDescriptor {
  /** Cookie 文字列（name=value; attr1=val1; attr2=val2 形式） */
  cookieString: string;
}

@Injectable()
export class CookieQueueService {
  private readonly cookies: Set<string> = new Set();

  /**
   * クッキー文字列をキューに登録（重複は自動排除）
   * @param cookieString - Set-Cookie ヘッダに設定する完全なクッキー文字列
   */
  enqueue(cookieString: string): void {
    this.cookies.add(cookieString);
  }

  /**
   * キューに登録されたクッキー文字列を配列で取得
   * @returns Set-Cookie ヘッダに設定するクッキー文字列の配列
   */
  getAll(): string[] {
    return Array.from(this.cookies);
  }

  /**
   * キューをクリア（テスト用）
   */
  clear(): void {
    this.cookies.clear();
  }
}
