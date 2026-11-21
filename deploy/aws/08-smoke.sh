#!/usr/bin/env bash
# Stage 8 - SMOKE TEST of the live site. Uses only the public address, the AWS CLI and the server (via SSM).
# It creates ONE throwaway user (an Amazon SES "simulator" address, which never reaches a real inbox), walks through a real
# flow, checks the things that are easy to get wrong in production, and then removes everything it created.
#   A. sign-up -> confirm -> login        proves Cognito (the production pool), the API and CloudFront together
#   B. create a service request           proves the database
#   C. upload a file, download it         proves the S3 storage driver and the server's IAM role
#   D. the S3 object is private+encrypted proves the bucket is not public
#   E. the API saw the REAL visitor IP    proves TRUST_PROXY=1 and the forwarded-address chain through CloudFront
#   F. cleanup                            removes the user (Cognito + database), the request and the uploaded file
source "$(dirname "$0")/lib.sh"
cd "$(git rev-parse --show-toplevel)"
TF=deploy/terraform
URL=$(cd $TF && terraform output -raw site_url)
POOL=$(cd $TF && terraform output -raw cognito_user_pool_id)
UPLOADS=$(cd $TF && terraform output -raw uploads_bucket)
LOGGROUP=$(cd $TF && terraform output -raw log_group)
TS=$(date +%s)
EMAIL="success+cloudartprodsmoke$TS@simulator.amazonses.com"
USERNAME="smoke_$TS"
PASSWORD='Str0ng!Pass#1'
PASS=0; FAIL=0
check() { if [ "$2" = "$3" ]; then PASS=$((PASS+1)); printf '  PASS  %s\n' "$1"; else FAIL=$((FAIL+1)); printf '  FAIL  %s (expected [%s] got [%s])\n' "$1" "$3" "$2"; fi; }
jget() { python -c 'import sys,json; d=json.load(sys.stdin); print(eval("d"+sys.argv[1]))' "$1"; }
# NOTE: curl here is the Windows program, so its "discard output" target is NUL, not /dev/null (error E11 in the deployment log).
api() { curl -s -m 30 "$@"; }

say "A. sign-up, confirm, login on the PRODUCTION pool"
REG=$(api -o NUL -w '%{http_code}' -X POST "$URL/api/v1/auth/register" -H 'Content-Type: application/json' \
  -d "{\"fullName\":\"Prod Smoke\",\"email\":\"$EMAIL\",\"organization\":\"Smoke Test Org\",\"username\":\"$USERNAME\",\"professionalCategory\":\"CLOUD_ENGINEER\",\"password\":\"$PASSWORD\",\"confirmPassword\":\"$PASSWORD\"}")
