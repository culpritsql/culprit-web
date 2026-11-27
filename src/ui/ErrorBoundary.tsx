import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

interface Props {
  resetKey?: string;
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidUpdate(prevProps: Props) {
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("UI boundary caught error:", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <section className="panel error-boundary-card" role="alert">
        <div className="error-boundary-head">
          <AlertTriangle size={18} />
          <strong>Could not render this view</strong>
        </div>
        <p className="muted">{this.state.error.message}</p>
        <button
          type="button"
          className="button"
          onClick={() => this.setState({ error: null })}
        >
          <RotateCcw size={14} />
          Retry view
        </button>
      </section>
    );
  }
}
