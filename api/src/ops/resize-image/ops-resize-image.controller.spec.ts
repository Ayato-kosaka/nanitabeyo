import 'reflect-metadata';
import { PATH_METADATA } from '@nestjs/common/constants';
import { PERMISSIONS_KEY } from '../../core/auth/auth.constants';
import { OpsResizeImageController } from './ops-resize-image.controller';

describe('OpsResizeImageController', () => {
  it('exposes the re-enqueue operation under the ops route', () => {
    expect(Reflect.getMetadata(PATH_METADATA, OpsResizeImageController)).toBe(
      'ops/resize-image',
    );
    expect(
      Reflect.getMetadata(
        PATH_METADATA,
        OpsResizeImageController.prototype.reEnqueue,
      ),
    ).toBe('re-enqueue');
  });

  it('requires the ops-specific permission', () => {
    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        OpsResizeImageController.prototype.reEnqueue,
      ),
    ).toEqual(['ops.image-resize.re-enqueue']);
  });
});
