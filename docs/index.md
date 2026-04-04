# Project Documentation Index

> Generated: 2026-04-03 | Scan Level: Deep | Mode: Full Rescan

## Project Overview

-   **Type:** Multi-part Distributed System (2 parts)
-   **Primary Languages:** TypeScript, Python
-   **Architecture:** Event-Driven Hybrid Monolith with CQRS Read/Write Split
-   **CMS:** Payload CMS 3.45.0
-   **Deployment:** Fly.io (Docker, Sydney region, 4 environments)

### Quick Reference

#### Billie CRM Web (billie-crm-web)
-   **Type:** Web / CMS
-   **Tech Stack:** Next.js 15.3.9, Payload CMS 3.45.0, React 19.1, TypeScript 5.7
-   **State:** Zustand (6 stores) + TanStack React Query (50+ hooks)
-   **Root:** `src/`
-   **API Surface:** 60 routes across 14 domain areas

#### Event Processor (event-processor)
-   **Type:** Backend Worker (async event consumer)
-   **Tech Stack:** Python 3.11+, Motor 3.7, Pydantic 2.10, Redis Streams
-   **Handlers:** 19 event handlers writing to 4 MongoDB collections
-   **Root:** `event-processor/`

---

### Planning & Solutioning (BMAD Workflow)

-   [**Product Requirements (PRD)**](./prd.md) - User journeys, FRs, NFRs
-   [**UX Design Specification**](./ux-design-specification.md) - Design system, patterns, flows
-   [**Architecture Decision Document**](./architecture.md) - Technology decisions, patterns, structure
-   [**Project Context (AI Agents)**](./project_context.md) - Critical rules for implementation
-   [**Epics & User Stories**](./epics.md) - Implementation backlog (22 stories, 5 epics)

---

### Generated Documentation (2026-04-03)

-   [**Project Overview**](./project-overview.md) - Executive summary, architecture, tech stack
-   [**Source Tree Analysis**](./source-tree-analysis.md) - Annotated directory structure
-   [**Integration Architecture**](./integration-architecture.md) - How parts communicate (MongoDB, Redis, gRPC, S3)

#### Part: Billie CRM Web
-   [Architecture - Web](./architecture-billie-crm-web.md)
-   [API Contracts - Web](./api-contracts-billie-crm-web.md) - 60 routes, auth levels, request/response schemas
-   [Data Models - Web](./data-models-billie-crm-web.md) - 8 collections, gRPC proto, Zod schemas
-   [Component Inventory - Web](./component-inventory-billie-crm-web.md) - 25 component dirs, 50+ hooks, 6 stores
-   [Development Guide - Web](./development-guide-billie-crm-web.md) - Setup, testing, conventions

#### Part: Event Processor
-   [Architecture - Event Processor](./architecture-event-processor.md)
-   [Development Guide - Event Processor](./development-guide-event-processor.md) - Setup, handlers, testing

---

### Existing Documentation

-   [**Event Sourcing Architecture**](./EVENT_SOURCING_ARCHITECTURE.md) - Detailed event sourcing design
-   [**Gap Analysis Review**](./GAP_ANALYSIS_REVIEW.md) - Feature gap analysis
-   [**Implementation Readiness Report**](./implementation-readiness-report-2025-12-11.md)
-   [Brainstorming Session](./analysis/brainstorming-session-2025-12-11.md) - Initial project brainstorming
-   [Payload CMS Best Practices](../documents/payload-cms-ux-best-practices.md) - UX Guide

### Root-Level Documentation

-   [README.md](../README.md) - Project readme
-   [DEPLOYMENT.md](../DEPLOYMENT.md) - Fly.io deployment guide
-   [DOCKER.md](../DOCKER.md) - Docker development guide
-   [CLAUDE.md](../CLAUDE.md) - AI assistant context
-   [Requirements (v2)](../Requirements/v2-servicing-app/) - Original requirements docs

---

### Getting Started

**Web App:**
```bash
pnpm install
pnpm dev          # http://localhost:3000
```

**Event Processor:**
```bash
cd event-processor
pip install -r requirements.txt
python -m billie_servicing.main
```

**Requirements:** MongoDB, Redis. Optional: gRPC ledger service (app works in degraded/read-only mode without it).

---

### AI-Assisted Development

When working with this codebase:
1. Start with this index for navigation
2. Read [Project Overview](./project-overview.md) for architecture understanding
3. Read [Integration Architecture](./integration-architecture.md) for how parts communicate
4. For UI work: [Component Inventory](./component-inventory-billie-crm-web.md) + [Development Guide](./development-guide-billie-crm-web.md)
5. For API work: [API Contracts](./api-contracts-billie-crm-web.md) + [Data Models](./data-models-billie-crm-web.md)
6. For event processing: [Development Guide - Event Processor](./development-guide-event-processor.md)
7. Critical rule: **Never write to domain MongoDB collections from Payload** - only the event processor writes domain data
