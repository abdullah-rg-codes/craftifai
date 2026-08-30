export interface PublicModelConfig {
  deployment_mode: 'saas' | 'onprem';
  endpoint_url: string;
  model_name: string;
  timeout_ms: number;
  credential_set: boolean;
  credential_updated_at: string | null;
  ca_bundle_set: boolean;
}

export interface ModelConfigForm {
  deployment_mode: 'saas' | 'onprem';
  endpoint_url: string;
  model_name: string;
  timeout_ms: string;
  credential: string;
}

export function configToForm(config: PublicModelConfig | null): ModelConfigForm {
  return {
    deployment_mode: config?.deployment_mode ?? 'saas',
    endpoint_url: config?.endpoint_url ?? '',
    model_name: config?.model_name ?? '',
    timeout_ms: String(config?.timeout_ms ?? 30000),
    credential: '',
  };
}

export function modelConfigWritePayload(form: ModelConfigForm): Record<string, unknown> {
  const body: Record<string, unknown> = {
    deployment_mode: form.deployment_mode,
    endpoint_url: form.endpoint_url,
    model_name: form.model_name,
    timeout_ms: Number.parseInt(form.timeout_ms, 10),
  };
  if (form.credential.trim().length > 0) {
    body.credential = form.credential.trim();
  }
  return body;
}
