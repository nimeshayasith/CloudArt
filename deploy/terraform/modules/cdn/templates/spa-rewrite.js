// CloudFront Function (viewer-request) for the single-page app.
// A path WITHOUT a file extension is a page of the React app (/services/123), so it is answered with /index.html.
// A path WITH an extension (/assets/app-abc.js, /favicon.svg) is a real file and is served as it is.
// The /api/* behaviour does not use this function, so API answers (including JSON 404s) are never touched.
function handler(event) {
  var request = event.request;
  var uri = request.uri;
  if (uri.indexOf('.') === -1 || uri.charAt(uri.length - 1) === '/') {
    request.uri = '/index.html';
  }
  return request;
}
