import { Component, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  /** Shown instead of the page after it failed to render. */
  fallback: ReactNode;
  children: ReactNode;
}

/** A failed render shows the fallback (with a way to reload) instead of an empty frame. */
class ErrorBoundary extends Component<ErrorBoundaryProps, { isFailed: boolean }> {
  state = { isFailed: false };

  static getDerivedStateFromError() {
    return { isFailed: true };
  }

  componentDidCatch(error: unknown) {
    console.error(error);
  }

  render() {
    return this.state.isFailed ? this.props.fallback : this.props.children;
  }
}

export default ErrorBoundary;
