import { can, homeRouteFor, navFor } from './permissions';

describe('role permissions', () => {
  const ids = (role: Parameters<typeof navFor>[0]) => navFor(role).flatMap((s) => s.items.map((i) => i.id));

  it('admins see everything including admin section', () => {
    const nav = ids('ADMIN');
    expect(nav).toContain('admin-users');
    expect(nav).toContain('traffic');
    expect(nav).toContain('alerts');
  });

  it('STAFF sees only tasks, checklists, tickets and documents', () => {
    expect(ids('STAFF').sort()).toEqual(['checklist-assignments', 'documents', 'tasks', 'tickets'].sort());
    expect(navFor('STAFF').flatMap((s) => s.items).find((i) => i.id === 'checklist-assignments')?.label).toBe('My checklists');
    expect(homeRouteFor('STAFF')).toBe('/tasks');
  });

  it('AUDITOR sees analytics and checklists but not alerts/admin', () => {
    const nav = ids('AUDITOR');
    expect(nav).toContain('traffic');
    expect(nav).toContain('checklist-templates');
    expect(nav).not.toContain('alerts');
    expect(nav).not.toContain('admin-users');
  });

  it('STORE_MANAGER gets staff roster but not other admin pages', () => {
    const nav = ids('STORE_MANAGER');
    expect(nav).toContain('admin-staff');
    expect(nav).not.toContain('admin-stores');
    expect(can('STORE_MANAGER', 'manageTemplates')).toBe(false);
    expect(can('STORE_MANAGER', 'assignChecklists')).toBe(true);
  });

  it('null role can do nothing', () => {
    expect(can(null, 'tasks')).toBe(false);
    expect(navFor(null)).toEqual([]);
  });
});
