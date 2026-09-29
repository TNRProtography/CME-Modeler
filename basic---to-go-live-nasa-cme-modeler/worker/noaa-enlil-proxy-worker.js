// A cache to hold the sorted list of image filenames.
// Using a simple in-memory variable works well for this use case,
// but for more complex needs, you could use the Cache API or KV.
let cachedFileList = {
  timestamp: 0,
  files: [],
};

const CACHE_DURATION_SECONDS = 3600; // 1 hour

// Standard browser User-Agent. NOAA/SWPC's bot protection answers HTTP 403 to
// requests without a recognisable one, which is what Workers send by default.
const NOAA_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
};

export default {
  async fetch(request) {
    const now = Date.now() / 1000; // Current time in seconds

    // --- Step 1 & 2: Check cache and fetch if it's expired ---
    if (now - cachedFileList.timestamp > CACHE_DURATION_SECONDS) {
      console.log('Cache expired or empty. Fetching new file list from NOAA.');
      try {
        const noaaDirectoryUrl = 'https://services.swpc.noaa.gov/images/animations/enlil/';
        const response = await fetch(noaaDirectoryUrl, { headers: NOAA_HEADERS });
        if (!response.ok) {
          throw new Error(`Failed to fetch NOAA directory: ${response.statusText}`);
        }
        const html = await response.text();

        // Use a regular expression to find all relevant jpg filenames
        const regex = /enlil_com2_[\d_T]+\.jpg/g;
        const unsortedFiles = html.match(regex);

        if (!unsortedFiles || unsortedFiles.length === 0) {
          // If no files are found, return an error and don't update the cache
          return new Response('No image files found on the NOAA server.', { status: 404 });
        }

        // Sort the files. Since the timestamp is in the name, a simple string sort works.
        unsortedFiles.sort();

        // Update the cache
        cachedFileList = {
          timestamp: now,
          files: unsortedFiles,
        };
        console.log(`Successfully cached ${unsortedFiles.length} files.`);

      } catch (error) {
        console.error("Error updating file list:", error);
        // If an update fails, serve from the old cache if it exists, otherwise return an error
        if (cachedFileList.files.length === 0) {
          return new Response('Could not fetch file list from NOAA.', { status: 502 }); // Bad Gateway
        }
      }
    }

    // --- Step 3: Process the user's request ---
    const url = new URL(request.url);
    // Extract the number from the path, e.g., "1.jpg" -> "1"
    const requestedFileNumber = parseInt(url.pathname.replace(/[^0-9]/g, ''), 10);

    if (isNaN(requestedFileNumber) || requestedFileNumber < 1) {
      // If the request isn't for a positive number, show the total count.
      const totalFiles = cachedFileList.files.length;
      return new Response(`This worker is active. Found ${totalFiles} files. Request a file like /1.jpg.`, {
        headers: { 'Content-Type': 'text/plain' },
      });
    }

    const fileIndex = requestedFileNumber - 1; // Convert to a zero-based array index

    if (fileIndex >= cachedFileList.files.length) {
      return new Response('File not found. The requested number is too high.', { status: 404 });
    }

    // --- Step 4: Fetch and serve the correct file from NOAA ---
    const targetFilename = cachedFileList.files[fileIndex];
    const targetUrl = `https://services.swpc.noaa.gov/images/animations/enlil/${targetFilename}`;

    console.log(`Request for ${requestedFileNumber}.jpg is mapping to ${targetUrl}`);

    // Fetch the actual image from NOAA
    // We use `fetch(targetUrl, { cf: { cacheTtl: 86400 } })` to tell Cloudflare to cache the actual image itself.
    // This reduces hits to the NOAA server even more.
    const imageResponse = await fetch(targetUrl, {
        headers: NOAA_HEADERS,
        cf: {
            cacheTtl: 86400, // Cache the actual JPG image for a day at the edge
        },
    });

    // Return the image to the user
    return new Response(imageResponse.body, {
      headers: imageResponse.headers,
    });
  },
};

