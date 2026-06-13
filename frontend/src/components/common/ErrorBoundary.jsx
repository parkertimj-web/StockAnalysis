import { Component } from 'react';

/**
 * Catches render/effect errors in children so one broken component
 * (e.g. a chart fed bad data) doesn't unmount the whole app.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info?.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="card p-4 text-xs text-red-400 space-y-2">
          <div className="font-semibold">{this.props.label || 'Something went wrong'}</div>
          <div className="text-gray-400 mono break-all">{String(this.state.error?.message || this.state.error)}</div>
          <button
            onClick={() => this.setState({ error: null })}
            className="border border-gray-700 rounded px-2 py-1 text-gray-300 hover:border-gray-500"
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
