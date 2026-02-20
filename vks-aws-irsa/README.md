# AWS IAM Roles for Service Accounts (IRSA) on VKS

## Disclaimer
This software is provided "as-is" and any express or implied warranties, including, but not limited to, the implied warranties of merchantability and fitness for a particular purpose are disclaimed. In no event shall the author be liable for any direct, indirect, incidental, special, exemplary, or consequential damages (including, but not limited to, procurement of substitute goods or services; loss of use, data, or profits; or business interruption) however caused and on any theory of liability, whether in contract, strict liability, or tort (including negligence or otherwise) arising in any way out of the use of this software, even if advised of the possibility of such damage.

**This project is not supported and is for educational/demonstration purposes only.**

## Introduction

AWS IAM Roles for Service Accounts (IRSA) can enable Kubernetes applications running on VKS to access native AWS services by allowing a service account to assume a specific IAM Role allowing fine grained access without requiring service account credentials.  This is achieved by using an AWS OIDC provider to trust the VKS cluster and inject service account tokens into the Pod.  

## AWS Components

This process requires you to have configured an OIDC provider in AWS IAM and associated IAM Roles and Policies in AWS.  You also need to have the AWS Pod Identity provider installed on the VKS cluster.  The upstream AWS documentation for [IRSA is here](https://docs.aws.amazon.com/eks/latest/userguide/iam-roles-for-service-accounts.html).  The below script automates the process of creating the S3 bucket, oidc provider and roles/policies for my convenience.  It is not necessarily production ready but feel free to use it.

### AWS S3 Bucket, OIDC provider and Policy creation

1. Modify the `deploy-stack.sh` file variables section with your desired values. Also make sure to make script executable `chmod +x deploy-stack.sh`
2. Verify your AWS CLI is up to date and you have configured appropriate access to your AWS environment (config and credentials files correctly created).
3. The `custom-policy.json` file will be used as a nested cloudformation template to create the custom policy and role that the pod will assume.  It is packaged into a cloudformation package automatically.  This allows us to use the AWS CLI to create these items.  If the policy is nested in the parent cloudformation template it will error usng the CLI.
4. Exectute the `deploy-stack.sh` file.  This will create the following items in AWS
   - Create S3 bucket used for storing OIDC files
   - Create bucket policy allowing Public Read on the bucket (required for OIDC)
   - Create OIDC Identity Provider
   - Create example Role that the POD Idenity will assume
   - Create a Policy that links to example Role
5.  When executing the script you can expect the following output. The Cloud Formation Outputs section contains the command you can use to upload the well-known open-id and public key files to the S3 bucket after the next step.
```
 ./deploy-stack.sh
Packaging CloudFormation template...

Successfully packaged artifacts and wrote output template to file .cfn/packaged.yaml.
Execute the following command to deploy the packaged template
aws cloudformation deploy --template-file /home/user/repos/vks-aws-irsa/.cfn/packaged.yaml --stack-name <YOUR STACK NAME>
Deploying CloudFormation stack...

Waiting for changeset to be created..
Waiting for stack create/update to complete
Successfully created/updated stack - test-workload-oidc-provider
Deployment complete.
CloudFormation Outputs:
```

The Cloud Formation script in unable to correctly set the Trust Relationships on the vks-t2-aws-pod-identity-example-pod-role (not sure if its fixable)

- Navigate to the vks-t2-aws-pod-identity-example-pod-role role in AWS UI
- Click Trust relationships
- Edit the Trusted entites (when you click edit you will most likely see AWS reporting an error because its missing required OIDC config)
- Change the Trust entities so they have the URL of the OIDC provider but no https://
```
                "StringEquals": {
                    "example-vks-oidc.s3.us-west-2.amazonaws.com/test-aws-pod-identity:sub": "system:serviceaccount:default:aws-s3-reader",
                    "example-vks-oidc.s3.us-west-2.amazonaws.com/test-aws-pod-identity:aud": "sts.amazonaws.com"
                }
```

### OIDC configuration and public key file creation

IRSA expects a well-know OIDC configuation and public key file to be present in the OIDC provider endpoint (S3 bucket).  Use the following process to generate the private and public keys the VKS cluster service account will use to authorize to AWS and assume the desired role and policy.  Note the format and hashing expectation of the keys.json fields are critical and need to be exact for authorization to work.
1. Generate Private/Public key-pair for VKS cluster service account
```
openssl genrsa -out sa_key.pem 4096
openssl rsa -in sa_key.pem -pubout -out sa.pem
```
2. Execute the `generate-oidc-files.sh`
  - chmod +x generate-oidc-files.sh
  - requires sa.pub file created
  - requires jq installed
  - requires openssl instaled
  - ./generate-oidc-files.sh <issuer-url> <public-key-file>. The issuer URL can be obtained from the OIDC Provider URL section of the Cloud Formation Output displayed by the deploy-stack.sh script.
```
./generate-oidc-files.sh \
https://example-vks-oidc.s3.us-west-2.amazonaws.com/test-aws-pod-identity \
sa.pem
```
3. The `generate-oidc-files.sh` will create 2 files (keys.json and openid-configuration.json).  The format of these files will look similar to the below.
```
openid-configuration.json

{
  "issuer": "https://example-vks-oidc.s3.us-west-2.amazonaws.com/test-aws-pod-identity",
  "jwks_uri": "https://example-vks-oidc.s3.us-west-2.amazonaws.com/test-aws-pod-identity/keys.json",
  "response_types_supported": ["id_token"],
  "subject_types_supported": ["public"],
  "id_token_signing_alg_values_supported": ["RS256"]
}
```
```
keys.json

{
  "keys": [
    {
      "kty": "RSA",
      "use": "sig",
      "alg": "RS256",
      "kid": "4TTV7S-o2Emk5oZP5larcjd{redacted}",
      "n": "vjIg9iHF-BKYqTiq7aGSYY5luVNdgfJ14y_n1CgpIHGT(redacted)",
      "e": "AQAB"
    }
  ]
}
```
4. Optional: Because the modulus (n field) and Key ID (KID field) in the keys.json require specific encoding expected by AWS to work, you can optionally run the key-file-validation.py to verify everthing is encoded correctly.  The KID in the pod(s) running on VKS Kubernetes will need to match the KID in the keys.json to correctly map the certs during authorization.
```
python key-file-validation.py

This output should match the keys.json file that was created with the generate-oidc-files.sh script.
```
5. Upload files to S3 Bucket.  The `generate-oidc-files.sh` outputs the commands needed to upload and validate the openid-configuration.json and keys.json files to your S3 endpoint.  This can be automated as part of the script as desired but keeping manual for now.
```
Output from generate-oidc-files.sh script

  # Upload OIDC discovery document
  aws s3 cp openid-configuration.json \
    s3://example-vks-oidc/test-aws-pod-identity/.well-known/openid-configuration \
    --content-type application/json

  # Upload JWKS
  aws s3 cp keys.json \
    s3://example-vks-oidc/test-aws-pod-identity/keys.json \
    --content-type application/json

  # Verify uploads
  curl -s https://example-vks-oidc.s3.us-west-2.amazonaws.com/test-aws-pod-identity/.well-known/openid-configuration | jq
  curl -s https://example-vks-oidc.s3.us-west-2.amazonaws.com/test-aws-pod-identity/keys.json | jq

  The Curl commands should return output that matches the openid-configuration.json and keys.json files.
```
5. This completes the AWS configuration.

To Do:
- Test having a single AWS bucket house authentication for multiple VKS clusters.
- Try to fix cloud foundation script to properly set trust entities on example role.


## VKS Components and Configuration Steps

**All operations in this section are exectuted in the Supervisor Cluster context**

### Custom Clusterclass
Currently we require a custom cluster class (based on cluster api) to patch the Kubernetes API service-account-issuer to point to our AWS OIDC provider.  Custom cluster classes are documented but you should work with your Broadcom VKS team prior to using this in production.  Future releases of the VKS Service may support patching this variable without a custom clusterclass.

Based on VKS Service clusterclass 3.4.0 so you must use a K8s version compatible with 3.4.0 (up to 1.33).

1. Apply the custom clusterclass `aws-irsa-pod-identity-clusterclass-3.4.0` to your Supervisor.  This custom clusterclass patches the KubeAPI server service-account-issuer field with our AWS OIDC provider S3 URL.  The actual value of the OIDC provider will come from the `.cluster.spec.variables.serviceAccountIssuer` field in our VKS Cluster manifest.  The clusterclass holds a bogus default value to avoid validation errors while creating the cluster class.
```
kubectl apply -f aws-irsa-pod-identity-clusterclass-3.4.0.yaml
clusterclass.cluster.x-k8s.io/aws-irsa-v3.4.0-custom-class created
```
2. Verify our custom clusterclass was correctly created and is Ready True.
```
kubectl get cc -n vmware-system-vks-public

vmware-system-vks-public   aws-irsa-v3.4.0-custom-class    True    <-- Our custom clusterclass
vmware-system-vks-public   builtin-generic-v3.1.0          True
vmware-system-vks-public   builtin-generic-v3.2.0          True
vmware-system-vks-public   builtin-generic-v3.3.0          True
vmware-system-vks-public   builtin-generic-v3.4.0          True
vmware-system-vks-public   builtin-generic-v3.5.0          True
```

### VKS Cluster Manifest and Creation
1. Modify VKS Cluster manifest with `.cluster.spec.variables.serviceAccountIssuer`variable defined.  The VKS **cluster name NEEDS to MATCH** the value you used in the `deploy-stack.sh` ClusterName variable.  This cluster manifest also has a secret that is created in the same supervisor namespace as the cluster that holds the sa.pem public and sa_key.pem private keys generated for the OIDC provider.  This secret needs to be named exactly in the format of {vks-clustername-sa}.  If this is not correct IRSA will fail.

**Here are the fields we will customize in our VKS Cluster Manifest**
```
apiVersion: v1
kind: Secret
metadata:
  name: test-aws-pod-identity-sa  <-- VKS clustername as defined in deploy-stack.sh + sa
  namespace: aws-irsa-ns        <-- Supervisor namespace where VKS cluster will be created
type: cluster.x-k8s.io/secret
stringData:
  tls.crt: |
    -----BEGIN PUBLIC KEY-----
    {sa.pem contents}           <-- Enter certifcate sa.pem
    -----END PUBLIC KEY-----
  tls.key: |
    -----BEGIN PRIVATE KEY-----
    {sa_key.pem content}        <-- Enter Private Key sa_key.pem
    -----END PRIVATE KEY-----

apiVersion: cluster.x-k8s.io/v1beta1
kind: Cluster
metadata:
  name: test-aws-pod-identity     <--- Matches clustername value in deploy-stack.sh
  namespace: aws-irsa-ns        <-- Supervisor namespace to create cluster in
  annotations:
    # aws iam list-open-id-connect-providers
    vks.vmware.com/oidc-provider-arn: "arn:aws:iam::12345678910:oidc-provider/example-vks-oidc.s3.us-west-2.amazonaws.com/test-aws-pod-identity"
spec:
........
  topology:
    # Name of Custom Cluster Class
    class: aws-irsa-v3.4.0-custom-class         <-- This is our custom clusterclass
    # Namesapce of Custom Cluster Class
    classNamespace: vmware-system-vks-public    <-- Define the namespace custom clusterclass is in
    version: v1.33.3---vmware.1-fips-vkr.1      <-- VKS version needs to be compatible with 3.4.0 cc
    variables:
    # Service account issuer for AWS pod identity
    # If you are hosting your own OIDC discovery documents in S3, the URL structure typically looks like: https://<bucket>.s3.<region>.amazonaws.com/<optional-path>/.well-known/openid-configuration
    # The Identity Provider URL that AWS IAM sees must be the root of your OIDC provider, e.g.: https://my-oidc-bucket.s3.us-west-2.amazonaws.com/ClusterName
    # In this example the my-oidc-bucket is t2-vks-oidc and clustername is t2-aws-pod-identity
      - name: serviceAccountIssuer
        value: "https://example-vks-oidc.s3.us-west-2.amazonaws.com/test-aws-pod-identity"    <--  Set OIDC issuer
```
2. Create the VKS Cluster
```
kubectl apply -f test-aws-pod-identity-vks-cluster.yaml

cluster.cluster.x-k8s.io/test-aws-pod-identity created
```
3. Verify Kubernetes API service-account-issuer is correctly set
```
kubectl get kcp -A
k get kcp test-aws-pod-identity-gt4jd -n aws-irsa-ns -oyaml |grep -i service-account-issuer -A 2
        - name: service-account-issuer
          value: https://example-vks-oidc.s3.us-west-2.amazonaws.com/test-aws-pod-identity
        - name: tls-cipher-suites
```

### VKS Cluster Configuration

**The following are completed on the new t2-aws-pod-identity cluster**.  
So be sure to authenticate to the new cluster and correctly set your context.

1. Install Cert-Manager if not present
```
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.19.1/cert-manager.yaml
```
2. Label the default namespace to allow privledged pods (VKS uses psa by default)
```
kubectl label ns default pod-security.kubernetes.io/enforce=privileged
```
3. Deploy AWS Pod Identity Webhook 

- AWS Pod Idenity Webhook [Github](https://github.com/aws/amazon-eks-pod-identity-webhook)

- When we configured our AWS OIDC provider we defined a namespace for our service account.  In our case we used the default namespace.  So we will deploy our AWS Pod Identity Webhook in this namespace.  I'm sure there are better ways to do this but quick and dirty validation will use this method.

- Run scripts in /deploy folder of the AWS Pod Identity Webhook github.  Note the deployment-base.yaml leaves the image field blank.  You can use `amazon/amazon-eks-pod-identity-webhook:latest` for the image.
```
k apply -f deploy/ -n default
kubectl get po -n default

NAME                                    READY   STATUS    RESTARTS   AGE
pod-identity-webhook-764c6c7bdc-222wm   1/1     Running   0          9s
```

### Test Workload

Now that we have all of the components in place we can test a workload to verify the pod can assume the AWS Role correctly.

1. We need to annotate the test Pod with our AWS role ARN.  We named our role in the cloudformation-oidc-setup.yaml vks-{ClusterName}-example-pod-role.  We can get the arn using the aws cli command:
```
aws iam get-role --role-name vks-test-aws-pod-identity-example-pod-role

    "Role": {
        "Path": "/",
        "RoleName": "vks-test-aws-pod-identity-example-pod-role",
        "RoleId": "{redacted}",
        "Arn": "arn:aws:iam::12345678910:role/vks-test-aws-pod-identity-example-pod-role",
        "CreateDate": "2026-01-24T01:18:40+00:00"
        .........
```
2. Edit the `test-workload.yaml` and update the service account annotation with the ARN listed in the output
```
apiVersion: v1
kind: ServiceAccount
metadata:
  name: aws-s3-reader                     <-- needs to match service account defined in cloudformationstack
  namespace: default                      <-- needs to match namespace defined in cloudformationstack
  annotations:
    eks.amazonaws.com/role-arn: "arn:aws:iam::12345678910:role/vks-test-aws-pod-identity-example-pod-role"        <-- update by copying ARN from the example role we created                
```
3. You should not need to edit any other parts of the `test-workload.yaml`.  It will create a pod called `aws-cli-test` in the `default` namespace with a service account called `aws-s3-reader`
```
kubectl apply -f test-workload.yaml
serviceaccount/aws-s3-reader created

kubectl get po -n default
NAME                                    READY   STATUS    RESTARTS   AGE
aws-cli-test                            1/1     Running   0          41s
pod-identity-webhook-764c6c7bdc-222wm   1/1     Running   0          20m
```
4. Validate IRSA and Role Assumption is working
```
kubectl exec aws-cli-test -- aws sts get-caller-identity

{
    "UserId": "12345678910:botocore-session-12345678",
    "Account": "12345678910",
    "Arn": "arn:aws:sts::12345678910:assumed-role/vks-t2-aws-pod-identity-example-pod-role/botocore-session-12345678"
}
```
```
kubectl exec aws-cli-test -- aws s3 ls
2013-11-06 01:21:37 aws-bucket-xyz
2025-11-09 22:06:34 cf-templates-k3984y3374
2025-07-22 14:34:46 aws-testbucket-3485n4
2026-01-24 01:18:39 example-vks-oidc         <-- our OIDC bucket
```

## Troubleshooting

**Error:** An error occurred (AccessDenied) when calling the AssumeRoleWithWebIdentity operation: Not authorized to perform sts:AssumeRoleWithWebIdentity
command terminated with exit code 254

1. Verify the KID from the aws-cli-test pod matches the KID field in the keys.json file
```
kubectl exec -n default aws-test-cli -- \
  sh -c 'TOKEN=$(cat /var/run/secrets/kubernetes.io/serviceaccount/token); \
         HEADER=$(echo $TOKEN | cut -d. -f1 | base64 --decode); \
         PAYLOAD=$(echo $TOKEN | cut -d. -f2 | base64 --decode); \
         echo "=== HEADER ==="; echo $HEADER | jq .; \
         echo "=== PAYLOAD ==="; echo $PAYLOAD | jq .'
```

**Error:** An error occurred (InvalidIdentityToken) when calling the AssumeRoleWithWebIdentity operation: No OpenIDConnect provider found in your account for https://example-vks-oidc.s3.us-west-2.amazonaws.com/test-aws-pod-identity
command terminated with exit code 254

1. Verify the Trust Relationship in the Pod Idenity Role in AWS doesn't contain matches your OIDC provider and doesn't contain https in the audience and subscriber fields.  Also verify the correct service account (aws-s3-reader = same as pod is user) and namespace (default) in the sub string.
```
            "Action": "sts:AssumeRoleWithWebIdentity",
            "Condition": {
                "StringEquals": {
                    "example-vks-oidc.s3.us-west-2.amazonaws.com/test-aws-pod-identity:sub": "system:serviceaccount:default:aws-s3-reader",
                    "example-vks-oidc.s3.us-west-2.amazonaws.com/test-aws-pod-identity:aud": "sts.amazonaws.com"
```
**Error:** -bash: arn:aws:iam::12345678910:role/vks-test-aws-pod-identity-example-pod-role: No such file or directory

3. Verify the service account is using the correct role ARN (comes from example-worklod pod annotation).  This needs to match the Role ARN
```
k describe sa aws-s3-reader
Name:                aws-s3-reader
Namespace:           default
Labels:              <none>
Annotations:         eks.amazonaws.com/role-arn: arn:aws:iam::12345678910:role/vks-test-aws-pod-identity-example-pod-role
Image pull secrets:  <none>
Mountable secrets:   <none>
Tokens:              <none>
Events:              <none>
```


