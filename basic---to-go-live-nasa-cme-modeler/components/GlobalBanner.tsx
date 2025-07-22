import React from 'react';
import CloseIcon from './icons/CloseIcon'; // Assuming CloseIcon exists in your icons directory

interface GlobalBannerProps {
  isSiteDownAlert?: boolean; // <-- NEW: Prop for the site down message
  isFlareAlert: boolean;
  flareClass?: string; // e.g., "M1.5", "X2.1"
  isAuroraAlert: boolean;
  auroraScore?: number;
  isSubstormAlert: boolean;
  substormText?: string; // e.g., "The magnetic field is stretching..."
}

const GlobalBanner: React.FC<GlobalBannerProps> = ({
  isSiteDownAlert, // <-- NEW
  isFlareAlert,
  flareClass,
  isAuroraAlert,
  auroraScore,
  isSubstormAlert,
  substormText,
}) => {
  // --- NEW: Handle the site-down alert as a special, overriding case ---
  // If this alert is active, we show it exclusively and it cannot be closed.
  if (isSiteDownAlert) {
    return (
      <div className="bg-gradient-to-r from-red-600 via-orange-500 to-yellow-500 text-white text-sm font-semibold p-3 text-center relative z-50 flex items-center justify-center">
        <div className="container mx-auto flex items-center justify-center gap-2">
          <span role="img" aria-label="Warning">⚠️</span>
          <span>
            Due to site being hammered, the data is currently down. We hope to have this fixed by tomorrow
          </span>
        </div>
      </div>
    );
  }

  // --- Original component logic for other alerts ---
  const [isVisible, setIsVisible] = React.useState(true);
  const [closedManually, setClosedManually] = React.useState(false);

  React.useEffect(() => {
    setIsVisible((isFlareAlert || isAuroraAlert || isSubstormAlert) && !closedManually);
  }, [isFlareAlert, isAuroraAlert, isSubstormAlert, closedManually]);

  if (!isVisible) return null;

  const handleClose = () => {
    setIsVisible(false);
    setClosedManually(true);
  };

  return (
    <div className="bg-gradient-to-r from-purple-800 via-indigo-600 to-sky-600 text-white text-sm font-semibold p-3 text-center relative z-50 flex items-center justify-center">
      <div className="container mx-auto flex flex-col sm:flex-row items-center justify-center gap-2">
        {isFlareAlert && (
          <span className="flex items-center gap-1">
            <span role="img" aria-label="Solar Flare">💥</span>
            <strong>Solar Flare Alert:</strong> An active {flareClass} flare is in progress. Higher-class flares (M, X) can cause radio blackouts and enhanced aurora!
          </span>
        )}
        {isAuroraAlert && (
          <span className="flex items-center gap-1">
            {isFlareAlert && <span className="hidden sm:inline">|</span>}
            <span role="img" aria-label="Aurora">✨</span>
            <strong>Aurora Forecast:</strong> Spot The Aurora Forecast is at {auroraScore?.toFixed(1)}%! Keep an eye on the southern sky!
          </span>
        )}
        {isSubstormAlert && (
          <span className="flex items-center gap-1">
            {(isFlareAlert || isAuroraAlert) && <span className="hidden sm:inline">|</span>}
            <span role="img" aria-label="Magnetic Field">⚡</span>
            <strong>Substorm Watch:</strong> Magnetic field is stretching! {substormText}
          </span>
        )}
      </div>
      <button
        onClick={handleClose}
        className="absolute top-1 right-2 p-1 text-white hover:bg-white/20 rounded-full transition-colors"
        title="Dismiss Alert"
      >
        <CloseIcon className="w-4 h-4" />
      </button>
    </div>
  );
};

export default GlobalBanner;