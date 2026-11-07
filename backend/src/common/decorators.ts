import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { AuthUser, EdgeContext, Role } from './roles';

export const IS_PUBLIC = 'isPublic';
export const ROLES_KEY = 'roles';
export const Public = () => SetMetadata(IS_PUBLIC, true);
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest().user;
});
export const Edge = createParamDecorator((_: unknown, ctx: ExecutionContext): EdgeContext => {
  return ctx.switchToHttp().getRequest().edge;
});
