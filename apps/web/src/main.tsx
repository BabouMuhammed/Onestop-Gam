import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { App } from './App'
import { ApiError } from './api'
import './styles.css'
import { NoticeProvider } from './ui'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: true,
      // Retry dropped connections, not answers the server gave on purpose.
      retry: (failures, error) => failures < 2 && error instanceof ApiError && (error.status === 0 || error.status >= 500),
    },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <NoticeProvider>
          <App />
        </NoticeProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
