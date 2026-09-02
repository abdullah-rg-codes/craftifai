const ACTION_LABELS: Record<string, string> = {
  'invitation.accept': 'Invitation accepted',
  'invitation.create': 'Invitation created',
  'membership.create': 'Member added',
  'membership.delete': 'Member removed',
  'membership.role.update': 'Role changed',
  'model_configuration.upsert': 'Model settings saved',
  'purchase.complete': 'Purchase completed',
  'purchase.create': 'Purchase started',
};

const TARGET_LABELS: Record<string, string> = {
  invitation: 'Invitation',
  membership: 'Member',
  model_configuration: 'Model',
  purchase: 'Purchase',
};

export function auditActionLabel(
  action: string,
  metadata: Record<string, unknown> | null | undefined = undefined,
): string {
  if (action === 'membership.status.update') {
    return metadata?.new_status === 'suspended' ? 'Member suspended' : 'Member reactivated';
  }
  const known = ACTION_LABELS[action];
  if (known) {
    return known;
  }
  const words = action.replaceAll('.', ' ').replaceAll('_', ' ').trim();
  if (words.length === 0) {
    return 'Event';
  }
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function auditActorLabel(email: string | null | undefined): string {
  const trimmed = email?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : 'System';
}

export function auditTargetLabel(action: string, targetType: string | null | undefined): string {
  if (action.startsWith('invitation.')) {
    return 'Invitation';
  }
  if (action.startsWith('purchase.')) {
    return 'Purchase';
  }
  if (action.startsWith('model_')) {
    return 'Model';
  }
  if (action.startsWith('membership.')) {
    return 'Member';
  }
  if (targetType && TARGET_LABELS[targetType]) {
    return TARGET_LABELS[targetType];
  }
  return '—';
}
