"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import Link from "next/link";
import { Button } from "./Controls";
import { Icon } from "./Icon";

export interface ErrorBoundaryProps {
  children: ReactNode;
  fallbackTitle?: string;
  onReset?: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (process.env.NODE_ENV !== "production") {
      console.error("[StudioErrorBoundary]", error, info.componentStack);
    }
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
    this.props.onReset?.();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          role="alert"
          className="flex min-h-[320px] flex-col items-center justify-center rounded-xl border border-rose-500/30 bg-ink-900 p-8 text-center"
        >
          <div className="grid h-11 w-11 place-items-center rounded-lg border border-rose-500/30 bg-rose-950/50 text-rose-300">
            <Icon name="alert" size={20} />
          </div>
          <h2 className="mt-4 text-sm font-semibold text-ink-100">
            {this.props.fallbackTitle ?? "Workspace panel encountered an error"}
          </h2>
          <p className="mt-1.5 max-w-md font-mono text-xs text-ink-400">
            {this.state.error?.message || "An unexpected error occurred in the studio view."}
          </p>
          <div className="mt-5 flex items-center gap-2">
            <Button variant="primary" onClick={this.handleReset}>
              Reset View
            </Button>
            <Link
              href="/dashboard"
              className="focus-ring inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-ink-850 px-3 py-1.5 text-xs font-medium text-ink-200 hover:border-white/20 hover:text-ink-100"
            >
              Return to Dashboard
            </Link>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
