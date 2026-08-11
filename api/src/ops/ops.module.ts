// api/src/ops/ops.module.ts
//
// Operational endpoints for controlled recovery and maintenance actions.
//

import { Module } from '@nestjs/common';
import { OpsResizeImageModule } from './resize-image/ops-resize-image.module';

@Module({
  imports: [OpsResizeImageModule],
})
export class OpsModule {}
