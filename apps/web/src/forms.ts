import type { FieldValues, Path, UseFormSetError } from 'react-hook-form'
import { ApiError } from './api'

/**
 * Put the server's per-field messages under the matching inputs.
 * Returns true when at least one message was placed, so the caller can skip a general alert.
 */
export function showFieldErrors<T extends FieldValues>(error: unknown, setError: UseFormSetError<T>, fields: readonly Path<T>[]): boolean {
  if (!(error instanceof ApiError) || !error.fields) return false
  let placed = false
  for (const field of fields) {
    const message = error.fields[field]
    if (message) {
      setError(field, { message })
      placed = true
    }
  }
  return placed
}

/** A fresh key for each submission the user starts. A retry of the same submission reuses it. */
export function newIdempotencyKey(): string {
  return crypto.randomUUID()
}
