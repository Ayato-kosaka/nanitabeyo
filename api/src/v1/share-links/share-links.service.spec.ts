// api/src/v1/share-links/share-links.service.spec.ts
//
// #721 共有リンクの作成・解決で守りたい不変条件を固定する。

jest.mock('src/core/config/env', () => ({
  env: { WEB_BASE_URL: 'https://app.nanitabeyo.net' },
}));

import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ShareLinksService } from './share-links.service';
import { ShareLinksRepository } from './share-links.repository';
import { ShareLinkTargetResolvers } from './share-links.resolvers';
import { AppLoggerService } from '../../core/logger/logger.service';
import { toShareTokenDigest } from './share-links.token';

const RESOLVED = {
  targetId: 'dish-media-1',
  targetParams: { ids: ['dish-media-1', 'dish-media-2'] },
  previewTitle: '唐揚げ定食 - からあげ食堂',
  previewDescription: 'からあげ食堂 の 唐揚げ定食。',
  previewImagePath: 'production/dish_media/thumb.jpg',
};

const activeRecord = (overrides: Record<string, unknown> = {}) => ({
  id: 'share-link-1',
  schema_version: 1,
  target_type: 'dish_media',
  target_id: 'dish-media-1',
  target_params: { ids: ['dish-media-1'] },
  preview_locale: 'ja-JP',
  preview_title: 't',
  preview_description: 'd',
  preview_image_path: 'p',
  status: 'active',
  expires_at: null,
  ...overrides,
});

