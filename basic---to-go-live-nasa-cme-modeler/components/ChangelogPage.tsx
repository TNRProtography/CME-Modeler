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
    <main className="relative h-full w-full overflow-y-auto bg-black text-neutral-100">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_20%_10%,rgba(14,165,233,0.18),transparent_32%),radial-gradient(circle_at_80%_20%,rgba(168,85,247,0.16),transparent_30%),linear-gradient(180deg,rgba(0,0,0,0.1),#000_78%)]" />
      <div className="relative mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8 lg:py-10">
        <section className="overflow-hidden rounded-3xl border border-white/10 bg-white/[0.04] shadow-2xl backdrop-blur-xl">
          <div className="border-b border-white/10 bg-gradient-to-r from-sky-500/15 via-indigo-500/15 to-fuchsia-500/15 p-5 sm:p-8">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-sky-300/20 bg-sky-400/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-sky-200">
              <span className="h-2 w-2 rounded-full bg-emerald-300 shadow-[0_0_16px_rgba(110,231,183,0.9)]" />
              Spot The Aurora
            </div>
            <h1 className="text-3xl font-black tracking-tight text-white sm:text-5xl">Change Log</h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-neutral-300 sm:text-base">
              Follow the major releases, fixes, visual upgrades, and forecasting improvements that have shaped Spot The Aurora.
            </p>
          </div>

          <div className="p-4 sm:p-6 lg:p-8">
            <div className="space-y-6">
              {changelogEntries.map((entry, index) => (
                <article key={`${entry.version}-${entry.date}`} className="group relative overflow-hidden rounded-3xl border border-white/10 bg-neutral-950/70 p-4 shadow-xl transition-all hover:border-sky-300/30 hover:bg-neutral-900/80 sm:p-6">
                  <div className="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-sky-400 via-indigo-400 to-fuchsia-400" />
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full border border-sky-300/25 bg-sky-400/10 px-3 py-1 text-xs font-bold uppercase tracking-[0.2em] text-sky-100">{entry.version}</span>
                        {index === 0 && <span className="rounded-full border border-emerald-300/25 bg-emerald-400/10 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-emerald-100">Latest</span>}
                      </div>
                      <h2 className="mt-3 text-xl font-black text-white sm:text-2xl">{entry.title}</h2>
                    </div>
                    <time className="shrink-0 rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm font-semibold text-neutral-300">{entry.date}</time>
                  </div>

                  {entry.intro && <p className="mt-4 max-w-4xl text-sm leading-6 text-neutral-300">{entry.intro}</p>}

                  <div className="mt-5 grid gap-4 lg:grid-cols-2">
                    {entry.sections.map((section) => (
                      <section key={section.title} className="rounded-2xl border border-white/10 bg-black/30 p-4">
                        <h3 className="text-sm font-extrabold uppercase tracking-[0.2em] text-cyan-200">{section.title}</h3>
                        <ul className="mt-3 space-y-2 text-sm leading-6 text-neutral-300">
                          {section.items.map((item) => (
                            <li key={item} className="flex gap-2">
                              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-sky-300 shadow-[0_0_10px_rgba(125,211,252,0.85)]" />
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
        </section>
      </div>
    </main>
  );
};

export default ChangelogPage;
