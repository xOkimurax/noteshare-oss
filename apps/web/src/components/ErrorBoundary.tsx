import React, { ErrorInfo, ReactNode } from 'react';
import {
  isStaleAssetError,
  reloadForNewVersion,
} from '../lib/reload';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
    };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
    // A render error caused by a stale build after deploy — reload once to
    // pick up the new assets instead of stranding the user on this screen.
    if (isStaleAssetError(error)) reloadForNewVersion();
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="h-screen w-screen flex flex-col items-center justify-center bg-stone-50 p-6 text-center">
          <div className="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center mb-6">
            <span className="text-4xl">⚠️</span>
          </div>
          <h1 className="text-2xl font-bold mb-2">Something went wrong</h1>
          <p className="text-stone-500 mb-6 max-w-md">
            The application encountered an unexpected error. Please try refreshing the page.
          </p>
          <pre className="bg-stone-200 p-4 rounded-xl text-xs text-left overflow-auto max-w-full mb-6">
            {this.state.error?.message}
          </pre>
          <button
            onClick={() => window.location.reload()}
            className="btn-primary"
          >
            Refresh Application
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
