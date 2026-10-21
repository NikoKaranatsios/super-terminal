// Shared renderer/main-process boundary: clicks may open web pages, never files
// or arbitrary OS protocol handlers. No URL is fetched merely by rendering it.
function webLink(value) {
  if (typeof value !== 'string' || value.length > 8192 || !/^https?:\/\//i.test(value) || /[\u0000-\u0020\u007f]/.test(value)) return null;
  try {
    const url = new URL(value);
    return ['http:','https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
module.exports = { webLink };
