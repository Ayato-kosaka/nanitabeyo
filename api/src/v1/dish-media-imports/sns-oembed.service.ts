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
// | Instagram | 埋め込み SSR `https://www.instagram.com/p/{code}/embed/captioned/` | **oEmbed ではなく埋め込みの SSR HTML** から取る（#1375 3 巡目で実測）。非ブラウザ UA（既定の `nanitabeyo/1.0`）に対してはサーバレンダリングされた HTML が返り、キャプション全文（店舗情報・ハッシュタグ込み）・サムネイル URL・投稿者名が入っている。Graph API の `instagram_oembed`（Meta 審査要）は、この経路が封じられたときの正規フォールバック候補として温存 | |

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
  // Instagram は oEmbed ではなく埋め込み SSR（下の INSTAGRAM_EMBED_* ）で取る
  instagram: null,
};

/**
 * Instagram の埋め込み SSR。**ホストは固定**で、パスへ入るのは
 * `parseSnsUrl` が正規表現で検証済みの shortcode だけ（SSRF は成立しない）。
 *
 * 実測（2026-08-23 / Cloud Run 相当の DC IP・既定 UA `nanitabeyo/1.0`）:
 * - `p` / `reel` どちらの shortcode でも 200 + SSR HTML（約 260 KiB）
 * - HTML に `class="Caption"`（キャプション全文）・`EmbeddedMediaImage`（scontent の
 *   サムネイル URL）・`UsernameText` が入る
 * - **ブラウザ UA だと JS シェル（600 KiB / SSR なし）が返る。** UA を既定から
 *   変えないこと（SafeFetch の「UA を詐称しない」とも整合する）
 */
const INSTAGRAM_EMBED_BASE = 'https://www.instagram.com';
/** SSR embed は約 260 KiB。既定の 256 KiB では**わずかに足りない**ので明示する */
const INSTAGRAM_EMBED_MAX_BYTES = 1024 * 1024;

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
    if (content.provider === 'instagram') {
      return this.fetchInstagramEmbedMetadata(content);
    }

    const endpoint = OEMBED_ENDPOINTS[content.provider];

    if (endpoint === null) {
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
   * Instagram の埋め込み SSR からメタデータを取る（#1375 3 巡目）。
   *
   * ## HTML は保存しない
   *
   * ここで受けた HTML から **caption / サムネイル URL / 投稿者名の 3 つだけ**を抽出して
   * すぐ捨てる。`html` を持ち回らない規律（#1273 §14）は oEmbed と同じ。
   *
   * ## SSR が返らなかったら «取れなかった» へ縮退する
   *
   * Instagram 側の UA 判定・レート制限・仕様変更で JS シェルが返ることがある。
   * その場合は Caption 要素が無いので `fetch_failed` として扱い、既存の
   * «候補ゼロ＋手入力へ縮退» にそのまま乗る（この画面の設計が最初からそうなっている）。
   */
  private async fetchInstagramEmbedMetadata(
    content: SnsUrlContent,
  ): Promise<SnsMetadataOutcome> {
    const embedUrl = `${INSTAGRAM_EMBED_BASE}/p/${content.externalContentId}/embed/captioned/`;

    let html: string;
    try {
      html = await this.safeFetch.fetchText(embedUrl, {
        apiName: API_NAMES.instagram,
        functionName: 'fetchInstagramEmbedMetadata',
        maxResponseBytes: INSTAGRAM_EMBED_MAX_BYTES,
      });
    } catch (error) {
      return this.classifyFailure(error, 'instagram');
    }

    const metadata = parseInstagramEmbedHtml(html);
    if (metadata === null) {
      // 200 だが SSR ではない（JS シェル / ログイン壁 / 仕様変更）。手入力へ縮退させる
      this.logger.warn('InstagramEmbedNotSsr', 'fetchInstagramEmbedMetadata', {
        htmlLength: html.length,
      });
      return {
        status: 'unknown',
        kind: 'fetch_failed',
        detail: { provider: 'instagram', reason: 'embed_not_ssr' },
      };
    }

    return {
      status: 'ok',
      metadata: {
        title: this.pickString(metadata.caption),
        authorName: this.pickString(metadata.username),
        authorUrl:
          metadata.username !== null
            ? this.pickHttpsUrl(
                `https://www.instagram.com/${encodeURIComponent(metadata.username)}/`,
              )
            : null,
        thumbnailUrl: this.pickHttpsUrl(metadata.thumbnailUrl),
      },
    };
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

/** `parseInstagramEmbedHtml` の戻り値。全フィールド «取れなければ null» */
export type InstagramEmbedFields = {
  caption: string | null;
  thumbnailUrl: string | null;
  username: string | null;
};

/** HTML エンティティのうち、embed SSR に実際に出るものだけを戻す */
const decodeHtmlEntities = (text: string): string =>
  text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'");

/**
 * Instagram 埋め込み SSR の HTML から caption / サムネイル / 投稿者名を抜く純関数。
 *
 * DOM パーサは使わない（依存を増やさない）。目印は埋め込みウィジェットが何年も
 * 使っている class 名（`Caption` / `EmbeddedMediaImage` / `UsernameText`）で、
 * どれも無ければ **SSR ではない**と判断して null を返す（呼び出し側が縮退する）。
 */
export function parseInstagramEmbedHtml(
  html: string,
): InstagramEmbedFields | null {
  const imageMatch =
    /<img[^>]*class="[^"]*EmbeddedMediaImage[^"]*"[^>]*src="([^"]+)"/.exec(
      html,
    ) ??
    /<img[^>]*src="([^"]+)"[^>]*class="[^"]*EmbeddedMediaImage[^"]*"/.exec(
      html,
    );
  const captionMatch = /<div class="Caption"[^>]*>([\s\S]*?)<\/div>/.exec(html);
  const usernameMatch = /class="UsernameText"[^>]*>([^<]+)</.exec(html);

  if (imageMatch === null && captionMatch === null && usernameMatch === null) {
    return null;
  }

  let caption: string | null = null;
  if (captionMatch !== null) {
    caption = decodeHtmlEntities(
      captionMatch[1].replace(/<br\s*\/?\s*>/gi, '\n').replace(/<[^>]+>/g, ' '),
    )
      .replace(/[ \t]+/g, ' ')
      .replace(/\s*\n\s*/g, '\n')
      .trim();
    if (caption.length === 0) caption = null;
  }

  return {
    caption,
    thumbnailUrl:
      imageMatch !== null ? decodeHtmlEntities(imageMatch[1]) : null,
    username:
      usernameMatch !== null
        ? decodeHtmlEntities(usernameMatch[1]).trim() || null
        : null,
  };
}
