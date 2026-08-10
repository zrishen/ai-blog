import { Component, type ErrorInfo, type ReactNode } from "react";
import * as Sentry from "@sentry/react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/** 应用级错误边界：捕获子树渲染异常，上报 Sentry 并渲染中文兜底 UI。

 * getDerivedStateFromError 决定渲染兜底 UI；componentDidCatch 负责把异常上报到 Sentry
 * （原 App.tsx 的自建版本缺这一步，等于只兜底不上报）。
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    Sentry.captureException(error, {
      contexts: { react: { componentStack: info.componentStack } },
    });
  }

  render() {
    if (this.state.error) {
      return (
        <div className="whitespace-pre-wrap p-10 font-mono text-destructive">
          <h2>App Crashed</h2>
          <p>{this.state.error.message}</p>
          <pre>{this.state.error.stack}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}
