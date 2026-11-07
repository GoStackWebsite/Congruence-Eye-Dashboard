import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { DataSource } from 'typeorm';
import { AuthUser } from '../../common/roles';
import { AuditService } from '../audit/audit.service';
import { User } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    private readonly ds: DataSource,
  ) {}

  async login(email: string, password: string) {
    const u = await this.users.findByEmail(email);
    if (!u || !u.isActive || !(await bcrypt.compare(password, u.passwordHash))) {
      throw new UnauthorizedException('Invalid email or password');
    }
    const accessToken = await this.jwt.signAsync({ sub: u.id, email: u.email, role: u.role });
    await this.audit.record({ id: u.id, name: u.name }, 'LOGIN', 'auth', u.id);
    return { accessToken, user: await this.users.view(u.id) };
  }

  async changePassword(user: AuthUser, current: string, next: string) {
    const repo = this.ds.getRepository(User);
    const u = await repo.findOne({ where: { id: user.id } });
    if (!u || !(await bcrypt.compare(current, u.passwordHash))) throw new BadRequestException('Current password is incorrect');
    u.passwordHash = await bcrypt.hash(next, 10);
    await repo.save(u);
    return { ok: true };
  }
}
