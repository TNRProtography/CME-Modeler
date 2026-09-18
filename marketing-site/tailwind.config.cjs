/** The app's components are written with Tailwind classes. The marketing site
 *  embeds those components, so it needs the same utilities available.
 *
 *  preflight is OFF on purpose: we only want the utility classes, not
 *  Tailwind's base reset, which would fight the site's own stylesheet. */
module.exports = {
  corePlugins: { preflight: false },
  content: [
    './src/**/*.{ts,tsx}',
    './*.html',
    '../basic---to-go-live-nasa-cme-modeler/components/**/*.{ts,tsx}',
    '../basic---to-go-live-nasa-cme-modeler/hooks/**/*.{ts,tsx}',
    '../basic---to-go-live-nasa-cme-modeler/utils/**/*.{ts,tsx}',
    '../basic---to-go-live-nasa-cme-modeler/App.tsx'
  ],
  theme: { extend: {} },
  plugins: []
};
