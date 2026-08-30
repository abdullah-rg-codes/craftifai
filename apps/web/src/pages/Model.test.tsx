import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { api } from '../api.js';
import {
  configToForm,
  modelConfigWritePayload,
  type PublicModelConfig,
} from '../modelConfigForm.js';
import { ModelPage } from './Model.js';

vi.mock('../api.js', () => ({
  api: vi.fn(),
}));

const leakedGet: PublicModelConfig & { credential?: string } = {
  deployment_mode: 'saas',
  endpoint_url: 'https://models.example.test/v1/chat/completions',
  model_name: 'demo',
  timeout_ms: 30000,
  credential_set: true,
  credential_updated_at: '2026-01-01T00:00:00.000Z',
  ca_bundle_set: false,
  credential: 'leaked-model-secret',
};

describe('model configuration form', () => {
  beforeEach(() => {
    vi.mocked(api).mockReset();
  });

  it('never copies a credential from a GET-shaped payload into the form or a PUT body', () => {
    const form = configToForm(leakedGet);
    expect(form.credential).toBe('');
    expect(form.endpoint_url).toBe(leakedGet.endpoint_url);
    const payload = modelConfigWritePayload(form);
    expect(payload).not.toHaveProperty('credential');
    expect(JSON.stringify(payload)).not.toContain('leaked-model-secret');
  });

  it('includes credential on PUT only when the user typed one', () => {
    const payload = modelConfigWritePayload({
      ...configToForm(leakedGet),
      credential: '  new-secret  ',
    });
    expect(payload.credential).toBe('new-secret');
  });

  it('renders the credential input empty even if a GET payload leaked a secret field', async () => {
    vi.mocked(api).mockResolvedValue(leakedGet);
    render(<ModelPage />);
    await waitFor(() => {
      expect(screen.getByLabelText('Credential')).toBeDefined();
    });
    const input = screen.getByLabelText('Credential') as HTMLInputElement;
    expect(input.value).toBe('');
    expect(input.getAttribute('value') ?? '').not.toContain('leaked-model-secret');
  });
});
