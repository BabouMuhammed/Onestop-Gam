import { ArrowRight } from 'lucide-react'
import { Link } from 'react-router'
import { BUSINESS_ENTRIES } from '../businessBranding'
import { ButtonLink } from '../ui'

/** Public company branding only; this page never fetches private business data. */
export function WelcomePage() {
  return (
    <main className="welcome-page" aria-label="ONE STOP GAMBIA welcome">
      <h1 className="sr-only">ONE STOP GAMBIA</h1>
      <p className="sr-only">Your Onestop Company. Trusted to deliver Excellence.</p>
      <div className="welcome-backdrop" aria-hidden="true" />
      <div className="welcome-signage-space" aria-hidden="true" />
      <div className="welcome-controls">
        <nav className="welcome-business-panels" aria-label="Choose your business">
          {BUSINESS_ENTRIES.map((business) => (
            <Link key={business.code} to={`/login?division=${business.code}`}
              className="welcome-business-panel" aria-label={`Sign in to ${business.label}`}>
              <img className="welcome-panel-logo" src={business.logo} alt={`${business.label} logo`} width="84" height="44" />
              <span>
                <span className="welcome-panel-name">{business.name}</span>
                <span className="welcome-panel-subtitle">{business.subtitle}</span>
              </span>
              <ArrowRight size={16} strokeWidth={1.75} aria-hidden="true" />
            </Link>
          ))}
        </nav>
        <ButtonLink to="/login" variant="primary" className="welcome-start">
          GET STARTED <ArrowRight size={18} strokeWidth={1.75} aria-hidden="true" />
        </ButtonLink>
      </div>
    </main>
  )
}
