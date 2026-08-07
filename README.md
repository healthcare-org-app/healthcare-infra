# healthcare-org infra

Shared infrastructure for all 100 services.

## What runs here

- **Postgres 16** — one logical database per domain (see `POSTGRES_MULTIPLE_DATABASES` env in `docker-compose.yml`). Each service owns its DB; no cross-service reads at the DB layer.
- **Kafka + Zookeeper** — event bus. Topics are pre-created from `topics.yaml` by the `kafka-init` container.
- **Redis** — cache + rate-limit backend for the gateway and auth service.
- **Consul** — service registry (used by `service-registry` and `api-gateway`).

## Bring it up

```bash
docker compose up -d postgres kafka zookeeper redis service-registry
docker compose up kafka-init          # one-shot: creates topics
```

## Files

- `docker-compose.yml` — the shared stack.
- `topics.yaml` — source of truth for every Kafka topic (partitions, producers, consumers).
- `registry.yaml` — source of truth for every service (port, language, HTTP deps, publishes, subscribes).
- `seed/create-topics.sh` — invoked by `kafka-init`.
- `seed/init-databases.sh` — invoked by Postgres on first start.

## Ports

Services claim ports from `registry.yaml`. Ranges by domain:

| Range     | Domain                     |
|-----------|----------------------------|
| 8000–8009 | Platform                   |
| 8100–8109 | Patients                   |
| 8200–8208 | Providers                  |
| 8300–8314 | Clinical / EHR             |
| 8400–8407 | Diagnostics                |
| 8500–8506 | Pharmacy                   |
| 8600–8604 | Scheduling                 |
| 8700–8709 | Billing / RCM              |
| 8800–8805 | Insurance                  |
| 8900–8904 | Devices / IoT              |
| 9000–9004 | Communications             |
| 9100–9104 | AI / Analytics             |
| 9200–9204 | Facility / Operations      |

## Adding a new service

1. Add an entry to `registry.yaml` with a fresh port.
2. Add any new topics to `topics.yaml`.
3. `cp -r ../services/patients-service ../services/<new-name>` and edit.
4. Restart `kafka-init` if you added topics.
