export const LANDING_PATH = "/"
export const ATTESTATION_PATH = "/attestation"
export const IDENTITY_PATH = "/identity"

export type SiteRoute = "landing" | "attestation" | "identity"

export function getSiteRoute(pathname: string = window.location.pathname): SiteRoute {
  if (pathname.startsWith(IDENTITY_PATH)) return "identity"
  if (pathname.startsWith(ATTESTATION_PATH)) return "attestation"
  return "landing"
}
