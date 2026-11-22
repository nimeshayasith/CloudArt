import { prisma } from '../../config/prisma.js'
import { env } from '../../config/env.js'
import { HttpError } from '../../shared/httpError.js'
import { cognito } from './cognito.client.js'

const unavailable = () =>
  new HttpError(503, 'SERVICE_UNAVAILABLE', 'Sign-in service is temporarily unavailable — please try again in a moment')

/** Translate Cognito exceptions into stable API errors. */
function mapCognitoError(err) {
  switch (err?.name) {
    case 'UsernameExistsException':
      return new HttpError(409, 'EMAIL_TAKEN', 'An account with this email already exists')
    case 'InvalidPasswordException':
      return new HttpError(400, 'WEAK_PASSWORD', 'Password does not meet the strength requirements')
    case 'CodeMismatchException':
      return new HttpError(400, 'INVALID_CODE', 'The verification code is incorrect')
    case 'ExpiredCodeException':
      return new HttpError(400, 'CODE_EXPIRED', 'The verification code has expired — request a new one')
    case 'UserNotConfirmedException':
      return new HttpError(403, 'EMAIL_NOT_VERIFIED', 'Please verify your email before logging in')
    case 'NotAuthorizedException':
    case 'UserNotFoundException':
      return new HttpError(401, 'INVALID_CREDENTIALS', 'Incorrect email or password')
    case 'TooManyRequestsException':
    case 'LimitExceededException':
      return new HttpError(429, 'TOO_MANY_REQUESTS', 'Too many attempts — please wait and try again')
    case 'InvalidParameterException':
      return new HttpError(400, 'INVALID_REQUEST', 'The request was rejected — check your details')
    case 'TimeoutError':
    case 'NetworkingError':
    case 'ServiceUnavailableException':
    case 'InternalErrorException':
      return unavailable()
    default:
      if (['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNREFUSED', 'EAI_AGAIN'].includes(err?.code)) return unavailable()
      return err
  }
}

async function call(fn) {
  try {
    return await fn()
  } catch (err) {
    throw mapCognitoError(err)
  }
}

export async function register(input) {
  // Fast, friendly uniqueness checks against confirmed profiles.
  const [byEmail, byUsername] = await Promise.all([
    prisma.user.findUnique({ where: { email: input.email }, select: { id: true, cognitoSub: true } }),
    prisma.user.findUnique({ where: { username: input.username }, select: { id: true } }),
  ])
  // The seed creates the first admin as a "pending:<email>" placeholder that has no Cognito login yet.
  // That person must be able to register with their own e-mail to claim it (the first login links the real
  // account, see provisionUser), so the placeholder is not "taken". A row with a real login still is.
  const claimsPendingAdmin = byEmail?.cognitoSub === `pending:${input.email}`
  if (byEmail && !claimsPendingAdmin) throw new HttpError(409, 'EMAIL_TAKEN', 'An account with this email already exists')
  if (byUsername && !(claimsPendingAdmin && byUsername.id === byEmail.id)) {
    throw new HttpError(409, 'USERNAME_TAKEN', 'That username is already taken')
  }

  await call(() => cognito.signUp(input))
  return { email: input.email, next: 'VERIFY_EMAIL' }
}

export async function confirm({ email, code }) {
  await call(() => cognito.confirmSignUp({ email, code }))
  return { verified: true, whatsappCommunityUrl: env.WHATSAPP_COMMUNITY_URL || null }
}

export async function resend({ email }) {
  try {
    await cognito.resendCode({ email })
  } catch (err) {
    // Do not reveal whether the address exists; only surface throttling / outages.
    const mapped = mapCognitoError(err)
    if ([429, 503].includes(mapped.status)) throw mapped
  }
  return { sent: true }
}

const toTokens = (r) => ({
  idToken: r.AuthenticationResult.IdToken,
  accessToken: r.AuthenticationResult.AccessToken,
  refreshToken: r.AuthenticationResult.RefreshToken,
  expiresIn: r.AuthenticationResult.ExpiresIn,
})

export async function login({ email, password }) {
  const res = await call(() => cognito.login({ email, password }))
  if (!res.AuthenticationResult) throw new HttpError(401, 'CHALLENGE_UNSUPPORTED', 'Additional sign-in steps are not supported')
  return toTokens(res)
}

export async function refresh({ refreshToken }) {
  const res = await call(() => cognito.refresh({ refreshToken }))
  const t = toTokens(res)
  return { ...t, refreshToken } // Cognito does not rotate the refresh token here
}
