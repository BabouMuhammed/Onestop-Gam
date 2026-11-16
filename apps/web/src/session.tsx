import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Permission } from '@onestop/shared'
import { api, ApiError, setActiveDivision, setSignedOutHandler } from './api'
import type { Division, Me } from './types'

/** The signed-in user, or null when nobody is signed in. */
export function useMe() {
  return useQuery({
    queryKey: ['me'],
    // 'two-step' means the password was accepted and the code from the app is still needed.
    queryFn: async (): Promise<Me | null | 'two-step'> => {
      try {
        return await api<Me>('/auth/me')
      } catch (error) {
        if (error instanceof ApiError && error.code === 'TWO_STEP_REQUIRED') return 'two-step'
        if (error instanceof ApiError && error.status === 401) return null
        throw error
      }
    },
    staleTime: 60_000,
    // A sleeping server can time out the first request while it wakes; try again a few times.
    retry: (failures, error) => failures < 4 && error instanceof ApiError && (error.status === 0 || error.status >= 500),
    retryDelay: 5000,
  })
}

interface Session extends Me {
  can: (permission: Permission) => boolean
  /** The division every screen is currently working in. */
  division: Division
  setDivision: (id: string) => void
  /** True for CEO and Finance, who can switch between divisions. */
  canSwitchDivision: boolean
  dashboardScope: string
  setDashboardScope: (id: string) => void
}

const SessionContext = createContext<Session | null>(null)

export function useSession(): Session {
  const session = useContext(SessionContext)
  if (!session) throw new Error('useSession must be used inside SessionProvider')
  return session
}

const STORAGE_KEY = 'onestop.division'
function rememberedDivision(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

export function SessionProvider({ me, children }: { me: Me; children: ReactNode }) {
  const queryClient = useQueryClient()
  const [divisionId, setDivisionId] = useState<string>(() => {
    const remembered = rememberedDivision()
    return me.divisions.find((d) => d.id === remembered)?.id ?? me.divisions[0]!.id
  })
  const division = me.divisions.find((d) => d.id === divisionId) ?? me.divisions[0]!
  const crossDivision = me.user.role === 'CEO' || me.user.role === 'FINANCE'
  const [dashboardScope, setDashboardScope] = useState('all')
  // Set before children render, so their first request already carries the division.
  setActiveDivision(division.id)

  useEffect(() => {
    setSignedOutHandler(() => queryClient.setQueryData(['me'], null))
  }, [queryClient])

  const value = useMemo<Session>(
    () => ({
      ...me,
      can: (permission) => me.permissions.includes(permission),
      division,
      canSwitchDivision: crossDivision && me.divisions.length > 1,
      dashboardScope: crossDivision ? dashboardScope : division.id,
      setDashboardScope: (id) => {
        if (crossDivision && (id === 'all' || me.divisions.some((d) => d.id === id))) setDashboardScope(id)
      },
      setDivision: (id) => {
        if (!me.divisions.some((d) => d.id === id)) return
        setDivisionId(id)
        setDashboardScope(id)
        setActiveDivision(id)
        try {
          localStorage.setItem(STORAGE_KEY, id)
        } catch {
          // Storage can be unavailable (private mode); the choice then lasts for this visit only.
        }
      },
    }),
    [me, division, crossDivision, dashboardScope],
  )
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

/** Presentation details for a division. Names come from the server; marks and logos live here. */
export function divisionBrand(code: string): { logo: string; markClass: string } {
  if (code === 'QUALITY_FOODS') return { logo: '/brand/quality-foods.jpg', markClass: 'bg-quality-foods' }
  return { logo: '/brand/le-gaye-bi.jpg', markClass: 'bg-le-gaye-bi' }
}
