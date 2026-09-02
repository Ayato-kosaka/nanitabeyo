// api/src/core/safe-fetch/ip-guard.ts
//
// 「この IP アドレスへ接続してよいか」だけを判定する純粋関数。
//
// #1399 の SSRF ガードの心臓部。**ホスト名ではなく、名前解決した結果の IP を見る。**
// ホスト名だけを allowlist で見る実装は DNS rebinding（攻撃者が自分のドメインの A レコードを
// 127.0.0.1 や 169.254.169.254 に向ける）で素通しされるため、ここが最後の砦になる。
//
// ## 設計上の約束
//
// - **判定関数は 1 つに閉じる**（独立レビュー m-1）。用途ごとに別の判定を書き足さない。
// - **拒否リスト方式で漏れなく**。IPv4 だけ潰して IPv6 を忘れると、DNS64 / 6to4 経由で
//   ループバックへ到達される（`64:ff9b::7f00:1` / `2002:7f00:0001::`）。
// - **ライブラリを増やさない。** `api/package.json` に `ipaddr.js` を足すほどの規模ではなく、
//   ここでやるのはプレフィクス比較だけなので自前で持つ（依存を足す方がレビュー負荷が高い）。
// - **迷ったら拒否する。** パースできない文字列は「安全と証明できない」ので拒否側に倒す。

/** 判定できた IP アドレス。`bytes` はネットワークバイトオーダ（v4 は 4 / v6 は 16 バイト） */
export type ParsedIpAddress = {
  family: 4 | 6;
  bytes: number[];
};

/** なぜ拒否したか。ログとテストの両方で使う */
export type BlockedIpReason =
  | 'unparsable'
  | 'unspecified'
  | 'loopback'
  | 'private'
  | 'carrier-grade-nat'
  | 'link-local'
  | 'cloud-metadata'
  | 'ietf-protocol'
  | 'benchmark'
  | 'documentation'
  | 'multicast'
  | 'reserved'
  | 'unique-local'
  | 'site-local'
  | 'ipv4-mapped'
  | 'ipv4-compatible'
  | 'nat64'
  | '6to4'
  | 'discard';

type BlockRule = {
  /** プレフィクスのバイト列 */
  prefix: number[];
  /** プレフィクス長（ビット） */
  length: number;
  reason: BlockedIpReason;
};

/**
 * IPv4 の拒否レンジ。
 *
 * `169.254.0.0/16` は **リンクローカル全体**を落とすので、GCP / AWS のメタデータサーバ
 * `169.254.169.254` もここで落ちる。メタデータだけを個別に列挙する実装にしないのは、
 * 同じレンジに `169.254.170.2`（ECS task metadata）のような別の入口があるためである。
 */
const BLOCKED_IPV4_RULES: readonly BlockRule[] = [
  { prefix: [0, 0, 0, 0], length: 8, reason: 'unspecified' },
  { prefix: [10, 0, 0, 0], length: 8, reason: 'private' },
  { prefix: [100, 64, 0, 0], length: 10, reason: 'carrier-grade-nat' },
  { prefix: [127, 0, 0, 0], length: 8, reason: 'loopback' },
  // 169.254.169.254（クラウドのメタデータサーバ）を含む
  { prefix: [169, 254, 0, 0], length: 16, reason: 'cloud-metadata' },
  { prefix: [172, 16, 0, 0], length: 12, reason: 'private' },
  { prefix: [192, 0, 0, 0], length: 24, reason: 'ietf-protocol' },
  { prefix: [192, 0, 2, 0], length: 24, reason: 'documentation' },
  { prefix: [192, 168, 0, 0], length: 16, reason: 'private' },
  { prefix: [198, 18, 0, 0], length: 15, reason: 'benchmark' },
  { prefix: [198, 51, 100, 0], length: 24, reason: 'documentation' },
  { prefix: [203, 0, 113, 0], length: 24, reason: 'documentation' },
  { prefix: [224, 0, 0, 0], length: 4, reason: 'multicast' },
  // 240/4。255.255.255.255（ブロードキャスト）もここに含まれる
  { prefix: [240, 0, 0, 0], length: 4, reason: 'reserved' },
];

/** 16 進 4 桁のグループ列からバイト列を作る（ルール定義を読みやすくするためだけの補助） */
function v6(...groups: number[]): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < 8; i += 1) {
    const group = groups[i] ?? 0;
    bytes.push((group >> 8) & 0xff, group & 0xff);
  }
  return bytes;
}

/**
 * IPv6 の拒否レンジ。
 *
 * 独立レビュー m-1 が挙げた抜け（NAT64 / 6to4 / IPv4-compatible / サイトローカル /
 * マルチキャスト）をすべて含む。**IPv4 射影 `::ffff:0:0/96` は丸ごと拒否する** —
 * 正規の外部ホストがこの形で返ることは無く、「射影の中身を IPv4 として再検証する」実装は
 * 分岐が増えるだけで安全にならない。
 */
