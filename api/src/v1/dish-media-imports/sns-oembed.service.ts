// api/src/v1/dish-media-imports/sns-oembed.service.ts
//
// provider 公式 oEmbed からメタデータを取る（#1399 設計 §2 / 詳細 §6-1）。
//
// ## この層が守ること
//
// - **取得先は provider ごとにハードコードされた固定エンドポイントだけ。**
//   ユーザーの URL は**クエリパラメータの値としてしか渡らない**ので、この経路に
//   SSRF は原理的に成立しない。**この構造を崩さないこと**（「汎用 OGP フェッチャ」を
//   作った瞬間に穴になる）。
// - **それでもタイムアウトとサイズ上限は効かせる**（独立レビュー M-2）。SSRF が
//   成立しなくても、応答が返らなければ Cloud Run の同時実行スロットが埋まり、
//   無関係な API まで巻き添えで詰まる。だから `SafeFetchService` を通す。
// - **`html` を取り出さない・返さない・保存しない**（#1375 設計の正本 §2 / #1273 §14）。
//   provider の仕様変更に追随できなくなるため。埋め込みは `canonical_url` から
//   provider 別コンポーネントが組み立てる。
// - **例外を投げっぱなしにしない。** 失敗はすべて戻り値の `status` で表現する。
//   呼び出し側が «候補ゼロ＋理由» を返して手入力へ縮退できる形にするため。
//
// ## provider ごとの実測（設計 詳細 §6-1。この環境からは再実測していない）
//
// | provider | oEmbed | 取れるもの |
// | --- | --- | --- |
// | YouTube | `https://www.youtube.com/oembed`（無認証・200） | `title` / `author_name` / `author_url` / `thumbnail_url`。**`description` は返らない** |
// | TikTok | `https://www.tiktok.com/oembed`（無認証・200） | `title` に**キャプション＋ハッシュタグがそのまま**入る。3 provider で最も情報量が多い |
// | Instagram | Graph API の `instagram_oembed`。**Meta のアプリ審査が要る** | **叩かない。** 常に `unknown` へ縮退する |

import { Injectable } from '@nestjs/common';

import { AppLoggerService } from '../../core/logger/logger.service';
import { SafeFetchService } from '../../core/safe-fetch/safe-fetch.service';
import { SafeFetchError } from '../../core/safe-fetch/safe-fetch.types';
import type {
  SnsProvider,
  SnsUrlContent,
} from '../../../../shared/utils/snsUrl';

/** oEmbed から取れたもののうち、**保存せず**候補生成と確認画面の表示にだけ使う値 */
export type SnsMetadata = {
  title: string | null;
  authorName: string | null;
  authorUrl: string | null;
  thumbnailUrl: string | null;
};

export type SnsMetadataOutcome =
  | { status: 'ok'; metadata: SnsMetadata }
  /** 相手が消えた（400 / 404 / 410）。取り込みを続行させない */
  | { status: 'unavailable'; detail: Record<string, unknown> }
  /** こちらの都合で取れなかった。**取り込みは続行させてよい** */
  | {
      status: 'unknown';
      kind: 'provider_unsupported' | 'fetch_failed';
      detail: Record<string, unknown>;
    };

/**
 * provider ごとの固定エンドポイント。**ここに載っていない provider は叩かない。**
 *
 * `null` は「サーバから取れる公式のメタデータ経路が無い」の意味であって、
 * 「未実装」ではない（Instagram は審査が要るので当面取れない）。
 */
const OEMBED_ENDPOINTS: Readonly<Record<SnsProvider, string | null>> = {
  youtube: 'https://www.youtube.com/oembed',
  tiktok: 'https://www.tiktok.com/oembed',
  instagram: null,
};

/** `logger.externalApi` に出す名前 */
const API_NAMES: Readonly<Record<SnsProvider, string>> = {
  youtube: 'YouTube oEmbed',
  tiktok: 'TikTok oEmbed',
  instagram: 'Instagram oEmbed',
};

/**
 * 「相手が消えた」と判断する HTTP ステータス。
 *
 * YouTube は存在しない ID に **400** を返す（実測。404 ではない）。
 * TikTok も同様に 4xx を返すので、両方を `unavailable` に寄せる。
 */
