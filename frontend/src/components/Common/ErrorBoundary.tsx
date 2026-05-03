import { Component, type ReactNode, type ErrorInfo } from "react";

interface Props {
  children: ReactNode;
  /** Optional custom UI when an error is caught. Pass a render function to receive a reset callback. */
  fallback?: ReactNode | ((reset: () => void) => ReactNode);
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[SkyDark] Render error:", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      const reset = () => this.setState({ hasError: false, error: null });
      if (this.props.fallback) {
        if (typeof this.props.fallback === "function") {
          return this.props.fallback(reset);
        }
        return this.props.fallback;
      }
      return (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            height: "100vh",
            background: "#F8FAFB",
            color: "#2B3A4A",
            fontFamily: "'Nunito', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
            padding: "2rem",
            textAlign: "center",
            gap: "1rem",
          }}
        >
          <div style={{ fontSize: "2rem" }}>⚠️</div>
          <h2 style={{ fontSize: "1.25rem", fontWeight: 600, margin: 0 }}>
            Something went wrong
          </h2>
          <p style={{ fontSize: "0.875rem", color: "#6B7C8F", margin: 0, maxWidth: 400 }}>
            {this.state.error?.message ?? "An unexpected error occurred."}
          </p>
          <a
            href="#/calendar"
            style={{ color: "#3B9BBF", fontWeight: 600, marginTop: "0.25rem" }}
          >
            Go to Calendar
          </a>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            style={{
              marginTop: "0.5rem",
              padding: "0.5rem 1.25rem",
              borderRadius: 8,
              border: "none",
              background: "#3B9BBF",
              color: "#fff",
              fontWeight: 600,
              cursor: "pointer",
              fontSize: "0.875rem",
            }}
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