const BLOCKED_IPV6_RULES: readonly BlockRule[] = [
  { prefix: v6(), length: 128, reason: 'unspecified' },
  { prefix: [...v6().slice(0, 15), 1], length: 128, reason: 'loopback' },
  // ::/96（IPv4-compatible、非推奨だが名前解決自体はされうる）
  { prefix: v6(), length: 96, reason: 'ipv4-compatible' },
  // ::ffff:0:0/96（IPv4 射影）
  { prefix: v6(0, 0, 0, 0, 0, 0xffff), length: 96, reason: 'ipv4-mapped' },
  // 64:ff9b::/96 と 64:ff9b:1::/48（NAT64。DNS64 環境で 127.0.0.1 に化ける）
  { prefix: v6(0x0064, 0xff9b), length: 96, reason: 'nat64' },
  { prefix: v6(0x0064, 0xff9b, 0x0001), length: 48, reason: 'nat64' },
  // 100::/64（discard-only）
  { prefix: v6(0x0100), length: 64, reason: 'discard' },
  // 2001:db8::/32（ドキュメント用）
  { prefix: v6(0x2001, 0x0db8), length: 32, reason: 'documentation' },
  // 2002::/16（6to4。IPv4 アドレスが埋め込まれる）
  { prefix: v6(0x2002), length: 16, reason: '6to4' },
  // fc00::/7（ユニークローカル）
  { prefix: v6(0xfc00), length: 7, reason: 'unique-local' },
  // fe80::/10（リンクローカル）
  { prefix: v6(0xfe80), length: 10, reason: 'link-local' },
  // fec0::/10（サイトローカル。非推奨だが解決はする）
  { prefix: v6(0xfec0), length: 10, reason: 'site-local' },
  // ff00::/8（マルチキャスト）
  { prefix: v6(0xff00), length: 8, reason: 'multicast' },
];

/** `bytes` が `rule` のプレフィクスに含まれるか */
function matchesPrefix(bytes: readonly number[], rule: BlockRule): boolean {
  const fullBytes = rule.length >> 3;
  for (let i = 0; i < fullBytes; i += 1) {
    if (bytes[i] !== rule.prefix[i]) return false;
  }

  const remainingBits = rule.length & 7;
  if (remainingBits === 0) return true;

  const mask = (0xff << (8 - remainingBits)) & 0xff;
  return (bytes[fullBytes] & mask) === (rule.prefix[fullBytes] & mask);
}

/** `1.2.3.4` 形式。**先頭 0 埋め（`010.0.0.1`）は 8 進数と解釈されうるので拒否する。** */
function parseIpv4(text: string): number[] | null {
  const parts = text.split('.');
  if (parts.length !== 4) return null;

  const bytes: number[] = [];
  for (const part of parts) {
    if (!/^[0-9]{1,3}$/.test(part)) return null;
    if (part.length > 1 && part[0] === '0') return null;

    const value = Number.parseInt(part, 10);
    if (value > 255) return null;
    bytes.push(value);
  }
  return bytes;
}

/** IPv6。`::` の省略と、末尾に IPv4 が埋まった形（`::ffff:127.0.0.1`）を受ける。 */
function parseIpv6(text: string): number[] | null {
  // ゾーン ID（`fe80::1%eth0`）は照合の邪魔にしかならないので落とす
  const zoneless = text.split('%')[0];
  if (zoneless.length === 0) return null;

  const doubleColonCount = (zoneless.match(/::/g) ?? []).length;
  if (doubleColonCount > 1) return null;

  const [headText, tailText] =
    doubleColonCount === 1 ? zoneless.split('::') : [zoneless, null];

  const parseGroups = (segment: string): number[] | null => {
    if (segment.length === 0) return [];

    const groups: number[] = [];
    const parts = segment.split(':');
    for (let i = 0; i < parts.length; i += 1) {
      const part = parts[i];

      // 末尾だけ IPv4 記法を許す
      if (part.includes('.')) {
        if (i !== parts.length - 1) return null;
        const v4Bytes = parseIpv4(part);
        if (v4Bytes === null) return null;
        groups.push(v4Bytes[0], v4Bytes[1], v4Bytes[2], v4Bytes[3]);
        continue;
      }

      if (!/^[0-9a-fA-F]{1,4}$/.test(part)) return null;
      const value = Number.parseInt(part, 16);
      groups.push((value >> 8) & 0xff, value & 0xff);
    }
    return groups;
  };

  const head = parseGroups(headText);
  if (head === null) return null;

  if (tailText === null) {
    return head.length === 16 ? head : null;
  }

  const tail = parseGroups(tailText);
  if (tail === null) return null;
  if (head.length + tail.length > 14) return null; // `::` は最低 1 グループ分を埋める

  const zeros = new Array<number>(16 - head.length - tail.length).fill(0);
  return [...head, ...zeros, ...tail];
}

/**
 * IP アドレス文字列を解釈する。解釈できなければ `null`。
 *
 * `dns.lookup()` が返す `address` を渡す想定なので、ホスト名は受けない。
 */
export function parseIpAddress(
  text: string | null | undefined,
): ParsedIpAddress | null {
  if (typeof text !== 'string' || text.length === 0) return null;

  if (text.includes(':')) {
    const bytes = parseIpv6(text);
    return bytes === null ? null : { family: 6, bytes };
  }

  const bytes = parseIpv4(text);
  return bytes === null ? null : { family: 4, bytes };
}

/**
 * この IP へ接続してよいか。**拒否のときだけ理由を返す。**
 *
 * パースできない文字列は `unparsable` として**拒否**する。「読めなかったから通す」は
 * ガードとして成立しない。
 */
export function classifyIpAddress(
  text: string | null | undefined,
): BlockedIpReason | null {
  const parsed = parseIpAddress(text);
  if (parsed === null) return 'unparsable';

  const rules = parsed.family === 4 ? BLOCKED_IPV4_RULES : BLOCKED_IPV6_RULES;
  for (const rule of rules) {
    if (matchesPrefix(parsed.bytes, rule)) return rule.reason;
  }
  return null;
}

/** `classifyIpAddress` の真偽版 */
export function isBlockedIpAddress(text: string | null | undefined): boolean {
  return classifyIpAddress(text) !== null;
}
