/** The round mark that leads a toast: done, still working, or archived. */
export function ToastMark({ kind }: { kind: 'archive' | 'pending' | 'success' }) {
  return (
    <span className={`toast-mark toast-mark--${kind}`} aria-hidden="true">
      <svg viewBox="0 0 24 24">
        {kind === 'success' ? (
          <path d="m7.5 12.5 3 3 6-7" />
        ) : kind === 'pending' ? (
          <path d="M19 8a7.5 7.5 0 1 0 .2 7.6M19 4v4h-4" />
        ) : (
          <>
            <path d="M5 8h14v11H5z" />
            <path d="M4 5h16v3H4zM9 12h6" />
          </>
        )}
      </svg>
    </span>
  );
}
