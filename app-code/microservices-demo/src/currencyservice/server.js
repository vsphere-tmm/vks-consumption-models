/*
 * Copyright 2018 Google LLC.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const pino = require('pino');
const logger = pino({
  name: 'currencyservice-server',
  messageKey: 'message',
  formatters: {
    level (logLevelString, logLevelNum) {
      return { severity: logLevelString }
    }
  }
});


logger.info("Profiler disabled.")


// Register GRPC OTel Instrumentation for trace propagation
// regardless of whether tracing is emitted.
const { GrpcInstrumentation } = require('@opentelemetry/instrumentation-grpc');
const { registerInstrumentations } = require('@opentelemetry/instrumentation');

registerInstrumentations({
  instrumentations: [new GrpcInstrumentation()]
});

// ---- OTel setup (Tracing stays conditional; Metrics always exposed via Prometheus) ----
const { resourceFromAttributes } = require('@opentelemetry/resources');
const { ATTR_SERVICE_NAME } = require('@opentelemetry/semantic-conventions');
const opentelemetry = require('@opentelemetry/sdk-node');
const { PrometheusExporter } = require('@opentelemetry/exporter-prometheus');

const serviceName = process.env.OTEL_SERVICE_NAME || 'currencyservice';

// Prometheus metrics endpoint (starts its own HTTP server)
const METRICS_PORT = Number(process.env.METRICS_PORT || 9464);
const METRICS_PATH = process.env.METRICS_PATH || '/metrics';
const prometheusExporter = new PrometheusExporter(
  { port: METRICS_PORT, endpoint: METRICS_PATH },
  () => console.log(`Prometheus metrics exposed at :${METRICS_PORT}${METRICS_PATH}`)
);

// Build NodeSDK options once; attach tracing exporter only if enabled
const sdkOptions = {
  resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: serviceName }),
  // Prometheus exporter acts as a MetricReader
  metricReader: prometheusExporter
};

if (process.env.ENABLE_TRACING == "1") {
  logger.info("Tracing enabled.");
  const { OTLPTraceExporter } = require('@opentelemetry/exporter-otlp-grpc');
  const collectorUrl = process.env.COLLECTOR_SERVICE_ADDR;
  sdkOptions.traceExporter = new OTLPTraceExporter({ url: collectorUrl });
} else {
  logger.info("Tracing disabled.");
}

// Start OTel (metrics always on; tracing if enabled)
const sdk = new opentelemetry.NodeSDK(sdkOptions);
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

// ---- Your existing app code below ----
const path = require('path');
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');

const MAIN_PROTO_PATH = path.join(__dirname, './proto/demo.proto');
const HEALTH_PROTO_PATH = path.join(__dirname, './proto/grpc/health/v1/health.proto');

const PORT = process.env.PORT;

const shopProto = _loadProto(MAIN_PROTO_PATH).hipstershop;
const healthProto = _loadProto(HEALTH_PROTO_PATH).grpc.health.v1;


/**
 * Helper function that loads a protobuf file.
 */
function _loadProto (path) {
  const packageDefinition = protoLoader.loadSync(
    path,
    {
      keepCase: true,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true
    }
  );
  return grpc.loadPackageDefinition(packageDefinition);
}

/**
 * Helper function that gets currency data from a stored JSON file
 * Uses public data from European Central Bank
 */
function _getCurrencyData (callback) {
  const data = require('./data/currency_conversion.json');
  callback(data);
}

/**
 * Helper function that handles decimal/fractional carrying
 */
function _carry (amount) {
  const fractionSize = Math.pow(10, 9);
  amount.nanos += (amount.units % 1) * fractionSize;
  amount.units = Math.floor(amount.units) + Math.floor(amount.nanos / fractionSize);
  amount.nanos = amount.nanos % fractionSize;
  return amount;
}

/**
 * Lists the supported currencies
 */
function getSupportedCurrencies (call, callback) {
  logger.info('Getting supported currencies...');
  _getCurrencyData((data) => {
    callback(null, {currency_codes: Object.keys(data)});
  });
}

/**
 * Converts between currencies
 */
function convert (call, callback) {
  try {
    _getCurrencyData((data) => {
      const request = call.request;

      // Convert: from_currency --> EUR
      const from = request.from;
      const euros = _carry({
        units: from.units / data[from.currency_code],
        nanos: from.nanos / data[from.currency_code]
      });

      euros.nanos = Math.round(euros.nanos);

      // Convert: EUR --> to_currency
      const result = _carry({
        units: euros.units * data[request.to_code],
        nanos: euros.nanos * data[request.to_code]
      });

      result.units = Math.floor(result.units);
      result.nanos = Math.floor(result.nanos);
      result.currency_code = request.to_code;

      logger.info(`conversion request successful`);
      callback(null, result);
    });
  } catch (err) {
    logger.error(`conversion request failed: ${err}`);
    callback(err.message);
  }
}

/**
 * Endpoint for health checks
 */
function check (call, callback) {
  callback(null, { status: 'SERVING' });
}

/**
 * Starts an RPC server that receives requests for the
 * CurrencyConverter service at the sample server port
 */
function main () {
  logger.info(`Starting gRPC server on port ${PORT}...`);
  const server = new grpc.Server();
  server.addService(shopProto.CurrencyService.service, {getSupportedCurrencies, convert});
  server.addService(healthProto.Health.service, {check});

  server.bindAsync(
    `0.0.0.0:${PORT}`,
    grpc.ServerCredentials.createInsecure(),
    function() {
      logger.info(`CurrencyService gRPC server started on port ${PORT}`);
      server.start();
    },
   );
}

main();
