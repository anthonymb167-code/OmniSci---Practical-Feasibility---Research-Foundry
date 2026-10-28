export function notifyBillingUpdated(): void {
  window.dispatchEvent(new Event('billing:updated'));
}

export function promptBillingUpgrade(message: string): void {
  window.dispatchEvent(new CustomEvent('billing:upgrade', { detail: { message } }));
}

export async function readAiResponse<T>(response: Response): Promise<T> {
  const result = (await response.json()) as T & { error?: string };
  notifyBillingUpdated();
  if (!response.ok) {
    if (response.status === 402 || response.status === 403) {
      promptBillingUpgrade(result.error || 'A paid plan or additional credits are required for this request.');
    }
    throw new Error(result.error || 'The AI request failed.');
  }
  return result;
}