check "register answers 201" "$REG" 201
# We cannot read the e-mailed code, so the test confirms the account as an administrator would.
retry aws cognito-idp admin-confirm-sign-up --user-pool-id "$POOL" --username "$EMAIL"
retry aws cognito-idp admin-update-user-attributes --user-pool-id "$POOL" --username "$EMAIL" --user-attributes Name=email_verified,Value=true
LOGIN=$(api -X POST "$URL/api/v1/auth/login" -H 'Content-Type: application/json' -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")
TOKEN=$(echo "$LOGIN" | jget "['idToken']")
check "login returns a token" "$([ ${#TOKEN} -gt 100 ] && echo yes || echo no)" yes
ME=$(api "$URL/api/v1/users/me" -H "Authorization: Bearer $TOKEN" | jget "['user']['email']")
check "/users/me shows the new user" "$ME" "$EMAIL"
AUTH="Authorization: Bearer $TOKEN"

say "B. a service request (database)"
CAT=$(api "$URL/api/v1/service-categories" | jget "['categories'][0]['id']")
REQ=$(api -X POST "$URL/api/v1/service-requests" -H "$AUTH" -H 'Content-Type: application/json' \
  -d "{\"categoryId\":\"$CAT\",\"title\":\"Production smoke test\",\"description\":\"A throwaway request that checks the live system end to end.\"}")
RID=$(echo "$REQ" | jget "['request']['id']")
check "request created with status SUBMITTED" "$(echo "$REQ" | jget "['request']['status']")" SUBMITTED

say "C. upload a file and download it (S3 driver + server role)"
mkdir -p deploy/.build
printf '%%PDF-1.4\nproduction smoke test file %s\n' "$TS" > deploy/.build/smoke.pdf
UP=$(api -X POST "$URL/api/v1/service-requests/$RID/attachments" -H "$AUTH" -H 'Content-Type: application/pdf' -H "X-File-Name: smoke%20test.pdf" --data-binary @deploy/.build/smoke.pdf)
AID=$(echo "$UP" | jget "['attachment']['id']")
check "upload accepted" "$(echo "$UP" | jget "['attachment']['fileName']")" "smoke test.pdf"
api -D deploy/.build/dl.headers -o deploy/.build/dl.pdf "$URL/api/v1/service-attachments/$AID/file" -H "$AUTH"
check "download is byte-identical" "$(cmp -s deploy/.build/smoke.pdf deploy/.build/dl.pdf && echo same || echo different)" same
check "download is an attachment" "$(grep -ic '^content-disposition: attachment' deploy/.build/dl.headers)" 1
check "download is not cached" "$(grep -ic '^cache-control: private, no-store' deploy/.build/dl.headers)" 1
check "a request without the token is refused" "$(api -o NUL -w '%{http_code}' "$URL/api/v1/service-attachments/$AID/file")" 401

say "D. the object in S3 is private and encrypted"
KEY=$(retry aws s3api list-objects-v2 --bucket "$UPLOADS" --prefix requests/ --query 'Contents[?Size>`0`]|[-1].Key' --output text)
echo "  object key: $KEY"
check "key has the generated shape" "$(echo "$KEY" | grep -Ec '^requests/[0-9a-f-]{36}\.pdf$')" 1
check "encrypted at rest (AES256)" "$(retry aws s3api head-object --bucket "$UPLOADS" --key "$KEY" --query ServerSideEncryption --output text)" AES256
check "anonymous download from S3 is refused" "$(curl -s -m 20 -o NUL -w '%{http_code}' "https://$UPLOADS.s3.$REGION.amazonaws.com/$KEY")" 403

say "E. the API logged the real visitor address, not CloudFront's"
MYIP=$(curl -s -m 20 https://checkip.amazonaws.com | tr -d '[:space:]')
sleep 15   # CloudWatch Logs needs a moment
SEEN=$(retry aws logs filter-log-events --log-group-name "$LOGGROUP" --filter-pattern "{ \$.path = \"/api/v1/auth/login\" }" --start-time $(( (TS - 120) * 1000 )) --query 'events[].message' --output text | tr '\t' '\n' | python -c 'import sys,json; print(sorted({json.loads(l)["ip"] for l in sys.stdin if l.strip().startswith("{")}))')
echo "  my public address: $MYIP   addresses the API logged: $SEEN"
check "the log contains my address" "$(echo "$SEEN" | grep -c "$MYIP")" 1

say "F. cleanup"
# The bucket is versioned, so remove every version of the test object (a plain delete would only add a delete marker).
aws s3api list-object-versions --bucket "$UPLOADS" --prefix "$KEY" --output json | python -c "
import sys,json,subprocess
d=json.load(sys.stdin)
for v in d.get('Versions',[])+d.get('DeleteMarkers',[]):
    subprocess.run(['aws','s3api','delete-object','--bucket','$UPLOADS','--key',v['Key'],'--version-id',v['VersionId']],check=True,stdout=subprocess.DEVNULL)
"
retry aws cognito-idp admin-delete-user --user-pool-id "$POOL" --username "$EMAIL"
SQL="delete from service_requests where user_id in (select id from users where email='$EMAIL'); delete from users where email='$EMAIL';"
deploy/aws/ssm-run.sh "cd /opt/cloudart && docker compose --env-file .env.prod -f docker-compose.prod.yml exec -T db psql -U cloudart -d cloudart_db -tAc \"$SQL select (select count(*) from users) || ' users, ' || (select count(*) from service_requests) || ' requests left'\"" | tail -2
rm -f deploy/.build/smoke.pdf deploy/.build/dl.pdf deploy/.build/dl.headers

say "RESULT: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
