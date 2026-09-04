// api/src/v1/share-links/create-share-link.dto.spec.ts
//
// #721 【バグ】`ValidationPipe({ whitelist: true })` は
// **デコレータが 1 つも付いていないプロパティを黙って削除する**。
//
// `ShareTargetDto.params` に `@IsObject()` が無かったため、正しいリクエストでも
// `params` が undefined のまま Service へ渡り、必ず
// `400 target.params.ids is required` になっていた。
//
// 型検査も通り、Service を直接呼ぶユニットテストも通るため、**HTTP を通さないと
// 気づけない**種類の不具合だった（ローカルへ実 DB を立てて curl して発見）。
// 同じ形の再発を防ぐため、DTO を «実際の ValidationPipe と同じ設定» で通す。

import { ValidationPipe } from '@nestjs/common';
import { CreateShareLinkDto } from '@shared/v1/dto';

/** main.ts の `useGlobalPipes` と同じ設定にすること（ここがずれると検知力が落ちる） */
const pipe = new ValidationPipe({
  transform: true,
  transformOptions: { enableImplicitConversion: true },
  whitelist: true,
  forbidUnknownValues: false,
});

const metadata = { type: 'body' as const, metatype: CreateShareLinkDto };

describe('#721 CreateShareLinkDto を ValidationPipe へ通す', () => {
  it('dish_media の params が whitelist で消えない', async () => {
    const result = (await pipe.transform(
      {
        target: {
          type: 'dish_media',
          params: { ids: ['44444444-4444-4444-8444-444444444444'] },
        },
        locale: 'ja-JP',
      },
      metadata,
    )) as CreateShareLinkDto;

    // ⚠️ ここが本題。`@IsObject()` を外すと params が undefined になる
    expect(result.target.params).toEqual({
      ids: ['44444444-4444-4444-8444-444444444444'],
    });
    expect(result.target.type).toBe('dish_media');
    expect(result.locale).toBe('ja-JP');
  });

  it('友達投票の params も消えない', async () => {
    const result = (await pipe.transform(
      {
        target: {
          type: 'dish_category_group_vote_sessions',
          params: { shareToken: 'abc123' },
        },
      },
      metadata,
    )) as CreateShareLinkDto;

    expect(result.target.params).toEqual({ shareToken: 'abc123' });
  });

  // #721 dev の実データには v5 の dish_media.id が混ざっている
  //（実測: 358cb297-da34-52b8-9960-ff217bef1044）。
  //
  // ⚠️ 現状 `ShareTargetDishMediaParamsDto` は **ValidationPipe から呼ばれていない**。
  // `ShareTargetDto.params` は `@IsObject()` だけなので、中身の検証は
  // `ShareLinkTargetResolvers` 側の責務になっている（DTO のコメント参照）。
  // つまり `@IsUUID("4")` は今は «実行されない罠» でしかなく、誰かが
  // params を `@ValidateNested()` で繋いだ瞬間に実在する投稿の共有が 400 になる。
  // 繋いでも壊れないことをここで固定しておく。
  it('v5 の UUID を含む ids でも通る（実データに v5 が存在する）', async () => {
    const ids = ['358cb297-da34-52b8-9960-ff217bef1044'];
    const result = (await pipe.transform(
      { target: { type: 'dish_media', params: { ids } }, locale: 'ja-JP' },
      metadata,
    )) as CreateShareLinkDto;

    expect(result.target.params).toEqual({ ids });
  });

  it('未知の target_type は弾く', async () => {
    await expect(
      pipe.transform({ target: { type: 'restaurants', params: {} } }, metadata),
    ).rejects.toThrow();
  });

  it('未知のロケールは弾く', async () => {
    await expect(
      pipe.transform(
        {
          target: { type: 'dish_media', params: { ids: ['x'] } },
          locale: 'xx-XX',
        },
        metadata,
      ),
    ).rejects.toThrow();
  });

  it('locale は省略できる（既定へ寄せる）', async () => {
    const result = (await pipe.transform(
      { target: { type: 'dish_media', params: { ids: ['x'] } } },
      metadata,
    )) as CreateShareLinkDto;

    expect(result.locale).toBeUndefined();
  });

  // クライアントから preview を渡せると、共有カードで別サービスを騙る phishing が作れる。
  // whitelist が «知らないプロパティ» を落とすことは、この DTO では正しい挙動
  it('preview を直接指定しようとしても落とされる', async () => {
    const result = (await pipe.transform(
      {
        target: { type: 'dish_media', params: { ids: ['x'] } },
        previewTitle: '銀行ログイン',
        previewImageUrl: 'https://evil.example/logo.png',
      },
      metadata,
    )) as unknown as Record<string, unknown>;

    expect(result.previewTitle).toBeUndefined();
    expect(result.previewImageUrl).toBeUndefined();
  });
});
