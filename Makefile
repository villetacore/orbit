.PHONY: infra infra-down api web test lint build image

infra: ## Postgres + Keycloak for local development
	docker compose up -d postgres keycloak

infra-down:
	docker compose down

api: ## Run the Go API on :8080 with backend/.env
	cd backend && test -f .env || cp .env.example .env
	cd backend && set -a && . ./.env && set +a && go run ./cmd/orbit

web: ## Run the Vite dev server on :5173 (proxies /api, /auth, /go to :8080)
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
	docker build -t orbit:dev .
