import { AppError } from "./errors";

export interface ActionState {
  error?: string;
  message?: string;
}

// Every mutation runs in a single transaction, so any throw means nothing was saved.
export function actionErrorState(err: unknown, requestId: string, label: string): ActionState {
  if (err instanceof AppError) return { error: err.message };
  console.error(`${label} failed (request ${requestId})`, err);
  return { error: `Something went wrong (request ${requestId.slice(0, 8)}). No changes were saved.` };
}
