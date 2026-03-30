# Changelog

All notable changes to Mission Control will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [0.1.0] — 2026-03-30

### Added

- **18 dashboard views**: Tasks, Agents, Content, Approvals, Chats, Calendar, Projects, Memory, Docs, Notes, People, Office, System, Radar, Pipeline, Factory, Feedback, and a Team placeholder.
- Express 5 API server with route modules for each domain (`/api/tasks`, `/api/agents`, `/api/chats`, etc.).
- Google Calendar integration via OAuth 2.0 (Calendar view).
- Anthropic API token/cost analytics (Radar view).
- OpenClaw webhook endpoint for external push events.
- Vite + React 18 + TypeScript + Tailwind CSS frontend scaffold.
- View-pane architecture — views are mounted once then toggled via CSS to preserve scroll position and local state across navigation.
- Mock data layer for offline development.
- `.env.example` template for required credentials.
