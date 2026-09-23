-- ISS-32 / P0-2: detect and recover compiler workers that lost their heartbeat.

ALTER TABLE "compile_runs"
  ADD COLUMN "lastHeartbeatAt" TIMESTAMP(3);
