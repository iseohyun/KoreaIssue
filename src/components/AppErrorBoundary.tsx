import React from 'react';

interface State {
  hasError: boolean;
  errorMessage: string;
}

export class AppErrorBoundary extends React.Component<
  { children: React.ReactNode },
  State
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      errorMessage: error?.message || '알 수 없는 렌더링 오류가 발생했습니다.',
    };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[AppErrorBoundary] 렌더링 오류 포착:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '2rem', maxWidth: 680, margin: '2rem auto', background: '#fff', border: '1px solid #fecaca', borderRadius: 12 }}>
          <h2 style={{ color: '#b91c1c', marginBottom: '0.5rem' }}>화면 표시 중 오류가 발생했습니다</h2>
          <p style={{ color: '#475569', marginBottom: '1rem' }}>{this.state.errorMessage}</p>
          <button
            onClick={() => window.location.reload()}
            style={{ padding: '0.5rem 1rem', background: '#1d4ed8', color: '#fff', border: 'none', borderRadius: 6 }}
          >
            새로고침
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
