import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import { api, ApiError, setActiveDivision } from './api'

/** Keep the observed session query alive while removing private cached data. */
export function useSignOut() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  return useMutation({
    mutationFn: async () => {
      try { await api('/auth/logout', { method: 'POST' }) }
      catch (error) {
        // An expired session is already signed out. Other failures need a retry.
        if (!(error instanceof ApiError) || error.status !== 401) throw error
      }
    },
    onSuccess: async () => {
      await queryClient.cancelQueries()
      queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== 'me' })
      queryClient.setQueryData(['me'], null)
      setActiveDivision(null)
      navigate('/login', { replace: true })
    },
  })
}
