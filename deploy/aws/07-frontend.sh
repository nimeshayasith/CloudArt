#!/usr/bin/env bash
# Stage 7 - PUBLISH THE WEBSITE.
# Builds the React app, uploads it to the private site bucket and refreshes CloudFront.
# WHY each part:
#  - VITE_API_URL=/api/v1   the site and the API share one CloudFront address, so the API is a relative path (no CORS).
#  - two uploads            files under assets/ have a hash in their name (app-3f9a.js), so they can be cached for a year;
#                           everything else (index.html and friends) must always be re-checked, so it gets short/no caching.
#  - invalidation           CloudFront keeps copies at its edge; invalidating /index.html makes the new page visible at once.
#  - content-type fix       the AWS CLI on Windows can guess file types from the Windows registry, which may label .js/.css
#                           wrongly. The script sets the right type for the types the site uses.
source "$(dirname "$0")/lib.sh"
cd "$(git rev-parse --show-toplevel)"
SITE=$(tf_out site_bucket)
DIST=$(tf_out cloudfront_distribution_id)
URL=$(tf_out site_url)

say "Build (VITE_API_URL=/api/v1)"
[ -d frontend/node_modules ] || (cd frontend && npm ci --no-audit --no-fund >/dev/null)   # reuse installed packages if present
(cd frontend && VITE_API_URL=/api/v1 npm run build 2>&1 | tail -4)
[ -f frontend/dist/index.html ] || { echo "build produced no index.html"; exit 1; }

say "Upload hashed assets (cached for a year)"
retry aws s3 sync frontend/dist/assets "s3://$SITE/assets" --delete --only-show-errors --cache-control "public,max-age=31536000,immutable"

say "Upload everything else (5 minutes; index.html never cached)"
retry aws s3 sync frontend/dist "s3://$SITE" --delete --only-show-errors --exclude "assets/*" --exclude index.html --cache-control "public,max-age=300"
retry aws s3 cp frontend/dist/index.html "s3://$SITE/index.html" --only-show-errors --cache-control "no-cache" --content-type "text/html; charset=utf-8"

say "Make sure the file types are right"
fix_type() { # <extension> <content-type>
  for f in $(cd frontend/dist && find . -name "*.$1" | sed 's|^\./||'); do
    cc="public,max-age=300"; case "$f" in assets/*) cc="public,max-age=31536000,immutable" ;; esac
    retry aws s3 cp "frontend/dist/$f" "s3://$SITE/$f" --only-show-errors --content-type "$2" --cache-control "$cc"
  done
}
fix_type js "text/javascript"
fix_type css "text/css"
fix_type svg "image/svg+xml"
fix_type json "application/json"

say "Refresh CloudFront"
retry aws cloudfront create-invalidation --distribution-id "$DIST" --paths "/index.html" "/" --query 'Invalidation.[Id,Status]' --output text

say "Published: $URL"
