// api/src/core/safe-fetch/ip-guard.spec.ts
//
// #1399 SSRF ガードの中核。**ここが抜けると、ホスト名の allowlist を通した後で
// DNS rebinding によりループバックやメタデータサーバへ到達される。**

import {
  classifyIpAddress,
  isBlockedIpAddress,
  parseIpAddress,
} from './ip-guard';

describe('parseIpAddress', () => {
  it('IPv4 をバイト列にする', () => {
    expect(parseIpAddress('93.184.216.34')).toEqual({
      family: 4,
      bytes: [93, 184, 216, 34],
    });
  });

  it('先頭 0 埋めの IPv4 は 8 進数と解釈されうるので受け付けない', () => {
    // `010.0.0.1` を 10.0.0.1 と読むか 8.0.0.1 と読むかは実装依存。
    // 「解釈が割れる入力は通さない」に倒す
    expect(parseIpAddress('010.0.0.1')).toBeNull();
  });

  it('IPv6 の `::` 省略を展開する', () => {
    const parsed = parseIpAddress('::1');
    expect(parsed?.family).toBe(6);
    expect(parsed?.bytes).toEqual([
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1,
    ]);
  });

  it('IPv6 に埋め込まれた IPv4 記法を読む', () => {
    const parsed = parseIpAddress('::ffff:127.0.0.1');
    expect(parsed?.bytes.slice(10)).toEqual([0xff, 0xff, 127, 0, 0, 1]);
  });

  it('ゾーン ID を無視する', () => {
    expect(parseIpAddress('fe80::1%eth0')?.family).toBe(6);
  });

  it('ホスト名や壊れた文字列は null', () => {
    expect(parseIpAddress('www.tiktok.com')).toBeNull();
    expect(parseIpAddress('1.2.3')).toBeNull();
    expect(parseIpAddress('1.2.3.4.5')).toBeNull();
    expect(parseIpAddress('256.0.0.1')).toBeNull();
    expect(parseIpAddress('::1::2')).toBeNull();
    expect(parseIpAddress('')).toBeNull();
    expect(parseIpAddress(null)).toBeNull();
  });
});

describe('classifyIpAddress — 拒否するもの', () => {
  const cases: [string, string][] = [
    ['0.0.0.0', 'unspecified'],
    ['10.1.2.3', 'private'],
    ['100.64.0.1', 'carrier-grade-nat'],
    ['127.0.0.1', 'loopback'],
    ['127.255.255.254', 'loopback'],
    // クラウドのメタデータサーバ。#1399 が名指しで塞げと言っているもの
    ['169.254.169.254', 'cloud-metadata'],
    ['169.254.170.2', 'cloud-metadata'],
    ['172.16.0.1', 'private'],
    ['172.31.255.255', 'private'],
    ['192.0.0.1', 'ietf-protocol'],
    ['192.168.1.1', 'private'],
    ['198.18.0.1', 'benchmark'],
    ['224.0.0.1', 'multicast'],
    ['255.255.255.255', 'reserved'],
    // IPv6
    ['::', 'unspecified'],
    ['::1', 'loopback'],
    ['::ffff:127.0.0.1', 'ipv4-mapped'],
    ['::ffff:8.8.8.8', 'ipv4-mapped'],
    ['::7f00:1', 'ipv4-compatible'],
    // DNS64 環境で 127.0.0.1 に化ける（独立レビュー m-1）
    ['64:ff9b::7f00:1', 'nat64'],
    // 6to4。IPv4 の 127.0.0.1 が埋め込まれている
    ['2002:7f00:0001::', '6to4'],
    ['fc00::1', 'unique-local'],
    ['fd00::1', 'unique-local'],
    ['fe80::1', 'link-local'],
    ['fec0::1', 'site-local'],
    ['ff02::1', 'multicast'],
  ];

  it.each(cases)('%s を拒否する（%s）', (address, reason) => {
    expect(classifyIpAddress(address)).toBe(reason);
    expect(isBlockedIpAddress(address)).toBe(true);
  });
});

describe('classifyIpAddress — 通すもの', () => {
  const cases = [
    '93.184.216.34', // example.com
    '8.8.8.8',
    '1.1.1.1',
    '172.15.255.255', // 172.16/12 の 1 つ手前
    '172.32.0.1', // 172.16/12 の 1 つ後ろ
    '100.63.255.255', // 100.64/10 の 1 つ手前
    '169.253.255.255', // 169.254/16 の 1 つ手前
    '198.20.0.1', // 198.18/15 の外
    '223.255.255.255', // 224/4 の 1 つ手前
    '2606:4700::6810:85e5', // Cloudflare
    '2001:4860:4860::8888', // Google DNS
  ];

  it.each(cases)('%s を通す', (address) => {
    expect(classifyIpAddress(address)).toBeNull();
    expect(isBlockedIpAddress(address)).toBe(false);
  });
});

describe('classifyIpAddress — 読めない入力', () => {
  it('パースできない文字列は「安全と証明できない」ので拒否する', () => {
    // 「読めなかったから通す」はガードとして成立しない
    expect(classifyIpAddress('not-an-ip')).toBe('unparsable');
    expect(classifyIpAddress(undefined)).toBe('unparsable');
  });
});
