For any API related work, refer to the `postman/skills` folder.
To send an HTTP request against a service in this repository, use `postman request`: it resolves this repository's environment variables and auth, and an assertion written there carries over into the collection unchanged.

## Postman skills
- Use the Postman plugin skills (https://github.com/postmanlabs/postman-plugin/tree/main/skills) as often as you can, for every task in this repository: load the matching skill with the Skill tool before each kind of API work and follow it.
- Keep them current. Run `postman skills status` (and `postman skills update` when it reports behind) for the copies in `postman/skills/`, `claude plugin update postman@postman` for the plugin, and `postman update` for the CLI.

## Local development
- This repo runs as one app. The service fleet listed in `registry.yaml` is not deployed, so do not try to run other services (`run.sh` and `docker-compose.yml` will not work). Test against Postman simulations in `postman/simulations/` instead.
- Local development shares the production Supabase project. Never point local work at it.
- A handler that calls another service over HTTP reads each upstream base URL from an env var (`PATIENTS_API_URL`, `CLAIMS_API_URL`, `BILLING_API_URL`, `NOTIFICATIONS_API_URL`, falling back to `GATEWAY_BASE_URL`), so a simulation can stand in for the dependency.
- `scripts/dev-insurance.sh` runs the routes under `frontend/api/insurance/` and `frontend/api/patients/[id]/` (patient contact updates, simulation `patient-contact-dev.sim.yaml`) locally on port 4400 with those env vars pointed at a simulation on port 4300. The simulation is `postman/simulations/insurance-dev.sim.yaml`. Name each member's route key after its dependency (`patients`, `claims`, `billing`) and add a member only when the work needs that dependency. To prove an outage, add a second member for the same mock under the route key `<key>-down` with a simulation fault scenario (`scenarios[].overrides.conditions.error.status_code: 503`) rather than writing a separate failing mock. Read the script header for how to point the service at a failing dependency.
- A saved collection's normal run must pass with no special setup. Put checks that need a failing dependency (the `<key>-down` members) in a separate collection named `<collection> outage`, so they never run as part of the normal suite.
- Stop the simulation and the local service when you are done (`scripts/dev-sim.sh stop`, `scripts/dev-insurance.sh stop`); a leftover simulation holds port 4300 and breaks `--simulation` runs.
- Save API checks as Postman collections under `postman/collections/` rather than one-off curl commands, and run them with `postman collection run <collection> --simulation <file> --port 4300` to see which calls each dependency received.
