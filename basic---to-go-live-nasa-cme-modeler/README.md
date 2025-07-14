# TNR Protography - Spot The Aurora: A Real-Time Space Weather Dashboard & CME Modeler

![TNR Protography Logo](https://www.tnrprotography.co.nz/uploads/1/3/6/6/136682089/white-tnr-protography-w_orig.png)

A comprehensive web application designed to help users track and visualize space weather phenomena affecting Earth. It features a 3D Coronal Mass Ejection (CME) modeler, a live aurora forecast dashboard with real-time solar wind data, and a solar activity monitor. A unique community-driven aurora sighting map allows users to report and view local aurora visibility.

## Features

*   **3D CME Modeler**:
    *   Visualize Coronal Mass Ejections (CMEs) from NASA's DONKI API in a 3D solar system.
    *   Interactive controls for time range (24H, 3D, 7D), view modes (Top-Down, Side), and focus targets (Sun, Earth).
    *   Ability to select and model individual CMEs or view all simultaneously.
    *   Dynamic particle effects for CMEs with speed-based coloring and density.
    *   Impact detection and subtle visual effects on Earth's atmosphere/aurora.
    *   Toggleable planet labels, extra planets (Mercury, Venus, Mars), and Lagrange Point 1 (L1).

*   **Aurora Forecast Dashboard**:
    *   Proprietary "Spot The Aurora Forecast" score for the West Coast of New Zealand.
    *   Real-time solar wind data (Speed, Density, IMF Bt, IMF Bz) from NOAA SWPC.
    *   Hemispheric Power and Moon Illumination data.
    *   Interactive charts for historical solar wind and magnetic field data.
    *   Live cloud cover map (Windy.com iframe).
    *   Queenstown live camera feed (iframe).

*   **Spotting The Aurora (Community Sighting Map)**:
    *   Interactive Leaflet map focused on the South Island of NZ.
    *   Users can report current aurora visibility based on their location.
    *   Report categories: Naked Eye 👁️, Phone Camera 📱, DSLR/Mirrorless 📷, Cloudy ☁️, Nothing ❌.
    *   User's name is saved locally for convenience (only cached data).
    *   GPS-based or manual pin placement for location.
    *   Only one report allowed per user per 60 minutes.
    *   All individual reports are displayed on the map without clustering, with newer reports overlaying older ones.
    *   Table of the 5 latest reports.

*   **Solar Activity Dashboard**:
    *   Real-time GOES X-ray Flux data with historical charts.
    *   Latest SUVI 131Å and 304Å solar images from NOAA.
    *   Information on recent solar flares (from NASA DONKI) and active regions/sunspots (from NOAA).
    *   Modal viewer for images/animations from external sources (HUXT, WSA-ENLIL).

*   **Always Fresh Data**: All dashboard and modeler data is fetched live and refreshed every minute; the entire application shell is designed not to be cached by the service worker or browser.

## Technologies Used

*   **Frontend**: React (with TypeScript)
*   **Styling**: Tailwind CSS
*   **3D Visualization**: Three.js, GSAP (for animations), OrbitControls
*   **Mapping**: Leaflet, React-Leaflet
*   **Charting**: Chart.js, react-chartjs-2, chartjs-plugin-annotation
*   **Data Sources**:
    *   NASA DONKI API (CMEs, Solar Flares)
    *   NOAA SWPC (Solar Wind, Magnetic Field, SUVI Images, Solar Regions)
    *   TNR Protography Cloudflare Workers (Aurora Forecast, Aurora Sightings API Backend, ENLIL Proxy)
    *   Windy.com (Cloud Cover Map)
    *   Roundshot (Queenstown Live Camera)
*   **Build Tool**: Vite

## Getting Started

Follow these steps to get the project up and running on your local machine.

### Prerequisites

*   Node.js (LTS version recommended)
*   npm or Yarn

### 1. Clone the repository

```bash
git clone [repository_url_here]
cd basic---to-go-live-nasa-cme-modeler


2. Install dependencies
npm install
# or
yarn install

3. Configure NASA API Key
Obtain a free API key from the NASA API website.
Create a file named .env.local in the root directory of the project.
Add your NASA API key to this file:
VITE_NASA_API_KEY=YOUR_NASA_API_KEY_HERE
Replace YOUR_NASA_API_KEY_HERE with your actual key.

4. Run the app locally
npm run dev
# or
yarn dev

The application will typically be accessible at http://localhost:5173 (or another port if 5173 is in use).
Usage
The application features three main sections, accessible via the navigation buttons in the header bar:
Aurora Forecast: This is the primary dashboard for live aurora conditions, featuring the custom "Spot The Aurora Forecast" score, real-time solar wind data, and local conditions for New Zealand's West Coast.
Spotting The Aurora (Map): Below the main forecast, you'll find an interactive map. Click on the map to set your location (or allow GPS access), select your sighting status (Naked Eye, Phone Camera, DSLR/Mirrorless, Cloudy, Nothing), enter your name, and submit. Your name will be saved locally. Reports are visible to all users and update automatically every minute. A detailed guide on reporting is available by clicking the ? icon next to the "Spotting The Aurora" title.
Solar Activity: Provides a deeper dive into solar events, including X-ray flux, latest SUVI solar images, and details on recent solar flares and active regions/sunspots. Click on images (like the SUVI or ACE EPAM charts) for a full-screen viewer.
CME Modeler: Explore Coronal Mass Ejections in a 3D interactive solar system.
Controls (Left Panel): Adjust the date range of CMEs, change the camera's view (top-down, side), and focus on the Sun or Earth. You can also toggle visibility for labels, other planets (Mercury, Venus, Mars), and Earth's Moon/L1 point.
CME List (Right Panel): Browse available CMEs. Select one to model its individual trajectory, or choose "Show All" to see a live simulation of all CMEs.
Timeline Controls (Bottom): When viewing "Show All" CMEs, use the timeline to play, pause, scrub, or step through the simulation. A red marker indicates the current real-time position, with the area to its right representing a future forecast.
Interaction Mode: The top-right of the canvas has a toggle button to switch between "Move Mode" (default camera control: left-click and drag to rotate, right-click and drag to pan, scroll wheel to zoom) and "Select Mode" (pauses camera movement via left-click, allowing you to click on CME particles to view details).
Data Freshness Policy
This application is designed for maximum data freshness:
Live Data: All data displayed in the "Aurora Forecast" and "Solar Activity" dashboards, as well as the CME data, is fetched live from various APIs.
Automatic Refresh: Data on the dashboards automatically refreshes every minute to ensure you always have the most current information.
No Application Caching: The application's files (HTML, JavaScript, CSS) and API responses are explicitly prevented from being cached by your browser or the service worker. This means every time you open the app, you download the absolute latest version from the server.
Local Storage Exception: The only data persistently stored on your device is your preferred name for aurora sighting reports, which is saved in your browser's local storage for convenience.
Acknowledgements & Data Sources
This project leverages publicly available data from several excellent sources, providing critical information for space weather monitoring and aurora forecasting:
NASA DONKI: Coronal Mass Ejections (CME) and Solar Flare data.
NOAA SWPC: Solar Wind (ACE/DSCOVR), Interplanetary Magnetic Field (IMF), SUVI Solar Images, and Solar Region data.
TNR Protography: Proprietary Aurora Forecast algorithm, Aurora Sighting API backend, and API proxy services for ENLIL and Hemispheric Power data.
Windy.com: Live Cloud Cover map iframe.
Roundshot: Queenstown Live Camera iframe.
Developed with ❤️ by TNR Protography.