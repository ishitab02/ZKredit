export const LANDING_PATH = "/"
export const ATTESTATION_PATH = "/attestation"

export type SiteRoute = "landing" | "attestation"

export function getSiteRoute(pathname: string = window.location.pathname): SiteRoute {
  return pathname.startsWith(ATTESTATION_PATH) ? "attestation" : "landing"
}
