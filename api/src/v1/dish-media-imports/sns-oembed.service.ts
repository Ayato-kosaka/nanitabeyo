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
  /**
   * #1641 投稿の説明文。**いまは YouTube だけが持つ。**
   *
   * YouTube の `title` は動画の題名で、店舗情報は説明文の側に書かれている。
   * Instagram / TikTok は `title` 自体がキャプション本文なので、こちらは null のままでよい。
   */
  description?: string | null;
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

/** YouTube の視聴ページ。**説明文（キャプション）は oEmbed では返らない**ので、ここから取る */
const YOUTUBE_WATCH_BASE = 'https://www.youtube.com';

/**
 * 視聴ページ HTML の読み込み上限。説明文は先頭寄りにあるが、
 * ページ全体は 1.5MB 前後あるので Instagram より大きく取る。
 */
const YOUTUBE_WATCH_MAX_BYTES = 3 * 1024 * 1024;

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

    if (content.provider === 'youtube') {
      return this.fetchYouTubeMetadata(content);
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
   * #1641 TikTok の短縮 URL を **公式 oEmbed だけで**投稿へ解決する。
   *
   * ## なぜリダイレクト追跡ではいけないのか
   *
   * 設計当初は `vt.tiktok.com/{code}` へ自分でアクセスして 301 を追う方式だった
   * （`expandShortlink`）。ところが **Cloud Run から `vt.tiktok.com` へは接続できない**。
   * dev の実ログ:
   *
   *     SnsShortlinkExpansionFailed { provider: "tiktok", kind: "network_error" }
   *     外部 API ログ: api_name="tiktok shortlink", status_code=0（応答なし）
   *
   * `network_error` はタイムアウトとは別で、**接続そのものが成立していない**。
   * 同じ URL は開発環境の curl からは 301 を返すので、TikTok 側が
   * このサーバの出口を弾いていると見られる。こちらから直せない。
   *
   * ## oEmbed は短縮 URL をそのまま受ける
   *
   * 実測: `https://www.tiktok.com/oembed?url=<短縮URL>` が 200 を返し、
   *
   * - `embed_product_id` … 動画 ID（＝ `externalContentId`）
   * - `author_url` … `https://www.tiktok.com/@{username}`
   * - `title` … **キャプション本文**（店舗情報込み）
   *
   * が得られる。**`www.tiktok.com` へは Cloud Run から到達できている**
   * （フル URL の取り込みは成功しており、店舗候補まで出ている）。
   * つまり 1 リクエストで «展開» と «キャプション取得» の両方が済む。
   */
  async resolveTikTokShortlink(
    expandUrl: string,
  ): Promise<SnsUrlContent | null> {
    const endpoint = OEMBED_ENDPOINTS.tiktok;
    if (endpoint === null) return null;

    const requestUrl = new URL(endpoint);
    requestUrl.searchParams.set('url', expandUrl);
    requestUrl.searchParams.set('format', 'json');

    let payload: Record<string, unknown>;
    try {
      payload = await this.safeFetch.fetchJson<Record<string, unknown>>(
        requestUrl.href,
        {
          apiName: API_NAMES.tiktok,
          functionName: 'resolveTikTokShortlink',
        },
      );
    } catch (error) {
      this.logger.warn('TikTokShortlinkOembedFailed', 'resolveTikTokShortlink', {
        kind: error instanceof SafeFetchError ? error.kind : 'unknown_error',
      });
      return null;
    }

    const videoId = this.pickString(payload.embed_product_id);
    const authorUrl = this.pickHttpsUrl(payload.author_url);
    if (videoId === null || authorUrl === null) return null;

    // 数字 ID 以外は組み立てない（provider のレスポンスも信用しない / 設計 §3-3）
    if (!/^[0-9]{1,32}$/.test(videoId)) return null;

    const username = authorUrl.split('/@')[1];
    if (username === undefined || !/^[A-Za-z0-9._]{1,64}$/.test(username)) {
      return null;
    }

    return {
      kind: 'content',
      provider: 'tiktok',
      externalContentId: videoId,
      canonicalUrl: `https://www.tiktok.com/@${username}/video/${videoId}`,
    };
  }

  /**
   * YouTube のメタデータを取る（#1641 オーナー報告「キャプションが取れてないので店が入らない」）。
   *
   * ## なぜ oEmbed だけでは足りないのか
   *
   * YouTube の oEmbed は **`description` を返さない**（このファイル冒頭の表のとおり）。
   * 返るのは動画の題名だけである。ところが店舗情報は **説明文**に書かれている。
   * 実測（`8KJDwppL0qg`）:
   *
   *     題名   : 【月島】1度食べたら戻れない！人生で1番飲める焼鳥！  ← 住所が無い
   *     説明文 : 店名：焼鶏ばんちょう / 住所：東京都中央区月島1-22-1 …  ← ここに在る
   *
   * 題名だけを候補生成へ渡していたため、「読み取れる情報はありませんでした」になり
   * **店舗が一件も出なかった**。
   *
   * ## だから視聴ページの HTML から説明文を取る
   *
   * Instagram の埋め込み SSR と同じ方式である（`fetchInstagramEmbedMetadata`）。
   * 題名・投稿者・サムネイルは公式 oEmbed から、説明文だけを HTML から取り、
   * **どちらが欠けても取り込みは続行させる**（候補ゼロで手入力へ縮退する既存の設計に乗る）。
   *
   * ⚠️ HTML は保存しない。説明文を組み立てたらすぐ捨てる（#1273 §14 と同じ規律）。
   */
  private async fetchYouTubeMetadata(
    content: SnsUrlContent,
  ): Promise<SnsMetadataOutcome> {
    // OEMBED_ENDPOINTS の型は provider ごとに null を許すが、youtube は必ず持つ
    const endpoint = OEMBED_ENDPOINTS.youtube;
    if (endpoint === null) {
      return {
        status: 'unknown',
        kind: 'provider_unsupported',
        detail: { provider: 'youtube' },
      };
    }
    const requestUrl = new URL(endpoint);
    requestUrl.searchParams.set('url', content.canonicalUrl);
    requestUrl.searchParams.set('format', 'json');

    let base: SnsMetadata;
    try {
      const payload = await this.safeFetch.fetchJson<Record<string, unknown>>(
        requestUrl.href,
        { apiName: API_NAMES.youtube, functionName: 'fetchYouTubeMetadata' },
      );
      base = this.pickMetadata(payload);
    } catch (error) {
      // oEmbed が «消えた» と言うなら、説明文を取りに行く意味も無い
      return this.classifyFailure(error, 'youtube');
    }

    const description = await this.fetchYouTubeDescription(
      content.externalContentId,
    );

    return { status: 'ok', metadata: { ...base, description } };
  }

  /**
   * 視聴ページから説明文を取り出す。**取れなければ null**（例外は投げない）。
   *
   * 説明文が取れないのは «こちらの都合» であって、取り込みを止める理由にはならない。
   */
  private async fetchYouTubeDescription(
    videoId: string,
  ): Promise<string | null> {
    const watchUrl = `${YOUTUBE_WATCH_BASE}/watch?v=${encodeURIComponent(videoId)}`;

    let html: string;
    try {
      html = await this.safeFetch.fetchText(watchUrl, {
        apiName: API_NAMES.youtube,
        functionName: 'fetchYouTubeDescription',
        maxResponseBytes: YOUTUBE_WATCH_MAX_BYTES,
      });
    } catch (error) {
      this.logger.warn(
        'YouTubeDescriptionFetchFailed',
        'fetchYouTubeDescription',
        { kind: error instanceof SafeFetchError ? error.kind : 'unknown_error' },
      );
      return null;
    }

    const description = parseYouTubeDescription(html);
    if (description === null) {
      /*
      200 だが説明文が見つからない（bot 判定・ログイン壁・仕様変更）。

      ⚠️ **どの鍵が在ったかを必ず残す。** 「ページは取れているのに鍵だけ違う」が
         実際に起きており（開発環境では取れて Cloud Run では取れなかった）、
         これが無いと HTML を手で覗くまで切り分けられない。
      */
      this.logger.warn('YouTubeDescriptionNotFound', 'fetchYouTubeDescription', {
        htmlLength: html.length,
        markersPresent: YOUTUBE_DESCRIPTION_STRATEGIES.filter(
          (strategy) => strategy.extract(html) !== null,
        ).map((strategy) => strategy.name),
        hasPlayerResponse: html.includes('ytInitialPlayerResponse'),
        hasInitialData: html.includes('ytInitialData'),
      });
      return null;
    }

    return this.pickString(description);
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


/**
 * #1641 YouTube の視聴ページ HTML から**説明文**を取り出す。
 *
 * ## 置き場所が 1 つではない
 *
 * YouTube が返す HTML は**環境によって別物**である。実測:
 *
 * | 取得元 | 説明文の在りか |
 * | --- | --- |
 * | 開発環境 | `expandableVideoDescriptionBodyRenderer.descriptionBodyText.runs[].text`（断片の配列） |
 * | Cloud Run | 上の鍵が**存在しない**（実ログ `YouTubeDescriptionNotFound` / htmlLength 1.1MB） |
 *
 * ページは取れているのに鍵だけが違う、という形だった。1 つの鍵に賭けると、
 * **こちらの環境では通るのに本番では取れない**という今回の状態になる。
 * そこで**知られている置き場所を順に試す**。
 *
 * ⚠️ 見つからなければ `null` を返す。**推測で組み立てない。**
 *    JS シェルやログイン壁が返ることがあり、そのときは «取れなかった» として扱う
 *    （呼び出し側は候補ゼロ → 手入力へ縮退する）。
 */
export function parseYouTubeDescription(html: string): string | null {
  for (const strategy of YOUTUBE_DESCRIPTION_STRATEGIES) {
    const description = strategy.extract(html);
    if (description !== null && description.trim().length > 0) {
      return description.trim();
    }
  }
  return null;
}

/**
 * 説明文の置き場所。**上から順に試す。**
 *
 * `name` は «どれで取れたか / どれも無かったか» をログへ出すために使う。
 * 置き場所が変わったとき、HTML を目視しなくても切り分けられるようにしておく。
 */
export const YOUTUBE_DESCRIPTION_STRATEGIES: {
  name: string;
  extract: (html: string) => string | null;
}[] = [
  {
    // 断片の配列（ハッシュタグやリンクが別 run に割れる）
    name: 'descriptionBodyText.runs',
    extract: (html) => {
      const marker =
        '"expandableVideoDescriptionBodyRenderer":{"descriptionBodyText":{"runs":[';
      const start = html.indexOf(marker);
      if (start === -1) return null;

      const from = start + marker.length;
      const end = findRunsArrayEnd(html, from);
      if (end === -1) return null;

      /*
      ⚠️ **`runs` の配列の中だけを読むこと。** ページ全体から `"text":"…"` を拾うと、
         プレイヤーのキーボードショートカット説明などの無関係な文言まで連結される
         （実装中に実際に混入させた）。
      */
      const texts: string[] = [];
      const pattern = /"text":"((?:[^"\\]|\\.)*)"/g;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(html.slice(from, end))) !== null) {
        try {
          texts.push(JSON.parse(`"${match[1]}"`) as string);
        } catch {
          // 壊れた断片は捨てる（推測で直さない）
        }
      }
      return texts.join('');
    },
  },
  {
    // `ytInitialPlayerResponse.videoDetails.shortDescription`。説明文が 1 本の文字列で入る
    name: 'videoDetails.shortDescription',
    extract: (html) => extractJsonString(html, '"shortDescription":"'),
  },
  {
    // 端末やロケールによってはこちらへ入る
    name: 'attributedDescription.content',
    extract: (html) =>
      extractJsonString(html, '"attributedDescription":{"content":"'),
  },
];

/**
 * `marker` の直後から始まる **JSON 文字列リテラル**を 1 つ読み出す。
 *
 * エスケープされた `\"` で終端を誤らないよう、素朴な `indexOf('"')` は使わない。
 */
function extractJsonString(html: string, marker: string): string | null {
  const start = html.indexOf(marker);
  if (start === -1) return null;

  const from = start + marker.length;
  let escaped = false;
  for (let i = from; i < html.length; i += 1) {
    const ch = html[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      try {
        return JSON.parse(`"${html.slice(from, i)}"`) as string;
      } catch {
        return null;
      }
    }
  }
  return null;
}

/**
 * `runs` 配列の閉じ `]` の位置を返す。見つからなければ -1。
 *
 * 文字列の中に現れる `[` `]` を数えないよう、**JSON の文字列リテラルを読み飛ばす**。
 */
function findRunsArrayEnd(html: string, from: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = from; i < html.length; i += 1) {
    const ch = html[i];

    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') inString = true;
    else if (ch === '[' || ch === '{') depth += 1;
    else if (ch === '}') depth -= 1;
    else if (ch === ']') {
      if (depth === 0) return i;
      depth -= 1;
    }
  }

  return -1;
}
