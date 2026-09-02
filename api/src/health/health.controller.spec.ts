import { HealthController } from './health.controller';

describe('HealthController', () => {
  const controller = new HealthController();

  it('returns ok with a timestamp from /health', () => {
    const result = controller.getHealth();

    expect(result.status).toBe('ok');
    expect(Number.isNaN(Date.parse(result.timestamp))).toBe(false);
  });

  // 外形監視が content matcher でこの形を見る。壊すと uptime check が
  // 「本文が期待と違う」で落ちるため、返り値の形を固定する。
  it('returns a dependency-free ok from /livez', () => {
    expect(controller.getLivez()).toEqual({ status: 'ok' });
  });
});
