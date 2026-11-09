# Patient contact updates: verification results (2026-11-09)

Handler: `frontend/api/patients/[id]/contact.ts` (PATCH /api/patients/{id}/contact), run for real on
`scripts/dev-insurance.sh` against the `patient-contact-dev` simulation (stateful forks of hc-patients and hc-notifications).

| Run | Collection | Simulation | Result |
| --- | --- | --- | --- |
| main | Patient contact updates | patient-contact-dev.sim.yaml, :4300 | 51/51 requests, 61/61 assertions |
| outage | Patient contact updates outage | patient-contact-dev-outage.sim.yaml, :4301 (notifications 503) | 4/4 requests, 5/5 assertions |

Raw reports are in `main/` and `outage/`. The first main run failed one assertion that was wrong (it searched
the whole delivered row, which legitimately carries the address in `to`); the assertion was fixed, nothing in the handler changed.

Negative controls (handler deliberately broken, collection rerun): always-resend failed 6 assertions, ignoring unknown
fields failed 6, reading the patient before checking auth failed 1. Handler restored afterwards.

Not verified against the real services: see `postman/simulations/patient-contact-dev.context.yaml` (claims with status `unknown`).
