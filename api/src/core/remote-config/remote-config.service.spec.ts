// api/src/core/remote-config/remote-config.service.spec.ts
//
// #1764 Remote Config は Cloud Run の環境変数から読む。ここで守るのは 2 点だけ。
// 1. env 未設定でも既定値で動く（設定漏れで API が壊れない）
// 2. env に値があればそちらが勝つ（cloud-run-env-update.yml で変えた値が効く）

/**
 * env.ts は import された瞬間に process.env を検証・確定するため、
 * テストごとに素の状態から読み直せるよう isolateModules で組み立てる。
 */
const loadService = () => {
  let service: {
    getRemoteConfigValue(key: string): Promise<string>;
    getRemoteConfigValues(keys: string[]): Promise<string[]>;
  };
  jest.isolateModules(() => {
    const {
      RemoteConfigService,
      // eslint-disable-next-line @typescript-eslint/no-require-imports
    } = require('./remote-config.service');
    service = new RemoteConfigService();
  });
  return service!;
};

describe('RemoteConfigService (#1764)', () => {
  const KEY = 'dish_category_recommendation_weight_taste';

  afterEach(() => {
    delete process.env[KEY];
  });

  it('env が未設定なら既定値を返す', async () => {
    delete process.env[KEY];
    const service = loadService();
    await expect(service.getRemoteConfigValue(KEY)).resolves.toBe('5');
  });

  it('env に値があればそちらを返す', async () => {
    process.env[KEY] = '7.5';
    const service = loadService();
    await expect(service.getRemoteConfigValue(KEY)).resolves.toBe('7.5');
  });

  it('複数キーを一括で返す（順序は引数どおり）', async () => {
    delete process.env[KEY];
    const service = loadService();
    await expect(
      service.getRemoteConfigValues(['is_maintenance', KEY]),
    ).resolves.toEqual(['false', '5']);
  });
});
