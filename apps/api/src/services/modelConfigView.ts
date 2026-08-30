import type { DbModelConfiguration } from '@craftifai/db';

export interface PublicModelConfig {
  deployment_mode: 'saas' | 'onprem';
  endpoint_url: string;
  model_name: string;
  timeout_ms: number;
  credential_set: boolean;
  credential_updated_at: string | null;
  ca_bundle_set: boolean;
}

export function toPublicModelConfig(row: DbModelConfiguration): PublicModelConfig {
  return {
    deployment_mode: row.deployment_mode,
    endpoint_url: row.endpoint_url,
    model_name: row.model_name,
    timeout_ms: row.timeout_ms,
    credential_set: row.credential_ciphertext !== null,
    credential_updated_at: row.credential_updated_at
      ? row.credential_updated_at.toISOString()
      : null,
    ca_bundle_set: row.ca_bundle !== null,
  };
}
