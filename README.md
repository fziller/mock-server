# Reliability Explorer Mock Server

Local read-only mock server for the "Reliability Index Explorer" frontend challenge.

It exposes the challenge endpoints under `/api/users/:userId/...` and reads data from editable JSON files in `data/`.

## Setup

```bash
npm install
npm run dev
```

Default port: `3004`

Server URL:

- `http://localhost:3004`

## Scripts

```bash
npm run dev
npm run start
npm run generate:large
```

- `dev`: starts the mock server with Node watch mode
- `start`: starts the mock server without watch mode
- `datax`: alias for the local mock start, similar to the `lcc` setup
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

## Included Challenge README

The original challenge brief is included below for convenience.

# Frontend Challenge — Reliability Index Explorer

## Context

Your team is building a **thin-file credit decision tool**.  
Many users have limited or no traditional credit history. To evaluate them, our backend computes a **Reliability Index (0–100)** using bank transaction data.  
This internal tool is used by **risk analysts and product teams** to:

- understand how a score was computed
- inspect underlying transaction patterns
- identify anomalies in financial behavior
- validate that the scoring system behaves correctly

The tool must handle **large transaction datasets** and **complex scoring signals** while remaining **clear, explainable, and easy to inspect**.  
Your task is to design and implement a **frontend application that visualizes and explains the Reliability Index**.

## Timebox

Please spend **no more than 4 hours** on this assignment.  
We care more about **engineering decisions and structure** than UI polish.  
If you cannot complete everything, focus on the **core functionality and architecture**.

Preferred:

- **React + TypeScript**

Allowed:

- React Native (if preferred)
- Vite
- Any state management or charting libraries

Please **document the libraries you choose and why**.

## What You Need to Build

Build a **Reliability Explorer** that helps analysts understand how a user’s score was computed.  
We provide a **mock backend API**. (To Do)

## Reliability Overview

Fetch the reliability score for a user.  
Endpoint

    GET /api/users/{userId}/reliability?from=YYYY-MM-DD

Example response

    {
      "user_id": "user_123",
      "from": "2026-02-20",
      "currency": "EUR",
      "reliability_index": 74,
      "score_band": "MEDIUM",
      "metrics": {
        "income_regularity": 0.83,
        "income_coverage_ratio": 1.25,
        "essential_payments_consistency": 0.92,
        "good_months": 5,
        "negative_balance_days": 3,
        "late_fee_events": 1
      },
      "drivers": [
        "Income present in 5/6 months",
        "Essential payments detected consistently",
        "Good cashflow months: 5/6"
      ]
    }

The dashboard should display:

- Reliability score
- Score band
- Scoring window
- Key metrics
- Score drivers

### Score Breakdown

Visualize the four scoring signals:

- Income Regularity
- Income Coverage Ratio
- Essential Payments Consistency
- Resilience Adjustments - use `reliability_index` to represent this

The UI should make it **clear how the score was derived**.

## Transaction Explorer

Analysts need to inspect the transactions used in scoring.  
Endpoint

    GET /api/users/{userId}/transactions?from=YYYY-MM-DD&to=YYYY-MM-DD

Example transaction

    {
      "id": "txn_123",
      "date": "2026-01-15",
      "amount": -45.20,
      "merchant": "Netflix",
      "category": "ENTERTAINMENT",
      "account": "Checking",
      "balance": 820.15
    }

Transaction responses **may contain out-of-order records**.  
Build a **Transaction Explorer** that supports:

- sorting
- filtering by category
- filtering by positive / negative transactions
- search by merchant
- pagination or virtualization

The UI should remain usable even with **thousands of transactions**.

---

# Cashflow Timeline

Display a **monthly cashflow view** for the scoring window.  
Example

    Month   Income   Essential Expenses
    Sep     2400     900
    Oct     2400     850
    Nov     0        820
    Dec     2500     910
    Jan     2400     880
    Feb     2400     900

This may be implemented as:

- Candidate can choose a suitable visual representation for creative freedom.

The goal is to help analysts **understand financial stability trends**.

---

# Score Explanation Panel

Provide a **clear explanation of the score drivers**.  
Example

    Positive Signals
    + Income present in 5/6 months
    + Essential payments detected consistently

    Risk Signals
    - 3 negative balance days
    - 1 late fee event

The explanation should be **easy to understand for non-technical users**.

---

# Application Requirements

## Data States

