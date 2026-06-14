import React from 'react';

type ChangelogSection = {
  title: string;
  items: string[];
};

type ChangelogEntry = {
  version: string;
  title: string;
  date: string;
  intro?: string;
  sections: ChangelogSection[];
};

const changelogEntries: ChangelogEntry[] = [
  {
    version: 'v1.7',
    title: 'Night Mode, JMAP Imagery and Spacecraft Data Upgrades',
    date: '14 Jun 2026',
    intro: 'This update expands low-light viewing, adds new solar imagery sources, improves EPAM detection, and gives users more context around seasonal and magnetotail effects.',
    sections: [
      {
        title: 'New Features',
        items: [
          'Added new Night Mode for easier viewing while preserving dark adaptation.',
          'Added new JMAP STEREO imagery.',
          'Added SOLAR-1 and IMAP EPAM data sources.',
          'Added an Equinox Boost section that uses the Russell-McPherron effect to show how much aurora may be influenced by Earth’s tilt.',
          'Added a new magnetotail section showing magnetosphere compression and an estimate of the substorm size if the tail snaps.',
          'Added a Download GIF button for the currently selected timeframe and playback speed for SUVI imagery and coronagraph imagery.',
          'Added source indicators on solar wind data, such as ACE, SOLAR-1, and IMAP.',
        ],
      },
      {
        title: 'Data Improvements',
        items: [
          'Re-worked the EPAM engine for more accurate detection based on the last 7 days of EPAM activity.',
        ],
      },
    ],
  },
  {
    version: 'v1.6',
    title: 'Bug Fixes and MANY Enhancements',
    date: '23 Apr 2026',
    intro: 'A major update with new forecasting tools, visualization upgrades, stronger notifications, and a wide range of fixes across the app.',
    sections: [
      {
        title: 'New Features',
        items: [
          'Coronal Hole and HSS Visualization — a world-first feature that complements the live 3D CME Visualization.',
          'Difference imagery for SUVI and coronagraph imagery, fine-tuned to reveal detail that is normally easy to miss.',
          'What to Expect panel with Now, 15 minute, and 30 minute guidance based on real-time L1 satellite data, plus 1 and 2 hour forecast windows.',
          'Expanded notifications, including configurable daily alerts by aurora visibility level: eye, phone, or camera.',
          '3 day NOAA forecast with sun and moon visualization, with each bar tailored to your location.',
          'Solar Wind Summary combining interplanetary shocks and up to 24 hours of solar wind data in one place.',
          'Auroral Oval view-line guidance so users can see where aurora may be visible or overhead.',
        ],
      },
      {
        title: 'Bug Fixes',
        items: [
          'Fixed existing notifications failing to send.',
          'Fixed the sunspot tracker.',
          'Restored close-up imagery.',
          'Reload page data now refreshes everything.',
          'Expanded aurora reporting locations from 73 to more than 1,000 towns and areas.',
          'Fixed coronagraph imagery failing to load.',
          'CMEs now use a more realistic shape instead of a large cone.',
        ],
      },
    ],
  },
  {
    version: 'v1.5',
    title: 'A MASSIVE VISUAL & DATA UPGRADE!',
    date: '23 Feb 2026',
    intro: 'One of the app’s biggest transformations yet: a modernised interface, upgraded solar imagery, richer solar wind and IMF data, and better reliability.',
    sections: [
      {
        title: 'Fully Modernised Experience',
        items: [
          'Modern UI overhaul for a cleaner, smarter way to read complex space weather data at a glance.',
          'Enhanced visual cues, colour signals, and status prompts for faster interpretation.',
          'Improved solar imagery and summaries with sharper visuals and clearer breakdowns.',
        ],
      },
      {
        title: 'Expanded Solar Wind & IMF Data',
        items: [
          'More solar wind and IMF parameters for better visibility of what is driving auroral potential.',
          'X-ray flux history extended from 24 hours to 7 days.',
          'Proton flux history extended to 7 days for better radiation-event context.',
          'Added Kyoto Dst Index for improved geomagnetic storm tracking and long-duration storm analysis.',
        ],
      },
      {
        title: 'Scrubbable Solar Imagery Animation',
        items: [
          'Interactive SUVI animation with frame-by-frame scrubbing.',
          'Support for SUVI 304, SUVI 131, and SUVI 195 imagery.',
        ],
      },
      {
        title: 'Performance & Reliability',
        items: [
          'Faster loading, smoother transitions, and more responsive dashboards.',
          'Improved resilience when upstream data files are bad or missing, preventing blank screens and missing panels.',
        ],
      },
    ],
  },
  {
    version: 'v1.1',
    title: 'New Views, Notifications and More!',
    date: '22 Sep 2025',
    intro: 'A large quality-of-life release focused on making aurora chasing simpler, smarter, and more powerful.',
    sections: [
      {
        title: 'All-New Simple View',
        items: [
          'Forecast now defaults to Simple View, showing the most important aurora guidance at a glance.',
          'Large forecast score with clear visibility status levels from huge aurora visible through no aurora expected.',
          'Actionable advice such as “GO NOW”, “WORTH A LOOK”, or “STAY INDOORS”.',
          'Confidence gauge now appears only when the aurora score is 10% or higher.',
          'Community Aurora Sightings map is now core to Simple View.',
          'Advanced View remains available for detailed charts and graphs.',
        ],
      },
      {
        title: 'Interplanetary Shock & Solar Flare Alerts',
        items: [
          'New Interplanetary Shocks panel on the Solar Activity dashboard.',
          'High-priority red banner when a shock arrives.',
          'Shock banners and notifications include speed, Bt, and Bz data.',
        ],
      },
      {
        title: 'Enhanced Data & Dashboards',
        items: [
          'Official forecast model modal for WSA-ENLIL, HUXT, and other agency models.',
          '24-hour Solar Activity summary showing peak X-ray flux, flare counts by class, and peak proton flux.',
          'Improved sighting reports, including clear-sky reports by camera type.',
        ],
      },
      {
        title: 'App Improvements',
        items: [
          'Better install guidance for users inside Facebook or Instagram browsers.',
          'Expanded first-visit and CME Modeler tutorials.',
          'More robust proxy-backed data services for faster, more reliable loading.',
        ],
      },
    ],
  },
  {
    version: 'v1.0',
    title: 'Notifications and So Much More!',
    date: '31 Aug 2025',
    intro: 'A major update with new tutorials, performance improvements, SEO enhancements, and a rebuilt push notification system.',
    sections: [
      {
        title: 'App Experience',
        items: [
          'Added a dedicated CME Visualization tutorial explaining the timeline, view controls, and screenshot tool.',
          'Rebuilt push notifications with user-specific preferences and diagnostics.',
          'Optimised the main HTML for SEO, first-load performance, and richer social sharing previews.',
          'Improved mobile header navigation with compact buttons and clearer labels.',
        ],
      },
      {
        title: 'Aurora Forecast Dashboard',
        items: [
          'Replaced the substorm heuristic with a physics-based predictive forecast engine.',
          'Added real-time substorm likelihood, predicted time windows, and actionable advice.',
          'Added a 24-hour activity summary with highest aurora score and substorm watch periods.',
          'Added more detailed “Nothing to see” reporting by naked eye, phone, or DSLR.',
          'Improved data parsing resilience for NOAA solar wind and magnetic field feeds.',
        ],
      },
      {
        title: 'CME Visualization Dashboard',
        items: [
          'Added high-quality screenshot downloads with labels, timestamp, and SpotTheAurora.co.nz watermark.',
          'Timeline playback now resets to the beginning when replaying from the end.',
          'Redesigned on-canvas controls with clearer mobile labels.',
          'Preloaded Official CME Models imagery so the modal opens faster.',
        ],
      },
    ],
  },
  {
    version: 'v0.5 beta',
    title: 'Enhancements and Little Fixes',
    date: '11 Aug 2025',
    sections: [
      {
        title: 'Updates',
        items: [
          'Added individual CME modelling through the available CME panel.',
          'Added project support details and time-spent counter.',
          'Changed moon reduction so 100% illumination reduces the score by 75GW, scaling linearly as illumination drops.',
          'Added substorm forecast percentage and expected timing.',
          'Improved banner behaviour with context-aware navigation.',
        ],
      },
    ],
  },
  {
    version: '4 Aug 2025',
    title: 'Forecast Link Fixes',
    date: '4 Aug 2025',
    sections: [
      { title: 'Fixes', items: ['Fixed broken links for the HUXT forecast and HUXT forecast descriptions.'] },
    ],
  },
  {
    version: 'v0.3 beta',
    title: 'Minor Bug Fixes',
    date: '29 Jul 2025',
    sections: [
      {
        title: 'Fixes',
        items: [
          'Fixed the base score not populating when the Spot The Aurora Forecast was 0.',
          'Removed the Motueka webcam because it was not behaving reliably.',
        ],
      },
    ],
  },
  {
    version: 'v0.2 beta',
    title: 'First Batch of Changes',
    date: '25 Jul 2025',
    sections: [
      {
        title: 'Aurora Forecast Dashboard',
        items: [
          'Personalised forecast score by device latitude for more accurate local predictions in New Zealand.',
          'New near-sunset aurora activity banner that considers moon illumination.',
          'Expanded live camera feeds across New Zealand.',
          'More detailed camera settings guidance for Android, iPhone, DSLR, and mirrorless cameras.',
          'Improved moon and sun event display on the forecast trend chart.',
          'Toggleable sunrise, sunset, moonrise, and moonset chart annotations.',
          'Moved Interplanetary Shock Events into a dedicated Aurora Forecast Dashboard section.',
        ],
      },
      {
        title: 'Solar Activity Dashboard',
        items: [
          'Added Current Status summary for solar activity.',
          'Added direct notifications for M5+, X1+, S1, and S3+ events.',
          'Added last-updated timestamps across key data sections.',
          'Refined solar imagery options around key SUVI and SDO images.',
          'Added “View in CME Visualization” from solar flare listings.',
          'Improved the CCOR1 video section with a clearer header and info button.',
        ],
      },
      {
        title: 'CME Visualization',
        items: [
          'Improved orbit visuals with solid thin tubes.',
          'Simplified interaction so the 3D view stays in Move Mode.',
          'Improved mobile positioning for controls and CME list side panels.',
        ],
      },
      {
        title: 'Settings & User Experience',
        items: [
          'Added Help & Support access to tutorials and email support.',
          'Added app version in the Settings footer.',
          'Temporarily replaced notification-category customisation with a “Custom Alerts Coming Soon” message.',
          'Polished header navigation and added animated navigation icons.',
          'Improved media viewer video controls and tutorial back navigation.',
        ],
      },
    ],
  },
];

