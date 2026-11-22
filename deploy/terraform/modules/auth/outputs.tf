output "user_pool_id" {
  description = "Id of the production user pool (COGNITO_USER_POOL_ID)."
  value       = aws_cognito_user_pool.main.id
}

output "app_client_id" {
  description = "Id of the browser app client (COGNITO_APP_CLIENT_ID). It is not a secret."
  value       = aws_cognito_user_pool_client.web.id
}
