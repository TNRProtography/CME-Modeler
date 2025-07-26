// --- START OF FILE src/utils/settingsUtils.ts (NEW FILE) ---

import { SavedLocation } from "../types"; // Import SavedLocation interface

// --- CONSTANTS FOR LOCAL STORAGE KEYS ---
export const LOCATION_PREF_KEY = 'location_preference_use_gps_autodetect';
export const SAVED_LOCATIONS_KEY = 'saved_locations';
export const ACTIVE_LOCATION_KEY = 'active_location_id';
export const THEME_KEY = 'app_theme';

// --- DASHBOARD SECTION VISIBILITY KEYS ---
// Forecast Dashboard
export const FD_TIPS_VISIBLE_KEY = 'fd_tips_visible';
export const FD_CAMERA_SETTINGS_VISIBLE_KEY = 'fd_camera_settings_visible';
export const FD_AURORA_SIGHTINGS_VISIBLE_KEY = 'fd_aurora_sightings_visible';
export const FD_FORECAST_TREND_VISIBLE_KEY = 'fd_forecast_trend_visible';
export const FD_GAUGES_VISIBLE_KEY = 'fd_gauges_visible';
export const FD_GOES_MAG_VISIBLE_KEY = 'fd_goes_mag_visible';
export const FD_IPS_VISIBLE_KEY = 'fd_ips_visible';
export const FD_CLOUD_MAP_VISIBLE_KEY = 'fd_cloud_map_visible';
export const FD_QUEENSTOWN_CAM_VISIBLE_KEY = 'fd_queenstown_cam_visible'; // Now 'FD_LIVE_CAMERAS_VISIBLE_KEY' effectively
export const FD_EPAM_VISIBLE_KEY = 'fd_epam_visible';

// Solar Activity Dashboard
export const SAD_SOLAR_IMAGERY_VISIBLE_KEY = 'sad_solar_imagery_visible';
export const SAD_XRAY_FLUX_VISIBLE_KEY = 'sad_xray_flux_visible';
export const SAD_SOLAR_FLARES_VISIBLE_KEY = 'sad_solar_flares_visible';
export const SAD_CCOR1_VIDEO_VISIBLE_KEY = 'sad_ccor1_video_visible';
export const SAD_PROTON_FLUX_VISIBLE_KEY = 'sad_proton_flux_visible';

// --- UTILITY FUNCTIONS ---

/**
 * Loads the visibility settings for all dashboard sections from localStorage.
 * Defaults to true if a setting is not found.
 * @returns An object containing two records: `fd` for Forecast Dashboard and `sad` for Solar Activity Dashboard.
 */
export const loadDashboardVisibilitySettings = () => {
    const defaultFdVisibility = {
        [FD_TIPS_VISIBLE_KEY]: true,
        [FD_CAMERA_SETTINGS_VISIBLE_KEY]: true,
        [FD_AURORA_SIGHTINGS_VISIBLE_KEY]: true,
        [FD_FORECAST_TREND_VISIBLE_KEY]: true,
        [FD_GAUGES_VISIBLE_KEY]: true,
        [FD_GOES_MAG_VISIBLE_KEY]: true,
        [FD_IPS_VISIBLE_KEY]: true,
        [FD_CLOUD_MAP_VISIBLE_KEY]: true,
        [FD_QUEENSTOWN_CAM_VISIBLE_KEY]: true,
        [FD_EPAM_VISIBLE_KEY]: true,
    };
    const defaultSadVisibility = {
        [SAD_SOLAR_IMAGERY_VISIBLE_KEY]: true,
        [SAD_XRAY_FLUX_VISIBLE_KEY]: true,
        [SAD_SOLAR_FLARES_VISIBLE_KEY]: true,
        [SAD_CCOR1_VIDEO_VISIBLE_KEY]: true,
        [SAD_PROTON_FLUX_VISIBLE_KEY]: true,
    };

    const loadSettingsForKeys = (keys: Record<string, boolean>) => {
        return Object.fromEntries(
            Object.keys(keys).map(key => [
                key,
                localStorage.getItem(key) === null ? keys[key] : JSON.parse(localStorage.getItem(key)!)
            ])
        );
    };

    return {
        fd: loadSettingsForKeys(defaultFdVisibility),
        sad: loadSettingsForKeys(defaultSadVisibility)
    };
};

/**
 * Gets the currently active saved location or null if GPS auto-detect is enabled.
 * @returns The active SavedLocation object or null.
 */
export const getActiveSavedLocation = (): SavedLocation | null => {
    const useGpsAutoDetect = localStorage.getItem(LOCATION_PREF_KEY);
    if (useGpsAutoDetect === 'true') {
        return null; // GPS auto-detect is active, no specific saved location
    }

    const activeLocationId = localStorage.getItem(ACTIVE_LOCATION_KEY);
    if (!activeLocationId) {
        return null; // No active saved location selected
    }

    const savedLocations = JSON.parse(localStorage.getItem(SAVED_LOCATIONS_KEY) || '[]') as SavedLocation[];
    return savedLocations.find(loc => loc.id === activeLocationId) || null;
};

// --- END OF FILE src/utils/settingsUtils.ts (NEW FILE) ---