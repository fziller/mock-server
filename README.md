# Reliability Explorer Mock Server

Local mock server for the "Reliability Index Explorer" frontend challenge.

It exposes the challenge endpoints under `/api/users/:userId/...` and reads data from editable JSON files in `data/`.

## Setup

```bash
npm install
npm run start
```

Default port: `3004`

Server URL:

- `http://localhost:3004`

## Scripts

```bash
npm run start
npm run generate:large
```

- `dev`: starts the mock server with Node watch mode
- `start`: starts the mock server without watch mode
- `generate:large`: generates a deterministic large transaction dataset for performance and virtualization testing

## Available Endpoints

### `GET /api/users/:userId/reliability?from=YYYY-MM-DD`

Returns the reliability score payload for a user and scoring window. The response starts from the seed entry in `data/reliability.json` and is then re-derived from the current in-memory transaction state, so streamed transaction events can change later reliability responses for the same user and window.

### `GET /api/users/:userId/transactions?from=YYYY-MM-DD&to=YYYY-MM-DD`

Returns transactions for the given date range. The response is intentionally not pre-sorted so the frontend can handle sorting itself. Transaction snapshots are served from the in-memory store that is initialized when the server starts.

### `GET /api/users/:userId/transaction-events`

Opens a Server-Sent Events (SSE) stream for the user. The server keeps the connection open, sends an initial `connected` event, and then streams `transaction` events with the following payload shapes:

- `TRANSACTION_ADDED` with a full `transaction`
- `TRANSACTION_UPDATED` with `transaction_id` and changed fields such as `balance`
- `TRANSACTION_DELETED` with `transaction_id`

The mock server automatically generates transaction events on a timer after startup. Clients should load the initial transaction snapshot via `/transactions` first and then subscribe to `/transaction-events` for live updates.

Guaranteed `TRANSACTION_ADDED` events are emitted in a per-user round-robin cycle so every seeded user receives fresh transactions over time. Interleaved `TRANSACTION_UPDATED` and `TRANSACTION_DELETED` events still occur for users with existing history.

Example:

```bash
curl -N http://localhost:3004/api/users/user_123/transaction-events
```

### `GET /health`

Simple health check.

## Data Files

All mock data is split into separate JSON files so it can be changed quickly:

- `data/users.json`
- `data/reliability.json`
- `data/transactions.json`
- `data/transactions.large.json`

The server loads the base transaction datasets on startup and uses them to initialize an in-memory transaction store for live event generation. Reliability seeds continue to come from `data/reliability.json`, but responses are recalculated from the current transaction state. Derived client views such as monthly cashflow should be aggregated from `/transactions` instead of a dedicated endpoint.

## Seeded User Scenarios

- `user_123` (`Marta Vogel`): heavy-user performance scenario with the large dataset and mostly stable behavior.
- `user_456` (`Leon Fischer`): high-confidence positive case with regular salary income and no negative balances.
- `user_789` (`Sara Demir`): risk case with irregular income, repeated fees, and negative-balance periods.
- `user_321` (`Jonas Weber`): near break-even case with thin buffers and occasional negative dips.
- `user_654` (`Nadia Karim`): volatile case with strong inflows but large discretionary spending spikes.

## Updating Mock Data

1. Edit the JSON files in `data/`
2. Restart the mock server to pick up transaction dataset changes
3. Re-run the request or reconnect to the SSE stream

To regenerate the large dataset:

```bash
npm run generate:large
```
