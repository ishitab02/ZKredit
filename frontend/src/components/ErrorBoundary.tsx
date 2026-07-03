import { Component, type ReactNode } from "react";

/**
 * Isolates a failure (e.g. a lazy chunk that failed to load after a
 * redeploy invalidated the old asset hash) to just this subtree instead of
 * taking down the rest of the page.
 */
export default class ErrorBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    return this.state.hasError ? this.props.fallback : this.props.children;
  }
}
