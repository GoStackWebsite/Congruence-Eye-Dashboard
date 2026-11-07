export enum Role {
  SUPER_ADMIN = 'SUPER_ADMIN',
  ADMIN = 'ADMIN',
  REGIONAL_MANAGER = 'REGIONAL_MANAGER',
  STORE_MANAGER = 'STORE_MANAGER',
  AUDITOR = 'AUDITOR',
  STAFF = 'STAFF',
}
export const ALL_ROLES = Object.values(Role);
export const ADMINS: Role[] = [Role.SUPER_ADMIN, Role.ADMIN];
export const MANAGER_PLUS: Role[] = [Role.STORE_MANAGER, Role.REGIONAL_MANAGER, Role.ADMIN, Role.SUPER_ADMIN];
export const TEMPLATE_WRITERS: Role[] = [Role.SUPER_ADMIN, Role.ADMIN, Role.REGIONAL_MANAGER, Role.AUDITOR];
export const ASSIGNMENT_WRITERS: Role[] = [Role.SUPER_ADMIN, Role.ADMIN, Role.REGIONAL_MANAGER, Role.STORE_MANAGER, Role.AUDITOR];
export const REVIEWERS: Role[] = ASSIGNMENT_WRITERS;

export const isAdmin = (role: string) => role === Role.SUPER_ADMIN || role === Role.ADMIN;
export const isManagerPlus = (role: string) => MANAGER_PLUS.includes(role as Role);

export interface AuthUser {
  id: number;
  email: string;
  name: string;
  role: Role;
  storeIds: number[];
}

export interface EdgeContext {
  deviceId: number;
  storeId: number;
}
