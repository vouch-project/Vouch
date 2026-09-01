import { ethers } from 'ethers';

export const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

const isRetryable = (error: unknown): boolean => {
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  const code = (error as { code?: string }).code;
  return (
    code === 'SERVER_ERROR' ||
    code === 'NETWORK_ERROR' ||
    code === 'TIMEOUT' ||
    msg.includes('429') ||
    msg.includes('rate limit') ||
    msg.includes('too many requests') ||
    msg.includes('econnreset') ||
    msg.includes('econnrefused') ||
    msg.includes('etimedout') ||
    msg.includes('socket hang up') ||
    msg.includes('network error') ||
    msg.includes('timeout')
  );
};

export const withRetry = async <T>(
  fn: () => Promise<T>,
  {
    maxAttempts = 5,
    baseDelayMs = 1000,
    onRetry,
  }: {
    maxAttempts?: number;
    baseDelayMs?: number;
    onRetry?: (attempt: number, error: Error, delayMs: number) => void;
  } = {},
): Promise<T> => {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const isLast = attempt === maxAttempts;
      if (isLast || !isRetryable(error)) throw error;
      const delayMs = baseDelayMs * 2 ** (attempt - 1);
      onRetry?.(attempt, error as Error, delayMs);
      await sleep(delayMs);
    }
  }
  /* istanbul ignore next */
  throw new Error('unreachable');
};

/**
 * JsonRpcProvider that retries transient failures (rate limits, network blips)
 * with exponential backoff before bubbling the error.
 */
export class RetryingJsonRpcProvider extends ethers.JsonRpcProvider {
  private readonly maxAttempts: number;
  private readonly baseDelayMs: number;
  private readonly onRetry?: (
    attempt: number,
    error: Error,
    delayMs: number,
  ) => void;

  constructor(
    url: string,
    network?: ethers.Networkish,
    options?: ethers.JsonRpcApiProviderOptions & {
      maxAttempts?: number;
      baseDelayMs?: number;
      onRetry?: (attempt: number, error: Error, delayMs: number) => void;
    },
  ) {
    const {
      maxAttempts = 5,
      baseDelayMs = 1000,
      onRetry,
      ...rest
    } = options ?? {};
    super(url, network, rest);
    this.maxAttempts = maxAttempts;
    this.baseDelayMs = baseDelayMs;
    this.onRetry = onRetry;
  }

  override async send(
    method: string,
    params: Array<unknown>,
  ): Promise<unknown> {
    return withRetry(() => super.send(method, params), {
      maxAttempts: this.maxAttempts,
      baseDelayMs: this.baseDelayMs,
      onRetry: this.onRetry,
    });
  }
}
