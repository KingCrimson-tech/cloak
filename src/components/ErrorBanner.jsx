export default function ErrorBanner({ message, warning, onDismissWarning }) {
  if (!message && !warning) return null

  return (
    <div className="banners" aria-live="polite">
      {message && (
        <div className="banner banner--error" role="alert">
          <span className="banner__icon" aria-hidden="true">!</span>
          <span>{message}</span>
        </div>
      )}
      {warning && (
        <div className="banner banner--warning">
          <span className="banner__icon" aria-hidden="true">i</span>
          <span>{warning}</span>
          {onDismissWarning && (
            <button className="banner__close" onClick={onDismissWarning} aria-label="Dismiss">
              ×
            </button>
          )}
        </div>
      )}
    </div>
  )
}
