// api/src/share/share-links.web-path.spec.ts
//
// #721 保存された target から «実在するパス» だけを作ることを固定する。
// ここが素通しになると、DB に入った文字列がそのまま遷移先になり Open Redirect になる。

jest.mock('src/core/config/env', () => ({
  env: { WEB_BASE_URL: 'https://app.nanitabeyo.net' },
}));

import {
  buildOpenInAppUrl,
  buildTargetWebPath,
  SHARE_PAGE_LABELS,
} from './share-links.web-path';
import { PUBLIC_LOCALES } from '@shared/v1/constants/publicLocales';

describe('#721 共有 target → Web パス', () => {
  describe('dish_media', () => {
    it('既存の /{locale}/posts?ids=... をそのまま使う', () => {
      // 新しい URL を作らないことで、既に共有済みのリンクと同じ画面へ着地する
      const path = buildTargetWebPath(
        'dish_media',
        'id-1',
        { ids: ['id-1', 'id-2'] },
        'ja-JP',
      );

      expect(path).toBe('/ja-JP/posts?ids=id-1%2Cid-2');
    });

    it('ids が壊れていても target_id 単体へ落ちる（空の遷移先を作らない）', () => {
      const path = buildTargetWebPath('dish_media', 'id-1', {}, 'en-US');

      expect(path).toBe('/en-US/posts?ids=id-1');
    });

    it('ids の中身を encode する', () => {
      // 作成時に UUID 検証しているが、保存後に手で書き換えられた行でも
      // クエリを抜けられないことを固定する
      const path = buildTargetWebPath(
        'dish_media',
        'x',
        { ids: ['a&b=c', '<script>'] },
        'ja-JP',
      );

      expect(path).not.toContain('&b=');
      expect(path).not.toContain('<script>');
    });
  });

  describe('dish_category_group_vote_sessions', () => {
    it('既存の投票画面 URL を作る', () => {
      const path = buildTargetWebPath(
        'dish_category_group_vote_sessions',
        'session-uuid',
        { shareToken: 'abc123' },
        'ja-JP',
      );

      expect(path).toBe('/ja-JP/search/dish-category-group-votes/abc123/vote');
    });

    it('shareToken が失われている行はホームへ落とす', () => {
      // session の UUID を URL へ出す方向へは倒さない（公開 URL に主キーを載せない方針）
      const path = buildTargetWebPath(
        'dish_category_group_vote_sessions',
        'session-uuid',
        {},
        'ko-KR',
      );

      expect(path).toBe('/ko-KR');
    });

    it('shareToken を encode する', () => {
      const path = buildTargetWebPath(
        'dish_category_group_vote_sessions',
        's',
        { shareToken: '../../evil' },
        'ja-JP',
      );

      // パスを遡られない
      expect(path).not.toContain('../');
    });
  });

  it('返すのは常に相対パスで、ホストを含まない', () => {
    // ホストを含められると、そのまま外部サイトへの遷移先になりうる
    for (const locale of PUBLIC_LOCALES) {
      const path = buildTargetWebPath(
        'dish_media',
        'id',
        { ids: ['id'] },
        locale,
      );
      expect(path.startsWith('/')).toBe(true);
      expect(path).not.toMatch(/^\/\//); // protocol-relative も作らない
      expect(path).not.toContain('://');
    }
  });

  describe('アプリで開く導線', () => {
    it('OIA relay 経由にする（iOS の同一サイト起点 UL 抑止を避けるため）', () => {
      const url = buildOpenInAppUrl(
        'https://app.nanitabeyo.net/ja-JP/posts?ids=a',
      );

      expect(url.startsWith('https://oia-relay.web.app/oia/open/?u=')).toBe(
        true,
      );
      // relay 側が origin を検証できるよう、URL 全体を encode して渡す
      expect(url).toContain(
        encodeURIComponent('https://app.nanitabeyo.net/ja-JP/posts?ids=a'),
      );
    });
  });

  it('導線ラベルが公開ロケール分そろっている', () => {
    // 1 つでも欠けると、そのロケールの共有ページだけボタンが undefined になる
    for (const locale of PUBLIC_LOCALES) {
      expect(SHARE_PAGE_LABELS[locale].openInApp).toBeTruthy();
      expect(SHARE_PAGE_LABELS[locale].openInWeb).toBeTruthy();
    }
  });
});
