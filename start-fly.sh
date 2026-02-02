#!/bin/bash

echo "=========================================="
echo "Starting Billie Platform (Fly.io)"
echo "=========================================="

cd /app

# Start the event processor in background (if enabled)
# Note: Event processor failure should NOT crash the web server
if [ "${ENABLE_EVENT_PROCESSING:-false}" = "true" ]; then
    echo "Starting Event Processor..."
    python3 -m billie_servicing.main &
    EVENT_PROCESSOR_PID=$!
    echo "Event Processor started (PID: $EVENT_PROCESSOR_PID)"
    
    # Check if event processor started successfully (give it 2 seconds)
    sleep 2
    if ! kill -0 $EVENT_PROCESSOR_PID 2>/dev/null; then
        echo "⚠️  Event Processor failed to start (check if SDKs are installed)"
        echo "⚠️  Continuing with web server only..."
        EVENT_PROCESSOR_PID=""
    fi
else
    echo "Event Processor disabled (ENABLE_EVENT_PROCESSING != true)"
fi

# Start the Next.js standalone server (foreground - this is the main process)
echo "Starting Next.js Server..."
echo "=========================================="
echo "Services:"
echo "  - Next.js: http://0.0.0.0:3000"
if [ -n "$EVENT_PROCESSOR_PID" ]; then
    echo "  - Event Processor: Running (PID: $EVENT_PROCESSOR_PID)"
else
    echo "  - Event Processor: Not running"
fi
echo "=========================================="

# Handle shutdown gracefully
cleanup() {
    echo "Shutting down services..."
    if [ -n "$EVENT_PROCESSOR_PID" ]; then
        kill $EVENT_PROCESSOR_PID 2>/dev/null || true
    fi
    echo "Shutdown complete"
    exit 0
}

trap cleanup SIGTERM SIGINT

# Run Next.js in foreground (main process)
# This ensures the container stays alive as long as Next.js is running
exec node server.js
