SHELL := /bin/bash

# Spring AI 2.0 / Boot 4 need JDK 21; system default may be 17.
export JAVA_HOME := $(shell /usr/libexec/java_home -v 21 2>/dev/null)
DOCKER_COMPOSE := $(shell command -v docker-compose >/dev/null 2>&1 && echo docker-compose || echo docker compose)
API_BASE := http://localhost:8080

.DEFAULT_GOAL := help

.PHONY: help install \
        db-up db-stop db-down db-logs db-reset db-psql \
        dev-api build-api test-api ai-ping ai-ask \
        install-ext dev-ext dev-ext-firefox build-ext build-ext-firefox zip-ext load-ext \
        install-web dev-web build-web \
        clean

help: ## List available commands
	@grep -E '^[a-zA-Z0-9_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'

install: install-ext install-web ## Install all project dependencies
	@cd api && ./gradlew --version >/dev/null

# ---------------------------------------------------------------------------
# Database (devops/ — Postgres + pgvector)
# ---------------------------------------------------------------------------
db-up: ## Start Postgres+pgvector in the background
	cd devops && [ -f .env ] || cp .env.example .env; $(DOCKER_COMPOSE) up -d

db-stop: ## Stop Postgres (keep data)
	cd devops && $(DOCKER_COMPOSE) stop

db-down: ## Stop and remove the Postgres container (keep volume)
	cd devops && $(DOCKER_COMPOSE) down

db-reset: ## Wipe the database (down + remove volume) and start fresh
	cd devops && $(DOCKER_COMPOSE) down -v && $(DOCKER_COMPOSE) up -d

db-logs: ## Tail Postgres logs
	cd devops && $(DOCKER_COMPOSE) logs -f postgres

db-psql: ## Open a psql shell in the Postgres container
	docker exec -it helpdoit-postgres psql -U helpdoit -d helpdoit

# ---------------------------------------------------------------------------
# API (api/ — Spring Boot + Spring AI)
# ---------------------------------------------------------------------------
dev-api: db-up ## Run the API with hot reload (starts the DB first)
	cd api && ./gradlew bootRun

build-api: ## Build the API (compile + tests)
	cd api && ./gradlew build

test-api: db-up ## Run API tests (needs the DB)
	cd api && ./gradlew test

ai-ping: ## Smoke-test the embedding path (API must be running)
	curl -s $(API_BASE)/api/ai/ping; echo

ai-ask: ## Smoke-test the chat path (API must be running)
	curl -s -X POST $(API_BASE)/api/ai/ask -H 'Content-Type: application/json' \
		-d '{"question":"In one sentence, what is helpdo.it?"}'; echo

# ---------------------------------------------------------------------------
# Extension (extension/ — WXT + React)
# ---------------------------------------------------------------------------
install-ext: ## Install extension dependencies
	cd extension && npm install

dev-ext: ## Run the extension in Chrome with HMR
	cd extension && npm run dev

dev-ext-firefox: ## Run the extension in Firefox with HMR
	cd extension && npm run dev:firefox

build-ext: ## Build the extension for Chrome (dist/chrome-mv3)
	cd extension && npm run build

load-ext: build-ext ## Build, then print the exact folder to load in chrome://extensions
	@echo ""
	@echo "Load unpacked in Chrome (chrome://extensions → Developer mode → Load unpacked):"
	@echo "  $(abspath extension/dist/chrome-mv3)"
	@echo ""

build-ext-firefox: ## Build the extension for Firefox (dist/firefox-mv2)
	cd extension && npm run build:firefox

zip-ext: ## Package the extension as a distributable zip
	cd extension && npm run zip

# ---------------------------------------------------------------------------
# Admin portal (web/ — Vite + React)
# ---------------------------------------------------------------------------
install-web: ## Install admin portal dependencies
	cd web && npm install

dev-web: ## Run the admin portal dev server (proxies /graphql to the API)
	cd web && npm run dev

build-web: ## Build the admin portal (web/dist)
	cd web && npm run build

# ---------------------------------------------------------------------------
clean: ## Remove API, extension, and web build artifacts
	cd api && ./gradlew clean
	rm -rf extension/dist extension/.output extension/.wxt web/dist
