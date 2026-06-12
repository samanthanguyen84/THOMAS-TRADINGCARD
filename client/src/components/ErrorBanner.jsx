// Friendly error banner with optional retry. Pass the Error from api.js (its
// message is the server's `{ error }` text) or a plain string.
export default function ErrorBanner({ error, onRetry, children }) {
  if (!error) return null;
  const message = typeof error === 'string' ? error : error.message || 'Something went wrong.';
  return (
    <div className="banner banner-error" role="alert">
      <span className="banner-msg">
        <span aria-hidden="true">⚠️</span> {message}
        {children}
      </span>
      {onRetry && (
        <button type="button" className="btn btn-sm" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}
