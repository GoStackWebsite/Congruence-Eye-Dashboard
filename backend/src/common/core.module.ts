import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuditService } from '../modules/audit/audit.service';
import { EdgeDevicesService } from '../modules/edge-devices/edge-devices.service';
import { SettingsService } from '../modules/settings/settings.service';
import { UsersService } from '../modules/users/users.service';
import { SnapshotsService } from '../modules/media/snapshots.service';
import { EventBusService } from './event-bus.service';
import { ApiKeyGuard } from './guards/api-key.guard';
import { AuthGuard } from './guards/auth.guard';
import { JwtOrApiKeyGuard } from './guards/jwt-or-api-key.guard';
import { LookupService } from './lookup.service';
import { StoreScopeService } from './store-scope.service';

export const jwtSecret = () => process.env.JWT_SECRET || 'congruence-eye-dev-secret-change-me';

const shared = [
  StoreScopeService, LookupService, SettingsService, AuditService, EventBusService, UsersService, EdgeDevicesService,
  AuthGuard, ApiKeyGuard, JwtOrApiKeyGuard, SnapshotsService,
];

@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      global: true,
      useFactory: () => ({ secret: jwtSecret(), signOptions: { expiresIn: (process.env.JWT_EXPIRES_IN || '12h') as never } }),
    }),
  ],
  providers: shared,
  exports: shared,
})
export class CoreModule {}
