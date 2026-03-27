# Reliability Explorer Mock Server

Local read-only mock server for the "Reliability Index Explorer" frontend challenge.

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

Returns the reliability score payload for a user and scoring window.

### `GET /api/users/:userId/transactions?from=YYYY-MM-DD&to=YYYY-MM-DD`

Returns transactions for the given date range. The response is intentionally not pre-sorted so the frontend can handle sorting itself.

### `GET /api/users/:userId/transaction-events`

Returns example add, update, and delete transaction events as a normal JSON array.

### `GET /api/users/:userId/cashflow?from=YYYY-MM-DD&to=YYYY-MM-DD`

Returns monthly cashflow data for the requested range.

### `GET /health`

Simple health check.

## Data Files

All mock data is split into separate JSON files so it can be changed quickly:

- `data/users.json`
- `data/reliability.json`
- `data/transactions.json`
- `data/transactions.large.json`
- `data/cashflow.json`
- `data/transaction-events.json`

The server reads the JSON files on every request, so data changes are reflected immediately.

## Updating Mock Data

1. Edit any JSON file in `data/`
2. Re-run the request

To regenerate the large dataset:

```bash
npm run generate:large
```
