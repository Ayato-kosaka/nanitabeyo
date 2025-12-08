import { Module, Global } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { SupabaseJwtStrategy } from './jwt.strategy';
import { StaticMasterModule } from '../static-master/static-master.module';
import { PermissionGuard } from './auth.guard';

@Global()
@Module({
  imports: [
    PassportModule.register({ defaultStrategy: undefined }), // Guard 側で明示
    StaticMasterModule,
  ],
  providers: [SupabaseJwtStrategy, PermissionGuard],
  exports: [
    SupabaseJwtStrategy,
    PermissionGuard,
    // Guards & Decorator を外部で再利用
    // 直接 export しても良いが circular を避けたい場合は index.ts に再公開
  ],
})
export class AuthModule { }
