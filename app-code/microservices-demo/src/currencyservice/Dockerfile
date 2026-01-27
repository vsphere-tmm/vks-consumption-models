# Copyright 2020 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#      http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

# ---------- builder ----------
FROM dockerhub.packages.vcfd.broadcom.net/node:20.18.1-bookworm-slim AS builder
# RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
# && rm -rf /var/lib/apt/lists/*
WORKDIR /usr/src/app

# Use your proxy for this build
RUN printf "registry=https://packages.vcfd.broadcom.net/artifactory/api/npm/upstream-reg-npm-virtual\nfund=false\naudit=false\n" > .npmrc

# Copy only lock files first for cacheable installs
COPY package*.json ./

# If your lock still has public URLs, rewrite them once:
RUN npm install --package-lock-only

# Install exactly what's in the lock
RUN npm ci --omit=dev

# (optional) sanity check
RUN node -e "require('pino'); console.log('pino OK')"

# ---------- runtime ----------
FROM dockerhub.packages.vcfd.broadcom.net/alpine:3.20.3
RUN apk add --no-cache nodejs ca-certificates
WORKDIR /usr/src/app
COPY --from=builder /usr/src/app/node_modules ./node_modules
COPY --from=builder /usr/src/app/package*.json ./
COPY . .
EXPOSE 7000
ENTRYPOINT ["node","server.js"]

