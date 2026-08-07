#!/bin/bash
# Creates all Kafka topics defined in /topics.yaml.
# Runs once at cluster bring-up via docker-compose kafka-init service.
set -euo pipefail

BROKER="kafka:9092"

extract_topics() {
  # tiny YAML parser: pulls "- name: X" and "partitions: Y" pairs.
  awk '
    /^  - name:/          { name=$3; next }
    /^    partitions:/    { print name, $2 }
  ' /topics.yaml
}

while read -r name partitions; do
  [[ -z "$name" ]] && continue
  echo "creating topic: $name (partitions=$partitions)"
  kafka-topics --bootstrap-server "$BROKER" \
    --create --if-not-exists \
    --topic "$name" \
    --partitions "$partitions" \
    --replication-factor 1 || true
done < <(extract_topics)

echo "done. current topics:"
kafka-topics --bootstrap-server "$BROKER" --list