Your application should correctly handle:

- loading states
- empty states
- API errors

---

## Large Datasets

Transaction datasets may contain **10,000+ records**.

- The transaction explorer should remain **responsive, usable, and performant** even with large datasets.
- Your solution should demonstrate how the UI scales when working with large collections of data.

---

# Streaming Transaction Updates

The system may emit **transaction events** that update the dataset.  
Endpoint

    GET /api/users/{userId}/transaction-events

    Example events

    {
     "type": "TRANSACTION_ADDED",
     "transaction": {...}
    }

    {
      "type": "TRANSACTION_UPDATED",
      "transaction_id": "txn_123",
      "balance": 780
    }

    {
      "type": "TRANSACTION_DELETED",
      "transaction_id": "txn_987"
    }

These events may arrive via:

- WebSocket
- Server-Sent Events
- polling

Your solution should update:

- transaction lists
- filters
- charts
- derived views

without breaking UI state.

---

# Deliverables

## 1️⃣ Source Code

A working frontend application.

---

## 2️⃣ Documentation

Include a README describing:

- Setup instructions
- How to run the project
- Assumptions
- Trade-offs
- Limitations

---

## 3️⃣ Architecture Notes

Explain:

- How you structured the frontend
- State management decisions
- Data fetching strategy
- Component design approach

---

## 4️⃣ Diagrams

Include at least one diagram explaining your solution.  
Examples:

- component architecture
- data flow
- state management

---

## 5️⃣ AI Usage Disclosure

If AI tools were used:

- explain where

---

# Evaluation Criteria

### Architecture

How the application is structured and how responsibilities are separated across the system.

### Component Design

Clarity of component responsibilities and how reusable or composable the UI components are.

### Data Handling

How the application handles asynchronous data and different application states.

### Performance Considerations

How the application behaves when working with large datasets or frequent updates.

### Code Quality

Readability, maintainability, and type safety of the implementation.

---

## Testing Large Datasets

To demonstrate that your Transaction Explorer can scale, you can generate thousands of transactions from the sample response using a simple Node.js script.

// generateTransactions.js

    const fs = require('fs');

    const sampleTransaction = {
      id: 'txn_1',
      date: '2026-01-15',
      amount: -45.20,
      merchant: 'Netflix',
      category: 'ENTERTAINMENT',
      account: 'Checking',
      balance: 820.15,
    };

    const NUM_TRANSACTIONS = 20000;

    const transactions = [];

    for (let i = 0; i < NUM_TRANSACTIONS; i++) {
      transactions.push({
        ...sampleTransaction,
        id: `txn_${i + 1}`,
        date: `2026-01-${(i % 28) + 1}`,
        amount: sampleTransaction.amount + Math.floor(Math.random() * 20 - 10),
        balance: sampleTransaction.balance + Math.floor(Math.random() * 100 - 50),
      });
    }

    fs.writeFileSync('transactions_large.json', JSON.stringify(transactions, null, 2));
    console.log(`Generated ${NUM_TRANSACTIONS} transactions!`);

### Instructions

Run the script:  
`node generateTransactions.js`  
Import the generated JSON in your frontend project:  
`import transactions from './transactions_large.json';`

Use this dataset to test sorting, filtering, pagination, and virtualization.

---

## **Discussion & Design Prompts (For Follow-up Interview)**

The following topics are **not required to be implemented** as part of the assignment.  
They will be explored during the **discussion interview** to understand your thinking, trade-offs, and system design approach.  
Please include your thoughts in the README.

---

### API Design & Evolution

- How would your frontend handle evolving or breaking API contracts?
- How would you support adding new scoring signals over time?

### Data Ownership & Boundaries

- What responsibilities belong in the frontend vs backend?
- What would you compute on the frontend vs backend?

### Data Consistency & Correctness

- How would you ensure correctness when:
  - transactions arrive out of order
  - partial data is loaded
  - updates happen frequently
- What would be your source of truth?

### Scalability

- How would your solution evolve for:
  - 100k+ transactions
  - high-frequency updates

### Real-Time Updates

- How would you design for continuous streaming updates?
- How would you maintain UI consistency under frequent changes?

### Caching & Performance

- What caching strategy would you use?
- How would you handle cache invalidation when data changes?
- What parts of the system are most likely to become bottlenecks?

### Incident Thinking

- If the UI becomes slow or incorrect in production:
- how would you debug it?
