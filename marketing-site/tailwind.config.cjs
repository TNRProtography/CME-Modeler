/** The app's components are written with Tailwind classes. The marketing site
 *  embeds those components, so it needs the same utilities available.
 *
 *  preflight is OFF on purpose: we only want the utility classes, not
 *  Tailwind's base reset, which would fight the site's own stylesheet. */
module.exports = {
  corePlugins: { preflight: false },
  /* Every utility is emitted as "body .class". The site's own stylesheet
     loads after this one and has rules on the same class names the app uses -
     .card, .grid - and on bare elements; one more level of specificity lets
     the app's utilities win inside the embeds. The static pages use no
     utilities, so nothing outside the embeds changes. Under body rather than
     a wrapper class so that the app's modals, which portal to <body>, get
     them too. */
  important: 'body',
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
