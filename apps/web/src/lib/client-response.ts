export async function readJsonBody<T>(response: Response): Promise<T | null> {
  const text = await response.text();
  if (!text.trim()) {
    return null;
  }

  return JSON.parse(text) as T;
}

export function resolveClientResponseError(
  response: Response,
  payload: { error?: string } | null | undefined,
  fallbackMessage: string,
): string {
  const message = payload?.error?.trim();
  if (message) {
    return message;
  }

  if (response.status >= 500) {
    return "Server returned an invalid response.";
  }

  return fallbackMessage;
}
