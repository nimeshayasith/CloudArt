import { CognitoJwtVerifier } from 'aws-jwt-verify'
import { env } from '../config/env.js'
import { HttpError } from '../shared/httpError.js'
import { provisionUser } from '../modules/users/user.service.js'

const verifier = CognitoJwtVerifier.create({
  userPoolId: env.COGNITO_USER_POOL_ID,
  clientId: env.COGNITO_APP_CLIENT_ID,
  tokenUse: 'id',
})

/**
 * Verifies the Cognito ID token, requires a verified email, and attaches the
 * CloudArt user (created on first login) as req.user. Authorization comes from
 * PostgreSQL (users.system_role), never from the token.
 */
export async function requireAuth(req, _res, next) {
  try {
    const header = req.headers.authorization ?? ''
    const token = header.startsWith('Bearer ') ? header.slice(7) : null
    if (!token) throw new HttpError(401, 'UNAUTHENTICATED', 'Authentication required')

    let claims
    try {
      claims = await verifier.verify(token)
    } catch {
      throw new HttpError(401, 'INVALID_TOKEN', 'Session expired or invalid — please log in again')
    }
    if (claims.email_verified !== true && claims.email_verified !== 'true') {
      throw new HttpError(403, 'EMAIL_NOT_VERIFIED', 'Please verify your email before continuing')
    }

    const user = await provisionUser(claims)
    if (!user.isActive) throw new HttpError(403, 'ACCOUNT_DISABLED', 'This account has been disabled')
    req.user = user
    next()
  } catch (err) {
    next(err)
  }
}

export function requireAdmin(req, _res, next) {
  if (req.user?.systemRole !== 'ADMIN') return next(new HttpError(403, 'FORBIDDEN', 'Administrator access required'))
  next()
}
