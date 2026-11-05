.PHONY: infra infra-down keycloak-upgrade api web test lint build image

infra: ## Postgres + Keycloak for local development
	docker compose up -d postgres keycloak

infra-down:
	docker compose down

keycloak-upgrade: ## Apply realm changes to an already imported local Keycloak (--import-realm skips existing realms)
	docker compose exec keycloak sh -c '\
	  kc=/opt/keycloak/bin/kcadm.sh; \
	  $$kc config credentials --server http://localhost:8080 --realm master --user admin --password admin && \
	  id=$$($$kc get clients -r orbit -q clientId=orbit-web --fields id --format csv --noquotes) && \
	  $$kc update clients/$$id -r orbit -s directAccessGrantsEnabled=true && \
	  $$kc add-roles -r orbit --uusername service-account-orbit-admin-api --cclientid realm-management --rolename realm-admin && \
	  $$kc update realms/orbit -s eventsEnabled=true -s eventsExpiration=2592000 -s adminEventsEnabled=true'

api: ## Run the Go API on :8080 with backend/.env
	cd backend && test -f .env || cp .env.example .env
	cd backend && set -a && . ./.env && set +a && go run ./cmd/orbit

web: ## Run the Next.js dev server on :5173 (proxies /api, /auth, /go to :8080)
	cd frontend && npm install && npm run dev

test:
	cd backend && go test -race ./...
	cd frontend && npm test

lint:
	cd backend && go vet ./...
	cd frontend && npm run typecheck

build:
	cd frontend && npm run build
	cd backend && go build -o bin/orbit ./cmd/orbit

image:
	docker build --build-arg VERSION="$$(git describe --tags --always --dirty)" -t orbit:dev .
