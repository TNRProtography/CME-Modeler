# Spot The Aurora - Image Proxy Worker

Serves science imagery from an allow-listed set of observatories on the app's
own origin, so the browser can read its **pixels**.

## Why this exists

Displaying an image needs no permission. **Reading** one does.

Anything drawn onto a canvas from a cross-origin image taints that canvas, and
reading a tainted canvas throws. Neither `jsoc1.stanford.edu` nor
`sdo.gsfc.nasa.gov` sends the CORS header that would allow it, so there is no
client-side fallback - if this Worker is not answering, every feature that
needs pixels is dead, while every feature that only *shows* the same image
works perfectly. That asymmetry makes the failure genuinely confusing, which
is why it is worth stating plainly here.

Features that depend on it:

| Feature | What it reads |
|---|---|
| Coronal hole detection | SUVI 195 frames |
| Coronal hole **polarity** | HMI line-of-sight magnetogram |
| Solar disk measurement | HMI / SUVI, to find the limb |

## The failure mode to recognise

A Worker that is not deployed does not 404. The request falls through to the
single-page app, which answers every unknown path with `index.html` and a
**200**. So the symptom is:

```
Expected an image, got text/html
```

That means the route is missing at that address - not that the observatory is
down and not that the URL is wrong.

## Endpoints

```
GET /api/proxy/image?url=<encoded>&ttl=<30..300>
GET /api/proxy/meta?url=<encoded>
GET /api/proxy/data?url=<encoded>
```

`/image` and `/meta` allow only: `sdo.gsfc.nasa.gov`, `jsoc1.stanford.edu`,
`services.swpc.noaa.gov`, `stereo-ssc.nascom.nasa.gov`.
`/data` allows only: `www.nmdb.eu`, `nest.nmdb.eu`, `services.swpc.noaa.gov`.

Private and link-local addresses are rejected regardless, so the allow-list
cannot be walked into an internal network.

## Deploying

```bash
npx wrangler deploy
```

Routed at `spottheaurora.co.nz/api/proxy/*` (see `wrangler.toml`).

### The `*.pages.dev` problem

Cloudflare will not route a Worker onto a `*.pages.dev` hostname, because that
zone belongs to Cloudflare rather than to you. So on a preview deployment
`/api/proxy/image` is a plain 404 no matter what.

The app resolves the proxy base in this order, which handles it:

1. `VITE_PROXY_BASE` if set
2. same-origin `/api/proxy`
3. `https://spottheaurora.co.nz/api/proxy` - works from anywhere, since the
   Worker answers with `Access-Control-Allow-Origin: *`
4. a direct fetch, which succeeds only for hosts that send CORS

Step 3 is what makes previews work with no configuration. Setting
`VITE_PROXY_BASE` in the Pages project is tidier but not required.

## Checking it

```bash
curl -sI "https://spottheaurora.co.nz/api/proxy/image?url=\
https%3A%2F%2Fsdo.gsfc.nasa.gov%2Fassets%2Fimg%2Flatest%2Flatest_1024_HMIB.jpg&ttl=90" \
  | grep -i content-type
```

`image/jpeg` is correct. `text/html` means it is not deployed at that address.
