import { ApiError } from './api.js';

export interface PlaygroundErrorCopy {
  title: string;
  body: string;
}

export function playgroundErrorCopy(
  error: unknown,
  viewerRole: 'administrator' | 'member',
): PlaygroundErrorCopy {
  if (!(error instanceof ApiError)) {
    return {
      title: 'Request failed',
      body: 'Something went wrong. Try again, or ask an administrator if it keeps happening.',
    };
  }

  if (error.code === 'INSUFFICIENT_CREDITS') {
    const needed = error.details?.needed;
    const available = error.details?.available;
    const counts =
      needed !== undefined && available !== undefined
        ? ` This request needed ${String(needed)} credit${String(needed) === '1' ? '' : 's'}; the organization has ${String(available)} available.`
        : '';
    if (viewerRole === 'administrator') {
      return {
        title: 'Not enough credits',
        body: `${counts.trim()} Buy more credits on the Credits page. The balance increases after mock billing confirms the purchase.`,
      };
    }
    return {
      title: 'Not enough credits',
      body: `${counts.trim()} Ask an administrator to buy more credits for this organization.`,
    };
  }

  if (error.code === 'MODEL_TIMEOUT') {
    return {
      title: 'The model timed out',
      body: 'The model did not respond in time. Try again, or ask an administrator to raise the request timeout.',
    };
  }

  if (error.code === 'RATE_LIMITED') {
    return {
      title: 'Too many requests',
      body: 'You have hit the rate limit. Wait a moment and try again.',
    };
  }

  if (error.code === 'NOT_FOUND') {
    return {
      title: 'Model is not configured',
      body:
        viewerRole === 'administrator'
          ? 'Save a model endpoint and credential on the Model page, then test the connection.'
          : 'An administrator still needs to configure the organization model.',
    };
  }

  if (error.code === 'MODEL_MALFORMED' || error.code === 'MODEL_UNAVAILABLE') {
    return {
      title: 'The model failed',
      body: 'The model rejected or could not complete the request. This is not a credit charge. Try again, or ask an administrator to check the model configuration.',
    };
  }

  return {
    title: 'Request failed',
    body: error.message,
  };
}

export function pageErrorCopy(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message;
  }
  return 'Something went wrong. Refresh the page and try again.';
}
