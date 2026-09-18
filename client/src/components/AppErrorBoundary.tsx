import { Component, type ReactNode } from 'react';

/** Render failures must not leave a blank screen or silently reload unsaved edits. */
export default class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error) { console.error('Application render failed', error); }
  render() {
    if (!this.state.failed) return this.props.children;
    return <div role="alert" style={{ padding: 32, maxWidth: 560, margin: '40px auto', lineHeight: 1.8 }}>
      <h2>页面暂时无法显示</h2>
      <p>未保存的修改可能尚未保存。请先尝试恢复页面；若仍失败，再刷新并检查已保存内容。</p>
      <button onClick={() => this.setState({ failed: false })}>尝试恢复</button>{' '}
      <button onClick={() => { if (window.confirm('刷新可能丢失未保存修改，确定刷新？')) window.location.reload(); }}>刷新页面</button>
    </div>;
  }
}
