import { Module } from '@nestjs/common';
import { AuditController } from './audit/audit.controller';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { EdgeDevicesController } from './edge-devices/edge-devices.controller';
import { HealthController } from './health/health.controller';
import { SettingsController } from './settings/settings.controller';
import { UploadsController } from './uploads/uploads.controller';
import { UsersController } from './users/users.controller';

/** Controllers whose services live in the global CoreModule. */
@Module({
  controllers: [HealthController, AuthController, UsersController, EdgeDevicesController, SettingsController, AuditController, UploadsController],
  providers: [AuthService],
})
export class PlatformModule {}
