/*
 * Copyright 2018 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

'use strict';

const logger = require('./logger')

if(process.env.DISABLE_PROFILER) {
  logger.info("Profiler disabled.")
}
else {
  logger.info("Profiler enabled.")
  require('@google-cloud/profiler').start({
    serviceContext: {
      service: 'paymentservice',
      version: '1.0.0'
    }
  });
}



// --- OTel instrumentation for gRPC context propagation (always on for headers) ---
const { GrpcInstrumentation } = require('@opentelemetry/instrumentation-grpc');
const { registerInstrumentations } = require('@opentelemetry/instrumentation');
registerInstrumentations({ instrumentations: [new GrpcInstrumentation()] });

// --- Shared OTel imports ---
const { resourceFromAttributes } = require('@opentelemetry/resources');
const { ATTR_SERVICE_NAME } = require('@opentelemetry/semantic-conventions');
const { NodeSDK } = require('@opentelemetry/sdk-node');
const { PrometheusExporter } = require('@opentelemetry/exporter-prometheus');

// Service identity + metrics endpoint
const serviceName = process.env.OTEL_SERVICE_NAME || 'paymentservice';
const METRICS_PORT = Number(process.env.METRICS_PORT || 9464);
const METRICS_PATH = process.env.METRICS_PATH || '/metrics';

// Prometheus exporter (starts its own HTTP server)
const prometheusExporter = new PrometheusExporter(
  { port: METRICS_PORT, endpoint: METRICS_PATH },
  () => console.log(`Prometheus metrics at :${METRICS_PORT}${METRICS_PATH}`)
);

// Base SDK options (metrics always on)
const sdkOptions = {
  resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: serviceName }),
  metricReader: prometheusExporter,
};

// Conditionally add tracing exporter
if (process.env.ENABLE_TRACING == "1") {
  logger.info("Tracing enabled.");
  const { OTLPTraceExporter } = require('@opentelemetry/exporter-otlp-grpc');
  const collectorUrl = process.env.COLLECTOR_SERVICE_ADDR;
  sdkOptions.traceExporter = new OTLPTraceExporter({ url: collectorUrl });
} else {
  logger.info("Tracing disabled.");
}

// Start OTel (metrics always, tracing if enabled)
const sdk = new NodeSDK(sdkOptions);
try {
  sdk.start();
} catch (err) {
  console.error("Failed to start OpenTelemetry SDK:", err);
}

// ---- Minimal OTel metrics so Prom sees data ----
const { metrics } = require('@opentelemetry/api');
const meter = metrics.getMeter('app-meter');

// 1) Always-on “up” gauge (1 = healthy)
const upGauge = meter.createObservableGauge('app_up', { description: 'Application liveness (1=up)' });
upGauge.addCallback(result => result.observe(1));

// 2) Process RSS in bytes
const rssGauge = meter.createObservableGauge('process_resident_memory_bytes', { description: 'Resident set size' });
rssGauge.addCallback(result => {
  const rss = process.memoryUsage().rss;
  result.observe(rss);
});

// 3) (Optional) simple heartbeat counter so you can see it tick
const heartbeat = meter.createCounter('app_heartbeat_total', { description: 'Periodic heartbeat' });
setInterval(() => heartbeat.add(1, { service: process.env.OTEL_SERVICE_NAME || 'paymentservice' }), 10000);

// 4) (Optional) gRPC instruments you can wire into handlers
const grpcReqs = meter.createCounter('grpc_server_requests_total', {
  description: 'Total gRPC requests',
});
const grpcLatency = meter.createHistogram('grpc_server_request_duration_seconds', {
  description: 'gRPC request duration',
  unit: 's',
  boundaries: [0.003,0.01,0.025,0.05,0.1,0.25,0.5,1,2.5,5,10],
});

// ---- Your existing app below ----
const path = require('path');
const HipsterShopServer = require('./server');

const PORT = process.env['PORT'];
const PROTO_PATH = path.join(__dirname, '/proto/');

const server = new HipsterShopServer(PROTO_PATH, PORT);
server.listen();

