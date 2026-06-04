import { Component, type ErrorInfo, type ReactNode } from "react";
import "./ErrorBoundary.css";

type ErrorBoundaryProps = {
  children: ReactNode;
  resetKey?: string;
};

type ErrorBoundaryState = {
  hasError: boolean;
  message?: string;
};

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, message: error.message };
  }

  componentDidUpdate(previousProps: ErrorBoundaryProps) {
    if (this.state.hasError && previousProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false, message: undefined });
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Feature panel crashed", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <section className="errorBoundaryPanel" role="alert">
          <h2>当前面板加载失败</h2>
          <p>{this.state.message ?? "未知错误"}</p>
        </section>
      );
    }

    return this.props.children;
  }
}