const ChangelogPage: React.FC = () => {
  return (
    <main className="h-full w-full overflow-y-auto bg-black text-neutral-300 styled-scrollbar">
      <div className="mx-auto max-w-4xl px-4 py-5 sm:px-6 sm:py-8">
        <header className="mb-6 border-b border-neutral-800 pb-5">
          <p className="text-xs font-semibold uppercase tracking-widest text-sky-400">Spot The Aurora</p>
          <h1 className="mt-2 text-2xl font-bold text-neutral-100 sm:text-3xl">Change Log</h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-neutral-400">
            Product updates, fixes, and forecasting improvements for the Spot The Aurora app.
          </p>
        </header>

        <div className="space-y-5">
          {changelogEntries.map((entry, index) => (
            <article key={`${entry.version}-${entry.date}`} className="rounded-lg border border-neutral-800 bg-neutral-950/80 shadow-xl">
              <div className="border-b border-neutral-800 p-4 sm:p-5">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-semibold uppercase tracking-wider text-sky-400">{entry.version}</span>
                      {index === 0 && <span className="rounded border border-emerald-800/80 bg-emerald-950/50 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-emerald-300">Latest</span>}
                    </div>
                    <h2 className="mt-1 text-xl font-semibold text-neutral-100">{entry.title}</h2>
                  </div>
                  <time className="text-sm text-neutral-500">{entry.date}</time>
                </div>
                {entry.intro && <p className="mt-3 text-sm leading-relaxed text-neutral-400">{entry.intro}</p>}
              </div>

              <div className="divide-y divide-neutral-800">
                {entry.sections.map((section) => (
                  <section key={section.title} className="p-4 sm:p-5">
                    <h3 className="text-sm font-semibold uppercase tracking-wider text-neutral-200">{section.title}</h3>
                    <ul className="mt-3 space-y-2 text-sm leading-relaxed text-neutral-400">
                      {section.items.map((item) => (
                        <li key={item} className="flex gap-2">
                          <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-sky-500" />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            </article>
          ))}
        </div>
      </div>
    </main>
  );
};

export default ChangelogPage;
