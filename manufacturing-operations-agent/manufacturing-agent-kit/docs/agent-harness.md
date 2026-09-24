# Edge anomaly Agent harness

`src/agent-harness.mjs` is the first executable version of the direct-sensor and normal-reference pipeline.

```text
observation adapters -> validation -> feature window -> normal-reference score
-> safety FSM -> actuator command -> evidence-grounded Agent plan
```

The module accepts the same observation schema for real adapters and mock scenarios. It stores JSONL observations through `createJsonlCollector`, builds 16 interpretable features, fits a normal-reference max-absolute-z model with median/MAD/IQR scaling and sensor-aware minimum scales, and returns a structured event with evidence, actuator outputs, sensor/actuator feedback, limitations, and an Agent plan. Features with insufficient normal variation are recorded as `degenerateFeatures` instead of being hidden. The deterministic Agent calls `searchSop`, returns SOP evidence references and a tool trace, and `verifyRecovery` checks the post-action window. This is a local, reviewable fallback boundary for a later LLM/RAG implementation.

Each row keeps the shared `runId` plus temperature/ambient values, ultrasonic distance, probe frequency and echo quality, camera person/distance observations, motor and servo command/feedback, LED/buzzer feedback, and per-channel health (`OK`, `DEGRADED`, `FAIL`). LED, buzzer, and servo output states are recorded for traceability but are deliberately excluded from the anomaly feature vector to prevent control-output leakage. Servo mismatch, camera–ultrasonic disagreement, echo quality, and channel health are included as diagnostic features.

An adapter can append a real Jetson reading without knowing the model internals:

```js
collector.append({
  timestamp, equipmentId: 'jetson-rig-01', runId: 'heat-trial-2026-09-14-01',
  temperatureC, ambientTemperatureC,
  ultrasonicDistanceCm, ultrasonicFrequencyHz: 40000, ultrasonicEchoQuality,
  cameraPersonDetected, cameraDistanceCm,
  motorCommand, motorMotionConfirmed,
  servoCommand, servoMotionConfirmed, servoPositionDeg,
  ledColor, buzzerState,
  temperatureSensorHealth, ultrasonicSensorHealth, cameraHealth,
  servoHealth, ledHealth, buzzerHealth
});
```

For directly collected data, use a distinct `runId` for each heating, ultrasonic, camera, or actuator operating trial. `fitNormalModelWithHoldout` keeps the newest independent runs out of fitting, reports holdout false-alarm rate, and runs an IQR audit across the interpretable features for candidate input outliers. The current mock normal generator adds deterministic run/time variation only to make the calibration path visible; it is not a substitute for real sensor data. A small holdout is reported as `small_sample`; it is not treated as proof of generalization. A `FAIL`/`DEGRADED` channel is evidence for escalation, not an automatic root-cause claim.

## First-priority remote Agent adapter

`src/agent-api.mjs` adds an optional OpenAI-compatible remote endpoint. The Jetson-side detector sends only a structured incident summary after the local safety decision; the remote response is JSON-validated and cannot contain actuator authority. If the endpoint is missing, times out, returns invalid JSON, or returns an HTTP error, the deterministic local SOP Agent is used.

The remote response also passes a grounding gate. It must select existing event evidence IDs (`e0`, `e1`, ...) and approved SOP IDs. The final observations and checks shown to an operator are reconstructed locally from those IDs; free-form remote measurements, causes, and procedures are discarded. This prevents a syntactically valid but unsupported claim from becoming an operator instruction. This is a grounding guard, not a mathematical proof that an LLM is hallucination-free.

Configure a local PC or approved API endpoint with `.env.example` values. The endpoint is not called by the safety loop and no secret is stored in the repository. A compatible local server can use a small quantized open-weight model; the first candidate is `Qwen2.5-0.5B-Instruct`, while the fallback remains available for offline operation.

The verified local run in this workspace uses the public Qwen2.5-0.5B-Instruct Q4_K_M GGUF with llama.cpp. The runtime and model are intentionally ignored by Git because they are binary artifacts. Start the loopback-only server with `npm.cmd run agent:local-llm`, then point the Agent adapter at it:

```powershell
$env:AGENT_API_BASE_URL = 'http://127.0.0.1:8000'
$env:AGENT_API_MODEL = 'Qwen2.5-0.5B-Instruct'
$env:AGENT_API_TIMEOUT_MS = '60000'
node src/agent-api.mjs temperature_rise
# or: npm.cmd run agent:local-run -- temperature_rise
```

The request uses a JSON Schema response constraint whose allowed evidence/SOP IDs are derived from the local event. The response is still passed through `parseAgentJson` and `groundedRemotePlan`; it cannot control actuators. If the server is unavailable or the model violates the contract, the local SOP Agent is used.

Run one complete incident through the adapter:

```powershell
node src/agent-api.mjs temperature_rise
node src/agent-api.mjs person_emergency
```

Without `AGENT_API_BASE_URL`, these commands deliberately use the local SOP fallback. With a configured OpenAI-compatible endpoint, only `agentPlan` changes; the event state and actuator decision remain local.

Run the demonstration from this directory:

```powershell
node src/agent-harness.mjs
```

Run tests:

```powershell
node --test tests/agent-harness.test.mjs
```

The demo scenarios are `normal`, `temperature_rise`, `motion_fault`, `person_warning`, and `person_emergency`. Temperature and motion anomaly decisions are model/rule evidence; they are not failure probabilities or confirmed root causes. The Python-equivalent safety boundary is implemented here in JavaScript because this project currently has a Node-only locked runtime. The LLM can later replace `buildAgentPlan` behind the same structured event and tool boundary.
