// Define the mapping from a friendly name to the actual SDO URL
const SDO_IMAGE_URLS = {
  'sdo-hmi': 'https://sdo.gsfc.nasa.gov/assets/img/latest/latest_512_HMIIF.jpg',
  'sdo-aia-193': 'https://sdo.gsfc.nasa.gov/assets/img/latest/latest_512_0193.jpg',
};

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.slice(1); // Remove the leading '/'

    // Find the target URL from our mapping
    const targetUrl = SDO_IMAGE_URLS[path as keyof typeof SDO_IMAGE_URLS];

    if (!targetUrl) {
      return new Response('Image not found', { status: 404 });
    }

    // Fetch the image from the SDO server
    const sdoResponse = await fetch(targetUrl, {
      headers: {
        'Referer': 'https://sdo.gsfc.nasa.gov/data/dashboard/', // SDO server sometimes requires a referer
      },
    });

    // Create a new response, passing through the SDO image data
    const response = new Response(sdoResponse.body, sdoResponse);

    // Set the crucial CORS headers to allow your web app to access the image
    response.headers.set('Access-Control-Allow-Origin', '*');
    response.headers.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    response.headers.set('Access-Control-Allow-Headers', 'Content-Type');

    // Set a cache control header to ensure clients get fresh images
    response.headers.set('Cache-Control', 'public, max-age=300'); // Cache for 5 minutes

    return response;
  },
};