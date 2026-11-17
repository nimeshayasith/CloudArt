/**
 * Thin wrapper over Amazon Cognito (public, secret-less app client — no AWS credentials needed).
 * Kept separate so tests can mock it.
 */
import {
  CognitoIdentityProviderClient,
  ConfirmSignUpCommand,
  InitiateAuthCommand,
  ResendConfirmationCodeCommand,
  SignUpCommand,
} from '@aws-sdk/client-cognito-identity-provider'
import { env } from '../../config/env.js'

// maxAttempts: transparently retry transient network resets/timeouts (seen on slow links) before we surface a 503.
const client = new CognitoIdentityProviderClient({ region: env.COGNITO_REGION, maxAttempts: 4 })
const ClientId = env.COGNITO_APP_CLIENT_ID

export const cognito = {
  signUp({ email, password, fullName, username, organization, professionalCategory }) {
    return client.send(
      new SignUpCommand({
        ClientId,
        Username: email,
        Password: password,
        UserAttributes: [
          { Name: 'email', Value: email },
          { Name: 'name', Value: fullName },
          { Name: 'preferred_username', Value: username },
          { Name: 'custom:organization', Value: organization },
          { Name: 'custom:prof_category', Value: professionalCategory },
        ],
      }),
    )
  },
  confirmSignUp({ email, code }) {
    return client.send(new ConfirmSignUpCommand({ ClientId, Username: email, ConfirmationCode: code }))
  },
  resendCode({ email }) {
    return client.send(new ResendConfirmationCodeCommand({ ClientId, Username: email }))
  },
  login({ email, password }) {
    return client.send(
      new InitiateAuthCommand({
        ClientId,
        AuthFlow: 'USER_PASSWORD_AUTH',
        AuthParameters: { USERNAME: email, PASSWORD: password },
      }),
    )
  },
  refresh({ refreshToken }) {
    return client.send(
      new InitiateAuthCommand({ ClientId, AuthFlow: 'REFRESH_TOKEN_AUTH', AuthParameters: { REFRESH_TOKEN: refreshToken } }),
    )
  },
}
