import { describe, it, expect } from 'vitest';
import { isValidRole, roleCanResolveTrigger } from '../src/lib/roles';

describe('roles', () => {
  it('isValidRole matches expected roles', () => {
    expect(isValidRole('FINANCE_APPROVER')).toBe(true);
    expect(isValidRole('COST_CONTROL_LEAD')).toBe(true);
    expect(isValidRole('INVALID_ROLE')).toBe(false);
  });

  it('roleCanResolveTrigger single role spec', () => {
    expect(roleCanResolveTrigger('FINANCE_APPROVER', 'FINANCE_APPROVER')).toBe(true);
    expect(roleCanResolveTrigger('COST_CONTROL_LEAD', 'FINANCE_APPROVER')).toBe(false);
  });

  it('roleCanResolveTrigger multi-role spec', () => {
    const spec = 'COST_CONTROL_LEAD,FINANCE_APPROVER';
    expect(roleCanResolveTrigger('COST_CONTROL_LEAD', spec)).toBe(true);
    expect(roleCanResolveTrigger('FINANCE_APPROVER', spec)).toBe(true);
    expect(roleCanResolveTrigger('MARINE_LEAD', spec)).toBe(false);
  });
});
