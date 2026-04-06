// --- START OF FILE src/components/docs/DocNotifications.tsx ---
import React from 'react';
import { Card, CardGrid, Formula, Section, SubHeading, DataTable } from './DocPrimitives';

const DocNotifications: React.FC = () => (
  <Section
    id="s08"
    number="08"
    title="Push Notification System"
    subtitle="All notifications are opt-in and category-specific. No third-party push service is used. The complete RFC 8291 Web Push stack — VAPID JWT signing, ECDH key agreement, AES-128-GCM payload encryption — is implemented from scratch in the Push Worker using the Web Crypto API. Zero npm dependencies."
  >
    <SubHeading color="text-purple-400">Notification Categories — Exact Trigger Conditions</SubHeading>
    <DataTable
      headers={['Category', 'Trigger condition', 'Location-aware', 'Default']}
      rows={[
        ['visibility-dslr',  'Aurora oval equatorward boundary reaches subscriber\'s DSLR visibility horizon. Threshold adjusted for moon illumination: <20% → base offsets; 40–60% → shifted conservatively; >80% → DSLR suppressed entirely.', 'Yes — per GPS', 'On'],
        ['visibility-phone', 'Oval within phone-camera visibility range. Suppressed at moon >80%; takes DSLR\'s role at 60–80%.', 'Yes — per GPS', 'On'],
        ['visibility-naked', 'Oval equatorward boundary within ~5° geomagnetic lat of subscriber. Threshold tightens with moon: base 5°; >40% → 8°; >60% → 10°; >80% → 12°.', 'Yes — per GPS', 'On'],
        ['overnight-watch',  'Nightly summary between 18:00–21:00 NZST. Send condition based on user mode: every-night (score ≥0), camera (≥25), phone (≥40), eye (≥55). Once per NZ calendar day per subscriber.', 'NZ timezone', 'On'],
        ['flare-event',      'Solar flare confirmed at peak ≥M1.0. "Confirmed" = flux still ≥M1 after 5 min of declining trend (avoids false peaks).', 'No', 'On'],
        ['shock-ff',         'Fast Forward Shock — speed↑, density↑, temp↑, Bt↑ across median pre/post windows (18/12 min). Classic CME arrival signature. 4-hour cooldown.', 'No', 'On'],
        ['shock-sf',         'Slow Forward Shock — speed↑, density↑, temp↑, Bt↓. Weaker compression, often SIR or CME flank. 4-hour cooldown.', 'No', 'On'],
        ['shock-fr',         'Fast Reverse Shock — speed↑, density↓, temp↓, Bt↓. CME trailing edge or HSS rear. 4-hour cooldown.', 'No', 'On'],
        ['shock-sr',         'Slow Reverse Shock — speed↑, density↓, temp↓, Bt↑. Uncommon trailing rarefaction. 4-hour cooldown.', 'No', 'On'],
        ['shock-imf',        'IMF Enhancement — |Bt| ≥4 nT or |Bz| ≥8 nT jump with minimal plasma change. Sector boundary or embedded structure. 4-hour cooldown.', 'No', 'On'],
        ['admin-broadcast',  'Manual — sent by admin via push worker broadcast endpoint. Bypasses Banner API (Cloudflare worker-to-worker restriction, error 1042).', 'No', 'On'],
      ]}
    />

    <SubHeading color="text-purple-400">Location-Aware Visibility Geometry — IGRF-13</SubHeading>
    <Card>
      <p>For the three visibility tier notifications, the auroral oval boundary is estimated from Substorm Risk Worker Newell coupling averages, then compared to each subscriber's geomagnetic latitude:</p>
      <Formula note="The IGRF-13 dipole pole position (80.65°N, 72.68°W geographic) correctly accounts for the fact that the geomagnetic and geographic poles do not coincide — which matters significantly for New Zealand's longitude.">
{`// Oval boundary in geomagnetic latitude degrees
newell = max(newell_avg_60m, newell_avg_30m × 0.85)

boundary_gmag = −(65.5 − newell / 1800)
  clamped to [−76°, −44°] geomagnetic lat
  bay_onset flag → further clamp to −47.2°

// Geographic → geomagnetic lat conversion (IGRF-13)
POLE_LAT_RAD = 80.65° × π/180
POLE_LON_RAD = −72.68° × π/180

sin(gmag_lat) = sin(geo_lat) × sin(POLE_LAT_RAD)
              + cos(geo_lat) × cos(POLE_LAT_RAD)
                × cos(geo_lon − POLE_LON_RAD)

// Visibility horizon extends equatorward of boundary
visDeg = 9.0 + (score/100) × 16.0   → range [9°, 25°]

visHorizon_gmag = boundary_gmag + visDeg
distToVis       = subscriber_gmag − visHorizon_gmag

// DSLR fires when:  distToVis ≤ −3°
// Phone fires when: distToVis ≤ −1°
// Naked fires when: distToBoundary ≤ 5°
// All thresholds moon-adjusted`}
      </Formula>
    </Card>

    <SubHeading color="text-purple-400">Push Cryptography — RFC 8291 Web Push from Scratch</SubHeading>
    <CardGrid cols={2}>
      <Card icon="🔐" title="VAPID JWT (RFC 8292)">
        <p>Every push request is authenticated with a signed JWT:</p>
        <Formula note="The JWT is generated per delivery using crypto.subtle.sign({ name:'ECDSA', hash:'SHA-256' }). No third-party VAPID library.">
{`Header:  { typ:"JWT", alg:"ES256" }
Payload: {
  aud: push_endpoint_origin,
  exp: now + 12h,
  sub: VAPID_SUBJECT
}

Signature: ECDSA P-256 using VAPID_PRIVATE_KEY
  (stored in Worker Secrets — never in KV or logs)

Authorization: vapid t={jwt}, k={VAPID_PUBLIC_KEY}`}
        </Formula>
      </Card>
      <Card icon="🔒" title="Payload Encryption (RFC 8291)">
        <p>Push payload is AES-128-GCM encrypted end-to-end using the subscriber's P-256 public key:</p>
        <Formula note="Entire key derivation and encryption uses crypto.subtle. Validated against RFC 8291 test vectors. Push payloads are end-to-end encrypted — the push service (FCM etc.) cannot read notification content.">
{`1. Generate ephemeral ECDH P-256 server keypair
2. ECDH: deriveBits(serverPrivKey, subscriberPubKey)
3. PRK  = HMAC-SHA256(auth_secret, ecdhSecret)
4. keyInfo = "WebPush: info" || 0x00
             || uaPubRaw || serverPubRaw
5. IKM  = HMAC-SHA256(PRK, keyInfo || 0x01)
6. salt = randomBytes(16)
7. PRK2 = HMAC-SHA256(salt, IKM)
8. CEK  = PRK2("Content-Encoding: aes128gcm") [16B]
9. NONCE= PRK2("Content-Encoding: nonce")     [12B]
10. Encrypt with AES-128-GCM(CEK, NONCE)
11. Send: salt || record_size || serverPubRaw || ciphertext`}
        </Formula>
      </Card>
      <Card icon="📦" title="Batch Delivery & Cleanup">
        <p>Subscriptions processed in batches to stay within Cloudflare Worker CPU limits:</p>
        <Formula note="Stale subscriptions (from browser reinstalls or revoked permissions) are silently purged on the first delivery failure — no separate maintenance job needed.">
{`BATCH_SIZE = 40 subscriptions per invocation
MAX_CHAIN  = 50 hops maximum
→ supports up to 2,000 subscribers per alert

HTTP 410 or 404 from push service
→ subscription auto-deleted from KV immediately`}
        </Formula>
      </Card>
      <Card icon="⏱" title="Cooldown System">
        <p>Multi-level cooldown system prevents notification spam:</p>
        <Formula note="The 2-hour per-subscriber cooldown means a subscriber who gets a 'DSLR visible' notification won't receive another DSLR notification for 2 hours even if conditions fluctuate.">
{`Per-topic global cooldown:
  COOLDOWN_{topic} key in KV
  TTL = cooldown_minutes for that category

Per-subscriber visibility cooldown:
  COOLDOWN_vis_{tier}_{subscriber_id} in KV
  TTL = 2 hours per tier

Escalation-only rule:
  Visibility tiers only fire on improvement
  (DSLR→phone→naked, never same tier twice)
  Conditions must drop fully before re-triggering`}
        </Formula>
      </Card>
    </CardGrid>
  </Section>
);

export default DocNotifications;