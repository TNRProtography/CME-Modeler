// --- START OF FILE src/components/ErrorBoundary.tsx ---

import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
  };

  public static getDerivedStateFromError(error: Error): State {
    // Update state so the next render will show the fallback UI.
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // You can also log the error to an error reporting service
    console.error("Uncaught error:", error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      const userAgent = window.navigator.userAgent;
      const platform = window.navigator.platform;
      const macosPlatforms = ['Macintosh', 'MacIntel', 'MacPPC', 'Mac68K'];
      const windowsPlatforms = ['Win32', 'Win64', 'Windows', 'WinCE'];
      const iosPlatforms = ['iPhone', 'iPad', 'iPod'];

      let os: 'mac' | 'windows' | 'ios' | 'android' | 'other' = 'other';
      if (macosPlatforms.indexOf(platform) !== -1) {
        os = 'mac';
      } else if (windowsPlatforms.indexOf(platform) !== -1) {
        os = 'windows';
      } else if (iosPlatforms.indexOf(platform) !== -1) {
        os = 'ios';
      } else if (/Android/.test(userAgent)) {
        os = 'android';
      }
      
      const emailSubject = "Critical Error in Spot The Aurora";
      const mailtoLink = `mailto:help@spottheaurora.co.nz?subject=${encodeURIComponent(emailSubject)}`;

      return (
        <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-neutral-900 text-neutral-200 p-8 text-center">
          <div className="w-16 h-16 mb-6">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-full h-full text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
          </div>
          <h1 className="text-3xl font-bold text-white mb-4">Something Went Wrong</h1>
          <p className="max-w-lg mb-4 text-neutral-400">
            An unexpected error occurred. This can sometimes be fixed with a hard refresh, which clears the local cache for the page.
          </p>

          <div className="bg-neutral-800/50 border border-neutral-700 p-4 rounded-lg mb-6 text-left text-sm max-w-md w-full">
            <h3 className="font-semibold text-neutral-200 mb-2 text-center">Please try the following for your device:</h3>
            {(os === 'windows' || os === 'other') && (
              <p className="text-center">
                Press <kbd className="px-2 py-1 text-xs font-semibold text-neutral-200 bg-neutral-900 border border-neutral-600 rounded-md">Ctrl</kbd> + <kbd className="px-2 py-1 text-xs font-semibold text-neutral-200 bg-neutral-900 border border-neutral-600 rounded-md">F5</kbd>.
              </p>
            )}
            {os === 'mac' && (
              <p className="text-center">
                Press <kbd className="px-2 py-1 text-xs font-semibold text-neutral-200 bg-neutral-900 border border-neutral-600 rounded-md">Cmd</kbd> + <kbd className="px-2 py-1 text-xs font-semibold text-neutral-200 bg-neutral-900 border border-neutral-600 rounded-md">Shift</kbd> + <kbd className="px-2 py-1 text-xs font-semibold text-neutral-200 bg-neutral-900 border border-neutral-600 rounded-md">R</kbd>.
              </p>
            )}
            {(os === 'ios' || os === 'android') && (
              <p className="text-center">
                Close all browser tabs for this site, then go to your browser settings and clear the cache and site data.
              </p>
            )}
          </div>
          
          <p className="max-w-lg mb-6 text-neutral-400">
            If the problem persists after a hard refresh, please contact support.
          </p>

          <a 
            href={mailtoLink}
            className="px-6 py-3 bg-sky-600 text-white font-semibold rounded-lg hover:bg-sky-700 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-neutral-900 focus:ring-sky-500"
          >
            Email Support
          </a>

          {this.state.error && (
            <details className="mt-8 text-left max-w-lg w-full bg-neutral-800/50 p-3 rounded-md border border-neutral-700">
              <summary className="cursor-pointer text-sm text-neutral-400">Error Details</summary>
              <pre className="mt-2 text-xs text-red-400 overflow-auto whitespace-pre-wrap">
                {this.state.error.toString()}
                {this.state.error.stack && `\n\n${this.state.error.stack}`}
              </pre>
            </details>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
// --- END OF FILE src/components/ErrorBoundary.tsx ---