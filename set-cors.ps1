$keyId = "c0f81aa4637c"
$appKey = "005a9e96ccb3a8cc5fa0d91ba201849e4ca6589044"
$bucketName = "nexus-files-gokul"

# 1. Authorize
$authString = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("${keyId}:${appKey}"))
$headers = @{ "Authorization" = "Basic $authString" }

$authResponse = Invoke-RestMethod -Uri "https://api.backblazeb2.com/b2api/v2/b2_authorize_account" -Headers $headers
$apiUrl = $authResponse.apiUrl
$authToken = $authResponse.authorizationToken
$accountId = $authResponse.accountId

# 2. Get Bucket ID
$listHeaders = @{ "Authorization" = $authToken }
$listBody = @{ "accountId" = $accountId; "bucketName" = $bucketName } | ConvertTo-Json
$listResponse = Invoke-RestMethod -Method Post -Uri "$apiUrl/b2api/v2/b2_list_buckets" -Headers $listHeaders -Body $listBody
$bucketId = $listResponse.buckets[0].bucketId

# 3. Update Bucket with CORS rules
$corsRules = @(
    @{
        corsRuleName = "allow-browser-upload"
        allowedOrigins = @("*")
        allowedOperations = @("b2_upload_file", "b2_upload_part", "s3_put", "s3_post")
        allowedHeaders = @("*")
        exposeHeaders = @("x-bz-content-sha1")
        maxAgeSeconds = 3600
    }
)

$updateBody = @{
    accountId = $accountId
    bucketId = $bucketId
    corsRules = $corsRules
} | ConvertTo-Json -Depth 10

$updateResponse = Invoke-RestMethod -Method Post -Uri "$apiUrl/b2api/v2/b2_update_bucket" -Headers $listHeaders -Body $updateBody

Write-Output "Successfully updated CORS rules!"
