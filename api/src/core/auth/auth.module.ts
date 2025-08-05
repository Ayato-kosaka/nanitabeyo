import { Module, Global } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { JwtStrategy } from './jwt.strategy';

@Global()
@Module({
    imports: [
        PassportModule.register({ defaultStrategy: undefined }), // Guard 側で明示
    ],
    providers: [JwtStrategy],
    exports: [
        JwtStrategy,
        // Guards & Decorator を外部で再利用
        // 直接 export しても良いが circular を避けたい場合は index.ts に再公開
    ],
})
export class AuthModule { }
