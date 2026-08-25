import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode };
type State = { error: Error | null; info: string | null };

/** Last-resort net for render crashes — without this, a thrown error inside any page component
 * unmounts the tree silently (WebView2 shows the previous frozen frame) with zero visible signal
 * that anything went wrong, which is indistinguishable from a stuck/unresponsive window. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: null };

  static getDerivedStateFromError(error: Error) {
    return { error, info: null };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Cozyverse Studio crashed:", error, info.componentStack);
    this.setState({ info: info.componentStack ?? null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="h-full flex items-center justify-center p-8 bg-base-950">
        <div className="max-w-xl w-full rounded-xl border border-red-800 bg-red-950/40 p-6">
          <h1 className="text-lg font-semibold text-red-200 mb-2">Something went wrong</h1>
          <p className="text-sm text-red-300/90 mb-4">
            Cozyverse Studio hit an unexpected error and stopped rendering this screen. Your project files on disk are untouched — this is
            a display crash, not data loss.
          </p>
          <pre className="text-xs text-red-200/80 bg-black/30 rounded-lg p-3 overflow-auto max-h-48 whitespace-pre-wrap">
            {this.state.error.message}
            {this.state.info ? `\n${this.state.info}` : ""}
          </pre>
          <button
            className="mt-4 rounded-lg bg-accent-500 hover:bg-accent-400 text-accentText px-4 py-2 text-sm font-medium"
            onClick={() => window.location.reload()}
          >
            Reload Cozyverse Studio
          </button>
        </div>
      </div>
    );
  }
}
