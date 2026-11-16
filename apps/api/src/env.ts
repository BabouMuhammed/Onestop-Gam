import { loadRootEnvironment, parseEnvironment } from './environment'

loadRootEnvironment()
export const env = parseEnvironment(process.env)
export const isProduction = env.NODE_ENV === 'production'
export const isTest = env.NODE_ENV === 'test'
