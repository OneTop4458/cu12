export type DeadlineLoadStatus = "idle" | "loading" | "loaded" | "error";

export type DeadlineLoadState<T> = {
  status: DeadlineLoadStatus;
  items: T[] | null;
  requestId: number;
  error: string | null;
};

export function createDeadlineLoadState<T>(requestId = 0): DeadlineLoadState<T> {
  return {
    status: "idle",
    items: null,
    requestId,
    error: null,
  };
}

export function startDeadlineLoad<T>(previous: DeadlineLoadState<T>, requestId: number): DeadlineLoadState<T> {
  return {
    status: "loading",
    items: previous.items,
    requestId,
    error: null,
  };
}

export function finishDeadlineLoad<T>(
  results: PromiseSettledResult<T[]>[],
  requestId: number,
  messages: {
    partialFailure: string;
    totalFailure: string;
  },
): DeadlineLoadState<T> {
  const fulfilledResults = results
    .filter((result): result is PromiseFulfilledResult<T[]> => result.status === "fulfilled");
  const fulfilled = fulfilledResults.flatMap((result) => result.value);
  const failedCount = results.length - fulfilledResults.length;

  if (fulfilledResults.length > 0) {
    return {
      status: "loaded",
      items: fulfilled,
      requestId,
      error: failedCount > 0 ? messages.partialFailure : null,
    };
  }

  return {
    status: "error",
    items: null,
    requestId,
    error: messages.totalFailure,
  };
}
