import * as bcrypt from 'bcryptjs';
import { DataSource } from 'typeorm';
import { Role } from '../common/roles';
import { UserStore } from '../modules/users/entities/user-store.entity';
import { User } from '../modules/users/entities/user.entity';

export const SEED_PASSWORD = 'Password@123';

export interface SeedUserSpec {
  email: string;
  name: string;
  role: Role;
  storeIds: number[];
}

/** Contract seed users (API_CONTRACT.md "Seed users"). */
export function contractUsers(allStoreIds: number[], chennaiStoreIds: number[], tnagarId: number): SeedUserSpec[] {
  return [
    { email: 'admin@congruence.in', name: 'Arun Kumar (Admin)', role: Role.SUPER_ADMIN, storeIds: allStoreIds },
    { email: 'regional@congruence.in', name: 'Priya Raman (Regional Manager)', role: Role.REGIONAL_MANAGER, storeIds: chennaiStoreIds },
    { email: 'manager.tnagar@congruence.in', name: 'Karthik Subramanian', role: Role.STORE_MANAGER, storeIds: [tnagarId] },
    { email: 'auditor@congruence.in', name: 'Lakshmi Narayanan (Auditor)', role: Role.AUDITOR, storeIds: allStoreIds },
    { email: 'staff.tnagar@congruence.in', name: 'Divya Murugan', role: Role.STAFF, storeIds: [tnagarId] },
  ];
}

export async function insertUsers(ds: DataSource, specs: SeedUserSpec[]): Promise<Map<string, number>> {
  const hash = await bcrypt.hash(SEED_PASSWORD, 10);
  const out = new Map<string, number>();
  for (const s of specs) {
    const u = await ds.getRepository(User).save({ email: s.email, name: s.name, role: s.role, passwordHash: hash, isActive: true });
    if (s.storeIds.length) await ds.getRepository(UserStore).insert(s.storeIds.map((storeId) => ({ userId: u.id, storeId })));
    out.set(s.email, u.id);
  }
  return out;
}
