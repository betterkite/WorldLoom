'use client';

// global-error replaces the root layout when it errors, so globals.css is not
// loaded here — styles must be inline and self-contained.
export default function GlobalError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang='zh-CN'>
      <body
        style={{
          margin: 0,
          display: 'flex',
          minHeight: '100vh',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'system-ui, sans-serif'
        }}
      >
        <div style={{ textAlign: 'center', padding: '1rem' }}>
          <h1 style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>出了点问题</h1>
          <p style={{ color: '#6b7280', marginBottom: '1.25rem' }}>
            页面渲染时发生意外错误，请重试；若持续出现，请把下面的错误编号反馈给我们。
          </p>
          {error.digest && (
            <p style={{ color: '#9ca3af', marginBottom: '1.25rem', fontSize: '0.75rem' }}>
              错误编号：{error.digest}
            </p>
          )}
          <button
            onClick={() => reset()}
            style={{
              padding: '0.5rem 1.25rem',
              borderRadius: '0.5rem',
              border: '1px solid #d1d5db',
              background: 'transparent',
              font: 'inherit',
              cursor: 'pointer'
            }}
          >
            重试
          </button>
        </div>
      </body>
    </html>
  );
}