const CONTENT_UNAVAILABLE_STATUSES = new Set([400, 403, 404, 410]);

/** 文字列フィールドの上限。provider が壊れた値を返したときに下流へ流さないための保険 */
const MAX_FIELD_LENGTH = 2_000;

@Injectable()
export class SnsOembedService {
  constructor(
    private readonly safeFetch: SafeFetchService,
    private readonly logger: AppLoggerService,
  ) {}

  /**
   * 投稿のメタデータを取る。**例外は投げない。**
   */
  async fetchMetadata(content: SnsUrlContent): Promise<SnsMetadataOutcome> {
    const endpoint = OEMBED_ENDPOINTS[content.provider];

    if (endpoint === null) {
      // Instagram。**取れない前提の縮退であって、失敗ではない。**
      this.logger.debug('SnsOembedSkipped', 'fetchMetadata', {
        provider: content.provider,
        reason: 'no_server_side_metadata_endpoint',
      });
      return {
        status: 'unknown',
        kind: 'provider_unsupported',
        detail: { provider: content.provider },
      };
    }

    const requestUrl = new URL(endpoint);
    requestUrl.searchParams.set('url', content.canonicalUrl);
    requestUrl.searchParams.set('format', 'json');

    try {
      const payload = await this.safeFetch.fetchJson<Record<string, unknown>>(
        requestUrl.href,
        {
          apiName: API_NAMES[content.provider],
          functionName: 'fetchMetadata',
        },
      );

      return { status: 'ok', metadata: this.pickMetadata(payload) };
    } catch (error) {
      return this.classifyFailure(error, content.provider);
    }
  }

  /**
   * oEmbed のレスポンスから**使うフィールドだけ**を取り出す。
   *
   * `html` は**意図的に読まない**。読まなければ、うっかり保存する経路も生まれない。
   */
  private pickMetadata(payload: Record<string, unknown>): SnsMetadata {
    return {
      title: this.pickString(payload.title),
      authorName: this.pickString(payload.author_name),
      authorUrl: this.pickHttpsUrl(payload.author_url),
      thumbnailUrl: this.pickHttpsUrl(payload.thumbnail_url),
    };
  }

  private pickString(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (trimmed.length === 0) return null;
    return trimmed.slice(0, MAX_FIELD_LENGTH);
  }

  /**
   * provider が返した URL も検証する（設計 §3-3「provider のレスポンスも信用しない」）。
   *
   * ここを通った値はレスポンスに載ってクライアントが表示に使うので、
   * `javascript:` / `data:` が混ざらないことだけは構造的に保証しておく。
   */
  private pickHttpsUrl(value: unknown): string | null {
    const text = this.pickString(value);
    if (text === null) return null;

    try {
      const url = new URL(text);
      if (url.protocol !== 'https:') return null;
      return url.href;
    } catch {
      return null;
    }
  }

  /**
   * 失敗を «相手が消えた» と «こちらの都合» に振り分ける（設計 §3-7）。
   *
   * **この 2 つを混ぜてはいけない。** 混ぜると、TikTok が一時的に落ちただけで
   * ユーザーが保存できなくなる。
   */
  private classifyFailure(
    error: unknown,
    provider: SnsProvider,
  ): SnsMetadataOutcome {
    if (error instanceof SafeFetchError) {
      const status =
        typeof error.detail?.status === 'number' ? error.detail.status : null;

      if (
        error.kind === 'unexpected_status' &&
        status !== null &&
        CONTENT_UNAVAILABLE_STATUSES.has(status)
      ) {
        this.logger.debug('SnsOembedUnavailable', 'fetchMetadata', {
          provider,
          status,
        });
        return { status: 'unavailable', detail: { provider, status } };
      }

      this.logger.warn('SnsOembedFailed', 'fetchMetadata', {
        provider,
        kind: error.kind,
        status,
      });
      return {
        status: 'unknown',
        kind: 'fetch_failed',
        detail: { provider, kind: error.kind, status },
      };
    }

    this.logger.warn('SnsOembedFailed', 'fetchMetadata', {
      provider,
      kind: 'unknown_error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
    return {
      status: 'unknown',
      kind: 'fetch_failed',
      detail: { provider, kind: 'unknown_error' },
    };
  }
}
