import { RequestInit } from 'node-fetch';

export interface HttpRequestOptions extends RequestInit {
  /** URL（パスパラメータ直展開済み） */
  url: string;
  /** ms 単位タイムアウト */
  timeoutMs?: number;
  /** 自動リトライ回数 */
  retries?: number;
}

export interface HttpResponse<T = any> {
  status: number;
  headers: Record<string, string>;
  body: T;
}
