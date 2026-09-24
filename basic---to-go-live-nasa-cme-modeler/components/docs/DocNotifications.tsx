// --- START OF FILE src/components/docs/DocNotifications.tsx ---
import React from 'react';
import { Card, CardGrid, Formula, Section, SubHeading, DataTable } from './DocPrimitives';

const DocNotifications: React.FC = () => (
  <Section
    id="s08"
    number="08"
    title="Push Notification System"
    subtitle="All notifications are opt-in and category-specific. No third-party push service is used. The complete RFC 8291 Web Push stack - VAPID JWT signing, ECDH key agreement, AES-128-GCM payload encryption - is implemented from scratch in the Push Worker using the Web Crypto API. Zero npm dependencies."
  >
    <SubHeading color="text-purple-400">Notification Categories - Exact Trigger Conditions</SubHeading>
    <DataTable
      headers={['Category', 'Trigger condition', 'Location-aware', 'Default']}
      rows={[
        ['visibility-dslr',  'Aurora strength for the subscriber reaches the long exposure tier (20+ on the 0-100 scale) after their own sky - the Moon where it actually is for them, and twilight - is taken off.', 'Yes - per GPS', 'On'],
        ['visibility-phone', 'Strength reaches the phone tier (35+) after the subscriber\'s sky.', 'Yes - per GPS', 'On'],
        ['visibility-naked', 'Strength reaches the naked-eye tier (50+) after the subscriber\'s sky.', 'Yes - per GPS', 'On'],
        ['overnight-watch',  'Nightly summary between 18:00-21:00 NZST. Send condition based on user mode: every-night (score ≥0), camera (≥25), phone (≥40), eye (≥55). Once per NZ calendar day per subscriber.', 'NZ timezone', 'On'],
        ['flare-event',      'Solar flare confirmed at peak ≥M1.0. "Confirmed" = flux still ≥M1 after 5 min of declining trend (avoids false peaks).', 'No', 'On'],
        ['shock-ff',         'Fast Forward Shock - speed↑, density↑, temp↑, Bt↑ across median pre/post windows (18/12 min). Classic CME arrival signature. 4-hour cooldown.', 'No', 'On'],
        ['shock-sf',         'Slow Forward Shock - speed↑, density↑, temp↑, Bt↓. Weaker compression, often SIR or CME flank. 4-hour cooldown.', 'No', 'On'],
        ['shock-fr',         'Fast Reverse Shock - speed↑, density↓, temp↓, Bt↓. CME trailing edge or HSS rear. 4-hour cooldown.', 'No', 'On'],
        ['shock-sr',         'Slow Reverse Shock - speed↑, density↓, temp↓, Bt↑. Uncommon trailing rarefaction. 4-hour cooldown.', 'No', 'On'],
        ['admin-broadcast',  'Manual - sent by admin via push worker broadcast endpoint. Bypasses Banner API (Cloudflare worker-to-worker restriction, error 1042).', 'No', 'On'],
      ]}
    />

    <SubHeading color="text-purple-400">Location-Aware Visibility Geometry - One Shared Model</SubHeading>
    <Card>
      <p>The visibility notifications use the same model as the app's forecast cards and sightings map (utils/auroraVisibility.ts, generated into the worker by <code>npm run sync:visibility</code>). The oval comes from the real solar wind: every L1 reading moved forward by its own travel time to Earth, and the hour that has arrived.</p>
      <Formula note="Magnetic latitude is corrected geomagnetic (AACGM-v2 at 110 km), from a one degree table over Australia and New Zealand. Over NZ it sits about 3.5° poleward of the tilted dipole - the coordinates the oval relations are fitted in.">
{`// Oval edge near magnetic midnight, from the wind at Earth
arrival      = t_L1 + 1.5e6 km / speed
newell       = max(newell_avg_60m, newell_avg_30m × 0.85)   // arrived by now
boundary_mid = −(65.5 − newell / 1800)  + pressure term, RM weighting
  clamped to [−76°, −44°]; bay onset → at least −47.2°

// At the subscriber's magnetic local time (0 = magnetic midnight)
boundary = boundary_mid − 4° × (1 − cos(2π (MLT − 23.5) / 24)) / 2

// Viewline grows with activity
activity = (65.5 − |boundary_mid|) / 21.5        → 0..1
reach    = 9° + 16° × activity                    → 9°..25°

// Strength, 0-100, from how far the edge is from the subscriber
d = |boundary| − |subscriber_mlat|
peak = 75 + 15 × activity
d ≤ 0:        peak + (100 − peak) × min(1, −d / 4)
0 < d < reach: 20 + (peak − 20) × (1 − d / reach)^1.5
d ≥ reach:    20 × (1 − (d − reach) / 2), floored at 0

// The subscriber's own sky comes off it (moon height and phase, twilight)
effective = strength × (1 − washout)

// Tiers: DSLR ≥ 20, phone ≥ 35, naked eye ≥ 50`}
      </Formula>
    </Card>

    <SubHeading color="text-purple-400">Push Cryptography - RFC 8291 Web Push from Scratch</SubHeading>
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
  (stored in Worker Secrets - never in KV or logs)

Authorization: vapid t={jwt}, k={VAPID_PUBLIC_KEY}`}
        </Formula>
      </Card>
      <Card icon="🔒" title="Payload Encryption (RFC 8291)">
        <p>Push payload is AES-128-GCM encrypted end-to-end using the subscriber's P-256 public key:</p>
        <Formula note="Entire key derivation and encryption uses crypto.subtle. Validated against RFC 8291 test vectors. Push payloads are end-to-end encrypted - the push service (FCM etc.) cannot read notification content.">
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
        <Formula note="Stale subscriptions (from browser reinstalls or revoked permissions) are silently purged on the first delivery failure - no separate maintenance job needed.">
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