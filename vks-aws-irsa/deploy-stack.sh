#!/usr/bin/env bash
# DISCLAIMER: This script is provided "as is" without warranty.
# Use at your own risk. Not supported.

set -euo pipefail

########################
# Variables
# Change these for you configuration settings
########################

CF_BUCKET="cf-templates-lkjieiof84f-us-west-2"      # Bucket to store custom-policy.json file.  Needs to exist
STACK_NAME="test-workload-oidc-provider"            # {clustername}-oidc provider
REGION="us-west-2"
BUCKETNAME="example-vks-oidc"                       # OIDC provider S3 bucket, can use bucket for multiple
CLUSTERNAMESPACE="default"                          # NS where our app pod will run
CLUSTERNAME="test-aws-pod-identity"                   # VKS cluster name
SERVICEACCOUNTNAME="aws-s3-reader"                  # Name of VKS pod service account that will assume role
TEMPLATE_FILE="cloudformation-oidc-setup.yaml"      # Cloud formation template
PACKAGED_TEMPLATE=".cfn/packaged.yaml"              # Bundled package name


#########
#########
# Do Not Edit Below This Point!!!!!
#########
#########


########################
# Calculate Thumbprint for S3 Region
########################

S3THUMBPRINT="$(
  openssl s_client \
    -connect s3.${REGION}.amazonaws.com:443 \
    -servername s3.${REGION}.amazonaws.com \
    </dev/null 2>/dev/null |
  openssl x509 -noout -fingerprint -sha1 |
  sed 's/://g' |
  sed 's/.*=//' |
  tr 'A-F' 'a-f'
)"

########################
# Fail if Required Variables are empty
########################

: "${CF_BUCKET:?CF_BUCKET not set}"
: "${STACK_NAME:?STACK_NAME not set}"
: "${REGION:?REGION not set}"
: "${BUCKETNAME:?BUCKETNAME not set}"
: "${CLUSTERNAMESPACE:?CLUSTERNAMESPACE not set}"
: "${SERVICEACCOUNTNAME:?SERVICEACCOUNTNAME not set}"
: "${CLUSTERNAME:?CLUSTERNAME not set}"
: "${S3THUMBPRINT:?S3THUMBPRINT not set}"

########################
# Create the Package with the custom-policy.json packaged
########################

mkdir -p .cfn

echo "Packaging CloudFormation template..."
aws cloudformation package \
  --template-file "$TEMPLATE_FILE" \
  --s3-bucket "$CF_BUCKET" \
  --region "$REGION" \
  --output-template-file "$PACKAGED_TEMPLATE"

echo "Deploying CloudFormation stack..."
aws cloudformation deploy \
  --stack-name "$STACK_NAME" \
  --template-file "$PACKAGED_TEMPLATE" \
  --region "$REGION" \
  --capabilities CAPABILITY_NAMED_IAM \
  --no-fail-on-empty-changeset \
  --parameter-overrides \
    Region="$REGION" \
    BucketName="$BUCKETNAME" \
    ClusterNamespace="$CLUSTERNAMESPACE" \
    ClusterName="$CLUSTERNAME" \
    S3Thumbprint="$S3THUMBPRINT" \
    ServiceAccountName="$SERVICEACCOUNTNAME"

echo "Deployment complete."

echo "CloudFormation Outputs:"
aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --query "Stacks[0].Outputs" \
  --output table