describe('ShareLinksService', () => {
  let service: ShareLinksService;
  let repository: { create: jest.Mock; findByTokenDigest: jest.Mock };
  let resolvers: { resolve: jest.Mock };

  beforeEach(async () => {
    repository = {
      create: jest.fn().mockResolvedValue({ id: 'share-link-1' }),
      findByTokenDigest: jest.fn(),
    };
    resolvers = { resolve: jest.fn().mockResolvedValue(RESOLVED) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ShareLinksService,
        { provide: ShareLinksRepository, useValue: repository },
        { provide: ShareLinkTargetResolvers, useValue: resolvers },
        {
          provide: AppLoggerService,
          useValue: { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
        },
      ],
    }).compile();

    service = module.get(ShareLinksService);
  });

  describe('create', () => {
    it('共有 URL を組み立てて返す（クライアントに組み立てさせない）', () => {
      // 組み立てが app 側にもあると、development で作ったリンクが本番ドメインを指す形でずれる
      return service
        .create({ target: { type: 'dish_media', params: { ids: ['a'] } } } as never, 'user-1')
        .then((result) => {
          expect(result.url).toBe(`https://app.nanitabeyo.net/s/${result.token}`);
          expect(result.token.startsWith('s1_')).toBe(true);
        });
    });

    it('DB へ保存するのは digest だけで、生トークンは渡さない', async () => {
      const result = await service.create(
        { target: { type: 'dish_media', params: { ids: ['a'] } } } as never,
        'user-1',
      );

      const saved = repository.create.mock.calls[0][0];
      expect(saved.tokenDigest).toEqual(toShareTokenDigest(result.token));
      expect(JSON.stringify(saved)).not.toContain(result.token);
    });

    // #721 の設計判断。SNS は URL 単位で OGP をキャッシュするため、
    // 同じ URL が閲覧者ごとに別の OGP を返す設計は成立しない
    it('locale は共有時点で固定して保存する', async () => {
      await service.create(
        { target: { type: 'dish_media', params: { ids: ['a'] } }, locale: 'en-US' } as never,
        'user-1',
      );

      expect(resolvers.resolve).toHaveBeenCalledWith('dish_media', { ids: ['a'] }, 'en-US');
      expect(repository.create.mock.calls[0][0].previewLocale).toBe('en-US');
    });

    it('locale 未指定なら既定（ja-JP）で固定する', async () => {
      await service.create({ target: { type: 'dish_media', params: { ids: ['a'] } } } as never, null);

      expect(repository.create.mock.calls[0][0].previewLocale).toBe('ja-JP');
    });

    it('preview はサーバ側 Resolver の値だけを保存する', async () => {
      // クライアントから任意の title / image を保存できると、共有カードで
      // 別サービスを騙る phishing が作れてしまう
      await service.create(
        {
          target: { type: 'dish_media', params: { ids: ['a'] } },
          // DTO の whitelist で落ちるが、万一通っても採用されないことを見る
          previewTitle: '銀行ログイン',
        } as never,
        'user-1',
      );

      const saved = repository.create.mock.calls[0][0];
      expect(saved.previewTitle).toBe(RESOLVED.previewTitle);
      expect(saved.previewImagePath).toBe(RESOLVED.previewImagePath);
    });

    it('token_digest が衝突したら引き直す（500 にしない）', async () => {
      const conflict = Object.assign(new Error('unique'), { code: 'P2002' });
      repository.create.mockRejectedValueOnce(conflict).mockResolvedValue({ id: 'share-link-1' });

      const result = await service.create(
        { target: { type: 'dish_media', params: { ids: ['a'] } } } as never,
        null,
      );

      expect(repository.create).toHaveBeenCalledTimes(2);
      expect(result.token).toBeTruthy();
    });

    it('UNIQUE 以外のエラーは握り潰さない', async () => {
      repository.create.mockRejectedValue(new Error('connection lost'));

      await expect(
        service.create({ target: { type: 'dish_media', params: { ids: ['a'] } } } as never, null),
      ).rejects.toThrow('connection lost');
    });
  });

  describe('findActiveByToken', () => {
    it('有効なリンクを返す', async () => {
      repository.findByTokenDigest.mockResolvedValue(activeRecord());

      await expect(service.findActiveByToken('s1_0123456789abcdefghijkl')).resolves.toMatchObject({
        id: 'share-link-1',
      });
    });

    // ⚠️ 「形が不正」「存在しない」「revoked」「期限切れ」を呼び出し側から区別させない。
    // 区別できると、総当たりで「存在はする token」を絞り込めてしまう
    it.each([
      ['形が不正', 'not-a-token', null],
      ['存在しない', 's1_0123456789abcdefghijkl', null],
      ['revoked', 's1_0123456789abcdefghijkl', activeRecord({ status: 'revoked' })],
      [
        '期限切れ',
        's1_0123456789abcdefghijkl',
        activeRecord({ expires_at: new Date(Date.now() - 1000) }),
      ],
    ])('%s → すべて null を返す', async (_label, token, record) => {
      repository.findByTokenDigest.mockResolvedValue(record);

      await expect(service.findActiveByToken(token)).resolves.toBeNull();
    });

    it('形が不正なら DB を引かない', async () => {
      // `/s/<任意の文字列>` を投げ続けるだけでクエリを撃たせられる状態にしない
      await service.findActiveByToken('../../etc/passwd');

      expect(repository.findByTokenDigest).not.toHaveBeenCalled();
    });

    it('期限内なら有効', async () => {
      repository.findByTokenDigest.mockResolvedValue(
        activeRecord({ expires_at: new Date(Date.now() + 60_000) }),
      );

      await expect(service.findActiveByToken('s1_0123456789abcdefghijkl')).resolves.not.toBeNull();
    });
  });

  describe('resolveForApp', () => {
    it('target の型・ID・params を返す（遷移先の path は返さない）', async () => {
      // サーバが返した文字列をそのまま router.push させると、
      // サーバ側の不備がそのままアプリ内の任意遷移になる
      repository.findByTokenDigest.mockResolvedValue(activeRecord());

      const result = await service.resolveForApp('s1_0123456789abcdefghijkl');

      expect(result).toEqual({
        schemaVersion: 1,
        target: { type: 'dish_media', id: 'dish-media-1', params: { ids: ['dish-media-1'] } },
      });
      expect(JSON.stringify(result)).not.toContain('/posts');
    });

    it('無効なら 404', async () => {
      repository.findByTokenDigest.mockResolvedValue(activeRecord({ status: 'revoked' }));

      await expect(service.resolveForApp('s1_0123456789abcdefghijkl')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
