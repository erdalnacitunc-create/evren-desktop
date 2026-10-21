import type { EvrenApi } from './index'

declare global {
  interface Window {
    evren: EvrenApi
  }
}
