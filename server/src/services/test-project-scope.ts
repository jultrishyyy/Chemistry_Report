import type { AppUser } from '../../../shared/rbac.js';

export function canSeeTestProject(test: any, user: AppUser | null): boolean {
  if (!user) return true;
  if (user.roles.includes('admin') || user.roles.includes('deputy_director')) return true;

  const group = String(test?.detection_group || '').trim();
  if (user.roles.includes('test_supervisor')) {
    return !!group && group === String(user.depart_name || '').trim();
  }
  if (user.roles.includes('test_engineer')) {
    const owners = [
      test?.leader, test?.engineer, test?.tester,
      test?.assigned_engineer_job_no, test?.engineer_job_no, test?.tester_job_no,
    ].map(value => String(value || '').trim()).filter(Boolean);
    return owners.includes(user.user_name) || owners.includes(user.job_no);
  }
  return true;
}

export function visibleWorkOrder(order: any, user: AppUser | null) {
  if (!user || (!user.roles.includes('test_supervisor') && !user.roles.includes('test_engineer'))) return order;
  const samples = (order.payload?.samples || []).map((sample: any) => ({
    ...sample,
    test_infos: (sample.test_infos || []).filter((test: any) => canSeeTestProject(test, user)),
  })).filter((sample: any) => sample.test_infos.length);
  return { ...order, payload: { ...(order.payload || {}), samples } };
}
