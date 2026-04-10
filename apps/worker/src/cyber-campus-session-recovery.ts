export interface RetryOnceAfterEmptyStoredSessionInput<T> {
  hasStoredSession: boolean;
  load: () => Promise<T>;
  isEmpty: (result: T) => boolean;
  refresh: () => Promise<void>;
}

export interface RetryOnceAfterEmptyStoredSessionResult<T> {
  result: T;
  retriedStoredSession: boolean;
}

export async function retryOnceAfterEmptyStoredSession<T>(
  input: RetryOnceAfterEmptyStoredSessionInput<T>,
): Promise<RetryOnceAfterEmptyStoredSessionResult<T>> {
  const initial = await input.load();
  if (!input.hasStoredSession || !input.isEmpty(initial)) {
    return {
      result: initial,
      retriedStoredSession: false,
    };
  }

  await input.refresh();

  return {
    result: await input.load(),
    retriedStoredSession: true,
  };
}
