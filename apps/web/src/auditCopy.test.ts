import { describe, expect, it } from 'vitest';
import { auditActionLabel, auditActorLabel, auditTargetLabel } from './auditCopy.js';

describe('audit copy', () => {
  it('uses plain English for known actions and hides ids', () => {
    expect(auditActionLabel('purchase.complete')).toBe('Purchase completed');
    expect(auditActionLabel('membership.status.update', { new_status: 'suspended' })).toBe(
      'Member suspended',
    );
    expect(auditActionLabel('membership.status.update', { new_status: 'active' })).toBe(
      'Member reactivated',
    );
    expect(auditActorLabel('admin@mercury.com')).toBe('admin@mercury.com');
    expect(auditActorLabel(null)).toBe('System');
    expect(auditTargetLabel('invitation.create', 'membership')).toBe('Invitation');
    expect(auditTargetLabel('purchase.create', 'purchase')).toBe('Purchase');
  });
});
