import { useMutation } from '@tanstack/react-query'
import { api } from './api'

/**
 * End the session and start the app afresh on the sign-in page. A full page load guarantees
 * nothing from the signed-out person (cached lists, the division, the basket view) stays on screen.
 */
export function useSignOut() {
  return useMutation({
    mutationFn: () => api('/auth/logout', { method: 'POST' }),
    // Even if the server cannot be reached, leave this screen; the session expires on its own.
    onSettled: () => window.location.replace('/login'),
  })
}
